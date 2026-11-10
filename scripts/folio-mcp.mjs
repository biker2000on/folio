#!/usr/bin/env node
// Folio MCP stdio bridge.
//
// For MCP clients that only speak stdio (e.g. Claude Desktop's local servers).
// It reads newline-delimited JSON-RPC messages on stdin, POSTs each one to
// Folio's remote MCP endpoint (/api/mcp) with your API token, and writes the
// replies to stdout. All tools, auth, and book scoping live on the server;
// this file only moves bytes. It has no dependencies — copy it anywhere and
// run it with Node 18+.
//
// Configuration (environment only — never put the token on a command line):
//   FOLIO_URL    Base URL of your Folio server, e.g. https://folio.example.com
//                (a URL that already ends in /api/mcp is used as-is)
//   FOLIO_TOKEN  A gcw_ API token (Settings → API Tokens; read-only is enough)
//   FOLIO_ALLOW_HTTP=1  Permit plain http:// to a non-local host (not recommended)
//
// See docs/mcp.md.

import { createInterface } from 'node:readline';

const { FOLIO_URL, FOLIO_TOKEN, FOLIO_ALLOW_HTTP } = process.env;
const REQUEST_TIMEOUT_MS = 120_000;

function fail(message) {
    process.stderr.write(`folio-mcp: ${message}\n`);
    process.exit(1);
}

if (!FOLIO_URL || !FOLIO_TOKEN) fail('FOLIO_URL and FOLIO_TOKEN must be set in the environment.');
if (!/^gcw_[0-9a-f]{32}$/.test(FOLIO_TOKEN)) fail('FOLIO_TOKEN does not look like a Folio API token (gcw_ + 32 hex characters).');

let endpoint;
try {
    const base = new URL(FOLIO_URL);
    endpoint = /\/api\/mcp\/?$/.test(base.pathname) ? base : new URL('/api/mcp', base);
} catch {
    fail(`FOLIO_URL is not a valid URL: ${FOLIO_URL}`);
}
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
if (endpoint.protocol !== 'https:' && !isLocal && FOLIO_ALLOW_HTTP !== '1') {
    fail(`refusing to send the API token over ${endpoint.protocol}// to ${endpoint.hostname}. Use https, or set FOLIO_ALLOW_HTTP=1.`);
}

// Negotiated in `initialize`; the Streamable HTTP transport expects it on later requests.
let protocolVersion = null;

function write(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** JSON-RPC error replies for every request (not notification) in `message`. */
function errorReplies(message, code, text) {
    const list = Array.isArray(message) ? message : [message];
    return list
        .filter((m) => m && typeof m === 'object' && 'id' in m && m.id !== null && 'method' in m)
        .map((m) => ({ jsonrpc: '2.0', id: m.id, error: { code, message: text } }));
}

/** Pull JSON-RPC messages out of an SSE body, should the server ever stream. */
function parseSse(text) {
    const out = [];
    for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
        if (data) {
            try { out.push(JSON.parse(data)); } catch { /* ignore keep-alives */ }
        }
    }
    return out;
}

function rememberProtocolVersion(reply) {
    const version = reply?.result?.protocolVersion;
    if (typeof version === 'string') protocolVersion = version;
}

async function forward(message) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${FOLIO_TOKEN}`,
    };
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`folio-mcp: request to ${endpoint.origin} failed: ${reason}\n`);
        for (const reply of errorReplies(message, -32603, `Could not reach Folio: ${reason}`)) write(reply);
        return;
    }

    if (response.status === 202) return; // notification accepted

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let replies = [];
    if (contentType.includes('text/event-stream')) {
        replies = parseSse(text);
    } else if (text) {
        try {
            const parsed = JSON.parse(text);
            replies = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            replies = [];
        }
    }

    const rpcReplies = replies.filter((r) => r && typeof r === 'object' && r.jsonrpc === '2.0');
    if (rpcReplies.length > 0) {
        for (const reply of rpcReplies) {
            rememberProtocolVersion(reply);
            write(reply);
        }
        return;
    }

    // Non-JSON-RPC failure (401 bad token, 5xx, proxy page): answer each request.
    const detail = replies[0]?.error ?? text.slice(0, 200) ?? '';
    const hint = response.status === 401 ? ' Check FOLIO_TOKEN (it may be revoked or expired).' : '';
    process.stderr.write(`folio-mcp: HTTP ${response.status} from Folio.${hint}\n`);
    for (const reply of errorReplies(message, -32603, `Folio returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.${hint}`)) {
        write(reply);
    }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
        message = JSON.parse(trimmed);
    } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
    }
    const task = forward(message).finally(() => pending.delete(task));
    pending.add(task);
});

rl.on('close', async () => {
    // Let in-flight requests finish, then let the event loop drain on its own.
    // (process.exit() right after fetch() trips a libuv assertion on Windows.)
    await Promise.allSettled([...pending]);
    process.exitCode = 0;
});
