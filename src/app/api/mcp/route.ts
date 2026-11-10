// /api/mcp — Folio's read-only MCP server (Streamable HTTP, stateless).
//
// Thin on purpose: authentication, the protocol, and the tools live in
// src/lib/mcp/ (server.ts, tools.ts, shape.ts). See docs/mcp.md.

import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/server';

/**
 * @openapi
 * /api/mcp:
 *   post:
 *     tags: [MCP]
 *     summary: Model Context Protocol endpoint (read-only tools over the token's book).
 *     description: >
 *       MCP Streamable HTTP transport in stateless mode. POST one JSON-RPC 2.0
 *       message (or a batch) — `initialize`, `notifications/initialized`,
 *       `ping`, `tools/list`, `tools/call` — and receive a JSON response
 *       (`202` for notifications). Clients must send
 *       `Accept: application/json, text/event-stream`. Authenticates with a
 *       `gcw_` API token only; session cookies are rejected. All tools are
 *       read-only and scoped to the token's book, so read-only tokens work.
 *       See docs/mcp.md for the tool list and client setup.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc: { type: string, example: "2.0" }
 *               id: { oneOf: [{ type: string }, { type: integer }] }
 *               method: { type: string, example: tools/list }
 *               params: { type: object }
 *     responses:
 *       200:
 *         description: JSON-RPC response.
 *       202:
 *         description: Notification accepted (no body).
 *       400:
 *         description: Malformed JSON or JSON-RPC message.
 *       401:
 *         description: Missing, invalid, revoked, or expired API token, or a session cookie was sent.
 *       406:
 *         description: The Accept header does not list both application/json and text/event-stream.
 *   get:
 *     tags: [MCP]
 *     summary: Not supported (stateless server, no SSE stream).
 *     responses:
 *       405:
 *         description: Use POST.
 */
export async function POST(request: Request) {
    return handleMcpPost(request);
}

export async function GET() {
    return mcpMethodNotAllowed();
}

export async function DELETE() {
    return mcpMethodNotAllowed();
}
