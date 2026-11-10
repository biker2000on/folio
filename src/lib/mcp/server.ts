/**
 * Folio's remote MCP endpoint: MCP Streamable HTTP, stateless, JSON responses.
 *
 * Every POST builds a fresh SDK `Server` + web-standard transport (no session
 * ids, no SSE streams, nothing kept between requests) — the official stateless
 * pattern, and the only one that is safe behind several app replicas.
 *
 * Authentication is a `gcw_` personal API token and NOTHING else:
 *   - no Authorization header / not a gcw_ token → 401
 *   - unknown, revoked, or expired token, or no access to its book → 401
 *   - a Folio session cookie on the request → 401, even alongside a token.
 *     Session cookies are what CSRF rides on, and a session's active book
 *     would otherwise win over the token's book in the implicit scope helpers
 *     some reused services call. Refusing them keeps the token the single
 *     source of identity AND scope.
 * Every tool is read-only, so `readonly` and `edit` tokens both work.
 *
 * Every tool result leaves through `shapeToolResult` (./shape.ts) — the hook
 * the AI privacy gate plugs into. Do not add a second exit.
 */

import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    type CallToolResult,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { authenticateBearer, parseBearerToken } from '@/lib/api-tokens';
import { sessionOptions } from '@/lib/session-config';
import { roleAtLeast } from '@/lib/services/permission.service';
import { product } from '@/lib/product';
import { MCP_TOOLS, McpToolError, findMcpTool, type McpTool, type McpToolContext } from './tools';
import { shapeToolResult } from './shape';

export const MCP_SERVER_NAME = 'folio';
export const MCP_SERVER_VERSION = '1.0.0';

/** Serialized tool results above this are refused with a "narrow it down" error. */
export const MAX_TOOL_RESULT_CHARS = 200_000;

const SERVER_INSTRUCTIONS =
    `Read-only access to one ${product.brand} (GnuCash) book — the book the API token was issued for. ` +
    'Amounts are in the book report currency unless a field says otherwise. Summary tools show income ' +
    'and debt as positive numbers; search_transactions and upcoming_scheduled_transactions keep raw ' +
    'double-entry signs (positive = debit, negative = credit). Accounts are referenced by path such as ' +
    '"Expenses:Food:Groceries" (see list_accounts), a bare name, or a guid. Nothing can be changed ' +
    'through these tools.';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function jsonError(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    });
}

function unauthorized(message: string): Response {
    return jsonError(401, message, { 'WWW-Authenticate': `Bearer realm="${MCP_SERVER_NAME}"` });
}

/** True when the request carries the Folio session cookie. */
export function hasSessionCookie(request: Request): boolean {
    const cookie = request.headers.get('cookie');
    if (!cookie) return false;
    const name = sessionOptions.cookieName;
    return cookie.split(';').some((part) => part.trim().startsWith(`${name}=`));
}

/** Resolve the request's `gcw_` token to a tool context, or the 401 to send. */
export async function authenticateMcpRequest(request: Request): Promise<McpToolContext | Response> {
    if (hasSessionCookie(request)) {
        return unauthorized('The MCP endpoint does not accept session cookies. Send only an API token: Authorization: Bearer gcw_...');
    }
    const raw = parseBearerToken(request.headers.get('authorization'));
    if (!raw) {
        return unauthorized('Missing API token. Send Authorization: Bearer gcw_... (Settings → API Tokens).');
    }
    const auth = await authenticateBearer(raw);
    if (!auth || !roleAtLeast(auth.role, 'readonly')) {
        return unauthorized('Invalid, revoked, or expired API token, or the token has no access to its book.');
    }
    return { bookGuid: auth.bookGuid, userId: auth.user.id, role: auth.role };
}

// ---------------------------------------------------------------------------
// Tool listing / calling
// ---------------------------------------------------------------------------

function toolInputJsonSchema(tool: McpTool): Tool['inputSchema'] {
    // `io: 'input'` makes defaulted fields optional, which is what a caller sees.
    const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return { ...schema, type: 'object' } as Tool['inputSchema'];
}

export function listToolDefinitions(): Tool[] {
    return MCP_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toolInputJsonSchema(tool),
        annotations: {
            title: tool.title,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }));
}

function toolError(text: string): CallToolResult {
    return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Run one tool. Protocol-level problems (unknown tool, arguments that fail the
 * schema) throw McpError and become JSON-RPC errors; failures while running
 * the tool become `isError` results, as the MCP spec asks.
 */
export async function callTool(
    name: string,
    args: unknown,
    ctx: McpToolContext,
): Promise<CallToolResult> {
    const tool = findMcpTool(name);
    if (!tool) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(arguments)'}: ${issue.message}`)
            .join('; ');
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: ${detail}`);
    }

    let result: unknown;
    try {
        result = await tool.run(parsed.data, ctx);
    } catch (error) {
        if (error instanceof McpToolError) return toolError(error.message);
        console.error(`MCP tool ${name} failed:`, error);
        return toolError(`${name} failed. Try again, or narrow the request.`);
    }

    // The ONE exit for tool data. See ./shape.ts.
    const shaped = await shapeToolResult(name, result, ctx);
    const text = JSON.stringify(shaped);
    if (text.length > MAX_TOOL_RESULT_CHARS) {
        return toolError(`${name} returned too much data (${text.length} characters). Use a smaller limit or a narrower filter.`);
    }
    return { content: [{ type: 'text', text }] };
}

function buildServer(ctx: McpToolContext): Server {
    const server = new Server(
        { name: MCP_SERVER_NAME, title: `${product.brand} (read-only)`, version: MCP_SERVER_VERSION },
        { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listToolDefinitions() }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
        callTool(request.params.name, request.params.arguments, ctx));
    return server;
}

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------

/** POST /api/mcp — one stateless JSON-RPC exchange. */
export async function handleMcpPost(request: Request): Promise<Response> {
    const auth = await authenticateMcpRequest(request);
    if (auth instanceof Response) return auth;

    const server = buildServer(auth);
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 256 * 1024,
    });
    try {
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        // Responses are no-store: they carry book data.
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } finally {
        // Stateless: nothing outlives the request. In JSON mode the body is
        // fully materialized before handleRequest resolves.
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
    }
}

/** GET/DELETE /api/mcp — no server-initiated streams or sessions in stateless mode. */
export function mcpMethodNotAllowed(): Response {
    return new Response(
        JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed. This MCP server is stateless: POST JSON-RPC only.' },
            id: null,
        }),
        { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } },
    );
}
