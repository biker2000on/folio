/**
 * The single exit point for every MCP tool result, and the AI privacy gate's
 * hook into the MCP server.
 *
 * `src/lib/mcp/server.ts` routes the return value of EVERY tool through
 * `shapeToolResult` (and every tool error through `shapeToolText`) before it
 * is serialized onto the wire. Nothing else may write a tool result to an MCP
 * response: that invariant is what lets the privacy gate cover every tool,
 * including tools added later.
 *
 * An MCP client is an external cloud model that cannot unmask tokens the way
 * Folio's own screens do, so the level is the STRICTER of:
 *   - the token owner's AI privacy mode (Settings → AI), and
 *   - the token's MCP detail (Settings → API tokens; summary by default).
 *
 *   off      every tools/call is refused (server.ts); tools/list still works
 *   summary  results scrubbed by ./privacy.ts with the book's in-memory names
 *            map: names become tokens, money is rounded, dates become
 *            YYYY-MM, GUIDs stay. Tool inputs are unmasked before a tool runs.
 *   full     results pass through unchanged
 */

import { openExternalAccess, type ExternalAccess } from '@/lib/ai-privacy/gate';
import { getAccountGuidsForBook } from '@/lib/book-scope';
import type { McpDetail } from '@/lib/ai-privacy/privacy';
import type { Role } from '@/lib/services/permission.service';
import { scrubMcpResult, scrubMcpText, unmaskToolArgs } from './privacy';

export type { ExternalAccess } from '@/lib/ai-privacy/gate';

export interface McpShapeContext {
    /** The token's book — every result is scoped to it. */
    bookGuid: string;
    /** The token owner. */
    userId: number;
    /** Effective (capped) role of the token for this book. */
    role: Role;
    /** The token's MCP detail; summary when absent. */
    mcpDetail?: McpDetail;
}

export const MCP_OFF_MESSAGE =
    'AI access is turned off in Settings → AI for the owner of this token. ' +
    'Choose Summary only or Full detail there to use these tools.';

/** The level for this request (one lookup per tools/call). */
export async function resolveMcpAccess(ctx: McpShapeContext): Promise<ExternalAccess> {
    return openExternalAccess({
        userId: ctx.userId,
        detail: ctx.mcpDetail ?? 'summary',
        accountGuids: () => getAccountGuidsForBook(ctx.bookGuid),
    });
}

/**
 * Tool arguments with exact tokens swapped for real names (summary only).
 * Returns the unknown tokens so the caller can refuse with a useful error.
 */
export function unmaskMcpArgs(args: unknown, access: ExternalAccess): { args: unknown; unknown: string[] } {
    if (access.level !== 'summary') return { args, unknown: [] };
    return unmaskToolArgs(args, access.names);
}

export async function shapeToolResult(
    _toolName: string,
    result: unknown,
    _ctx: McpShapeContext,
    access: ExternalAccess,
): Promise<unknown> {
    if (access.level === 'summary') return scrubMcpResult(result, access.names);
    if (access.level === 'full') return result;
    // Off never reaches a tool (server.ts refuses first); fail closed anyway.
    return null;
}

/** Tool error text for the client (it may echo a real account or budget name). */
export function shapeToolText(text: string, access: ExternalAccess): string {
    return access.level === 'summary' ? scrubMcpText(text, access.names) : text;
}
