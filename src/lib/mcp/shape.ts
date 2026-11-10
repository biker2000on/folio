/**
 * The single exit point for every MCP tool result.
 *
 * `src/lib/mcp/server.ts` routes the return value of EVERY tool through
 * `shapeToolResult` before it is serialized onto the wire. Nothing else may
 * write a tool result to an MCP response — that invariant is what lets the AI
 * privacy gate (summary mode: tokenized payee/account names, rounded amounts)
 * be plugged in here, once, and cover every tool, including tools added later.
 *
 * Today this is an identity pass-through. When the privacy gate lands it
 * replaces the body below; the signature (async, tool name + book/user
 * context) is already what that gate needs to look up the book's AI privacy
 * setting and pick a per-tool redaction strategy.
 */

import type { Role } from '@/lib/services/permission.service';

export interface McpShapeContext {
    /** The token's book — every result is scoped to it. */
    bookGuid: string;
    /** The token owner. */
    userId: number;
    /** Effective (capped) role of the token for this book. */
    role: Role;
}

export async function shapeToolResult(
    _toolName: string,
    result: unknown,
    _ctx: McpShapeContext,
): Promise<unknown> {
    // Identity for now. The AI privacy gate (summary mode) plugs in HERE and
    // only here; do not shape or redact results anywhere else.
    return result;
}
