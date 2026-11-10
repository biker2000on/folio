/**
 * Protocol tests for the remote MCP endpoint (src/lib/mcp/server.ts).
 *
 * The SDK transport and JSON-RPC handling run for real; the token lookup and
 * the services behind the tools are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    authenticateBearerMock,
    getAccountGuidsForBookMock,
    detectRecurringChargesMock,
    shapeToolResultMock,
    booksFindUniqueMock,
    accountsFindManyMock,
    sumSplitsByAccountMock,
    getBaseCurrencyForBookMock,
} = vi.hoisted(() => ({
    authenticateBearerMock: vi.fn(),
    getAccountGuidsForBookMock: vi.fn(),
    detectRecurringChargesMock: vi.fn(),
    shapeToolResultMock: vi.fn(),
    booksFindUniqueMock: vi.fn(),
    accountsFindManyMock: vi.fn(),
    sumSplitsByAccountMock: vi.fn(),
    getBaseCurrencyForBookMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    default: {
        books: { findUnique: booksFindUniqueMock },
        accounts: { findMany: accountsFindManyMock },
    },
}));
vi.mock('@/lib/api-tokens', () => ({
    authenticateBearer: authenticateBearerMock,
    parseBearerToken: (header: string | null) => {
        const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
        return match && match[1].startsWith('gcw_') ? match[1] : null;
    },
}));
vi.mock('@/lib/book-scope', () => ({ getAccountGuidsForBook: getAccountGuidsForBookMock }));
vi.mock('@/lib/recurring-detection', () => ({ detectRecurringCharges: detectRecurringChargesMock }));
vi.mock('@/lib/reports/utils', () => ({
    sumSplitsByAccount: sumSplitsByAccountMock,
    sumSplitsByAccountAndMonth: vi.fn(),
}));
vi.mock('@/lib/currency', () => ({
    getBaseCurrencyForBook: getBaseCurrencyForBookMock,
    findExchangeRate: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/mcp/shape', () => ({ shapeToolResult: shapeToolResultMock }));

import { handleMcpPost, mcpMethodNotAllowed, MAX_TOOL_RESULT_CHARS } from '../server';
import { MCP_TOOLS } from '../tools';

const TOKEN = 'gcw_0123456789abcdef0123456789abcdef';
const TOKEN_BOOK = 'b'.repeat(32);
const ROOT = 'r'.repeat(32);

function mcpRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${TOKEN}`,
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

async function rpc(method: string, params?: unknown, headers?: Record<string, string>) {
    const response = await handleMcpPost(mcpRequest({ jsonrpc: '2.0', id: 1, method, params }, headers));
    const json = response.status === 200 ? await response.json() : null;
    return { response, json };
}

beforeEach(() => {
    vi.clearAllMocks();
    authenticateBearerMock.mockResolvedValue({
        user: { id: 7, username: 'owner' },
        role: 'readonly',
        bookGuid: TOKEN_BOOK,
    });
    getAccountGuidsForBookMock.mockResolvedValue(['acct1', 'acct2']);
    shapeToolResultMock.mockImplementation(async (_name: string, result: unknown) => result);
});

describe('authentication', () => {
    it('rejects a request with no Authorization header', async () => {
        const response = await handleMcpPost(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: '' }));
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
        expect(authenticateBearerMock).not.toHaveBeenCalled();
    });

    it('rejects a bearer token that is not a gcw_ token', async () => {
        const response = await handleMcpPost(
            mcpRequest({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer sk-something' }),
        );
        expect(response.status).toBe(401);
        expect(authenticateBearerMock).not.toHaveBeenCalled();
    });

    it('rejects an unknown, revoked, or expired token', async () => {
        authenticateBearerMock.mockResolvedValue(null);
        const { response } = await rpc('ping');
        expect(response.status).toBe(401);
        expect(authenticateBearerMock).toHaveBeenCalledWith(TOKEN);
    });

    it('rejects a cookie-only (browser session) request', async () => {
        const response = await handleMcpPost(
            mcpRequest({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: '', Cookie: 'gnucash_web_session=sealed' }),
        );
        expect(response.status).toBe(401);
        expect(authenticateBearerMock).not.toHaveBeenCalled();
    });

    it('rejects a session cookie even alongside a valid token', async () => {
        const { response } = await rpc('ping', undefined, { Cookie: 'theme=dark; gnucash_web_session=sealed' });
        expect(response.status).toBe(401);
        expect(authenticateBearerMock).not.toHaveBeenCalled();
    });

    it('ignores unrelated cookies', async () => {
        const { response } = await rpc('ping', undefined, { Cookie: 'theme=dark' });
        expect(response.status).toBe(200);
    });

    it('accepts edit tokens as well as read-only ones', async () => {
        authenticateBearerMock.mockResolvedValue({ user: { id: 7, username: 'owner' }, role: 'edit', bookGuid: TOKEN_BOOK });
        const { response } = await rpc('ping');
        expect(response.status).toBe(200);
    });

    it('answers GET with 405', async () => {
        const response = mcpMethodNotAllowed();
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
    });
});

describe('lifecycle', () => {
    it('initializes with server info, tools capability and the requested protocol version', async () => {
        const { response, json } = await rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('mcp-session-id')).toBeNull();
        expect(json.result.protocolVersion).toBe('2025-06-18');
        expect(json.result.serverInfo.name).toBe('folio');
        expect(json.result.capabilities.tools).toBeDefined();
        expect(json.result.instructions).toMatch(/read-only/i);
    });

    it('accepts notifications/initialized with 202', async () => {
        const response = await handleMcpPost(mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        expect(response.status).toBe(202);
    });

    it('answers ping', async () => {
        const { json } = await rpc('ping');
        expect(json).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    });

    it('rejects a client that does not accept JSON + SSE (transport contract)', async () => {
        const response = await handleMcpPost(
            mcpRequest({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Accept: 'text/html' }),
        );
        expect(response.status).toBe(406);
    });
});

describe('tools/list', () => {
    it('lists every tool as read-only with an object JSON Schema', async () => {
        const { json } = await rpc('tools/list');
        const tools = json.result.tools as Array<{
            name: string;
            description: string;
            inputSchema: { type: string; properties?: Record<string, unknown>; $schema?: string };
            annotations: { readOnlyHint: boolean; destructiveHint: boolean };
        }>;
        expect(tools.map((t) => t.name).sort()).toEqual([
            'account_balance_history',
            'action_center_items',
            'budget_status',
            'income_vs_expense',
            'investment_holdings',
            'list_accounts',
            'net_worth',
            'recurring_charges',
            'search_transactions',
            'spending_by_category',
            'upcoming_scheduled_transactions',
        ]);
        expect(tools).toHaveLength(MCP_TOOLS.length);
        for (const tool of tools) {
            expect(tool.description.length).toBeGreaterThan(40);
            expect(tool.inputSchema.type).toBe('object');
            expect(tool.inputSchema.$schema).toBeUndefined();
            expect(tool.annotations.readOnlyHint).toBe(true);
            expect(tool.annotations.destructiveHint).toBe(false);
        }
        const search = tools.find((t) => t.name === 'search_transactions')!;
        expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(
            expect.arrayContaining(['text', 'startDate', 'endDate', 'account', 'minAmount', 'maxAmount', 'limit']),
        );
        // Defaulted inputs are optional to the caller.
        expect((search.inputSchema as { required?: string[] }).required ?? []).not.toContain('limit');
        const history = tools.find((t) => t.name === 'account_balance_history')!;
        expect((history.inputSchema as { required?: string[] }).required).toEqual(['account']);
    });
});

describe('tools/call', () => {
    const detection = {
        series: [
            {
                merchantKey: 'netflix', merchantLabel: 'NETFLIX.COM', cadence: 'monthly', medianIntervalDays: 30,
                occurrences: 6, currentAmount: 15.49, typicalAmount: 15.49, amountChangePct: 0,
                firstSeen: '2026-05-01', lastSeen: '2026-10-01', nextExpected: '2026-11-01', status: 'active',
                monthlyEquivalent: 15.49, accountGuid: 'acct1', accountName: 'Expenses:Streaming',
            },
            {
                merchantKey: 'gym', merchantLabel: 'OLD GYM', cadence: 'monthly', medianIntervalDays: 30,
                occurrences: 4, currentAmount: 40, typicalAmount: 40, amountChangePct: 0,
                firstSeen: '2025-01-01', lastSeen: '2025-04-01', nextExpected: '2025-05-01', status: 'stopped',
                monthlyEquivalent: 40, accountGuid: 'acct2', accountName: 'Expenses:Fitness',
            },
        ],
        totals: { activeCount: 1, activeMonthlyTotal: 15.49, activeAnnualTotal: 185.88, priceIncreaseCount: 0, totalSeries: 2 },
    };

    it('runs a tool scoped to the token book and returns JSON text', async () => {
        detectRecurringChargesMock.mockResolvedValue(detection);
        const { json } = await rpc('tools/call', { name: 'recurring_charges', arguments: { months: 6 } });

        expect(getAccountGuidsForBookMock).toHaveBeenCalledWith(TOKEN_BOOK);
        expect(detectRecurringChargesMock).toHaveBeenCalledWith(['acct1', 'acct2'], { months: 6 });
        expect(json.result.isError).toBeUndefined();
        const payload = JSON.parse(json.result.content[0].text);
        expect(payload.series).toHaveLength(1); // stopped series excluded by default
        expect(payload.series[0]).toMatchObject({ merchant: 'NETFLIX.COM', monthlyEquivalent: 15.49 });
        expect(payload.totals.activeAnnualTotal).toBe(185.88);
    });

    it('passes every result through shapeToolResult and serializes what it returns', async () => {
        detectRecurringChargesMock.mockResolvedValue(detection);
        shapeToolResultMock.mockResolvedValue({ shaped: true });
        const { json } = await rpc('tools/call', { name: 'recurring_charges', arguments: {} });

        expect(shapeToolResultMock).toHaveBeenCalledTimes(1);
        const [name, result, ctx] = shapeToolResultMock.mock.calls[0];
        expect(name).toBe('recurring_charges');
        expect(result).toMatchObject({ totals: { activeCount: 1 } });
        expect(ctx).toEqual({ bookGuid: TOKEN_BOOK, userId: 7, role: 'readonly' });
        expect(JSON.parse(json.result.content[0].text)).toEqual({ shaped: true });
    });

    it('returns a JSON-RPC InvalidParams error for an unknown tool', async () => {
        const { json } = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
        expect(json.error.code).toBe(-32602);
        expect(json.error.message).toMatch(/Unknown tool/);
        expect(shapeToolResultMock).not.toHaveBeenCalled();
    });

    it('returns a JSON-RPC InvalidParams error for arguments that fail the schema', async () => {
        const { json } = await rpc('tools/call', { name: 'recurring_charges', arguments: { months: 1 } });
        expect(json.error.code).toBe(-32602);
        expect(json.error.message).toMatch(/months/);
        expect(detectRecurringChargesMock).not.toHaveBeenCalled();

        const bad = await rpc('tools/call', { name: 'search_transactions', arguments: { limit: 500 } });
        expect(bad.json.error.code).toBe(-32602);
        const badDate = await rpc('tools/call', { name: 'search_transactions', arguments: { startDate: '2026-13-45' } });
        expect(badDate.json.error.code).toBe(-32602);
    });

    it('reports a service failure as an isError result without leaking the error', async () => {
        detectRecurringChargesMock.mockRejectedValue(new Error('relation "secret_table" does not exist'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { json } = await rpc('tools/call', { name: 'recurring_charges', arguments: {} });
        spy.mockRestore();
        expect(json.result.isError).toBe(true);
        expect(json.result.content[0].text).not.toMatch(/secret_table/);
        expect(shapeToolResultMock).not.toHaveBeenCalled();
    });

    it('refuses an oversized result instead of sending it', async () => {
        detectRecurringChargesMock.mockResolvedValue(detection);
        shapeToolResultMock.mockResolvedValue({ blob: 'x'.repeat(MAX_TOOL_RESULT_CHARS + 1) });
        const { json } = await rpc('tools/call', { name: 'recurring_charges', arguments: {} });
        expect(json.result.isError).toBe(true);
        expect(json.result.content[0].text).toMatch(/too much data/);
    });

    it('groups spending by category in the report currency with a sign-correct total', async () => {
        booksFindUniqueMock.mockResolvedValue({ root_account_guid: ROOT });
        getAccountGuidsForBookMock.mockResolvedValue([ROOT, 'exp', 'food', 'groc', 'rest', 'inc']);
        accountsFindManyMock.mockResolvedValue([
            { guid: ROOT, name: 'Root Account', account_type: 'ROOT', parent_guid: null, hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            { guid: 'exp', name: 'Expenses', account_type: 'EXPENSE', parent_guid: ROOT, hidden: 0, placeholder: 1, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            { guid: 'food', name: 'Food', account_type: 'EXPENSE', parent_guid: 'exp', hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            { guid: 'groc', name: 'Groceries', account_type: 'EXPENSE', parent_guid: 'food', hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            { guid: 'rest', name: 'Rent', account_type: 'EXPENSE', parent_guid: 'exp', hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            { guid: 'inc', name: 'Income', account_type: 'INCOME', parent_guid: ROOT, hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
        ]);
        getBaseCurrencyForBookMock.mockResolvedValue({ guid: 'usd', mnemonic: 'USD', fullname: 'US Dollar', fraction: 100 });
        sumSplitsByAccountMock.mockResolvedValue(new Map([
            ['food', { quantity: 10, value: 10 }],
            ['groc', { quantity: 90, value: 90 }],
            ['rest', { quantity: 1200, value: 1200 }],
        ]));

        const { json } = await rpc('tools/call', {
            name: 'spending_by_category',
            arguments: { startDate: '2026-10-01', endDate: '2026-10-31' },
        });
        const payload = JSON.parse(json.result.content[0].text);
        expect(booksFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { guid: TOKEN_BOOK } }));
        // Only EXPENSE accounts are summed; income is not.
        expect(sumSplitsByAccountMock.mock.calls[0][0]).toEqual(['exp', 'food', 'groc', 'rest']);
        expect(payload).toMatchObject({
            period: { start: '2026-10-01', end: '2026-10-31' },
            currency: 'USD',
            total: 1300,
            categories: [
                { category: 'Expenses:Rent', amount: 1200 },
                { category: 'Expenses:Food', amount: 100, accounts: 2 },
            ],
        });
    });

    it('reports an unknown account reference as a tool error the model can act on', async () => {
        booksFindUniqueMock.mockResolvedValue({ root_account_guid: ROOT });
        getAccountGuidsForBookMock.mockResolvedValue([ROOT]);
        accountsFindManyMock.mockResolvedValue([
            { guid: ROOT, name: 'Root Account', account_type: 'ROOT', parent_guid: null, hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
        ]);
        const { json } = await rpc('tools/call', { name: 'account_balance_history', arguments: { account: 'Assets:Nope' } });
        expect(json.result.isError).toBe(true);
        expect(json.result.content[0].text).toMatch(/No account matches/);
    });
});
