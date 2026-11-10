/**
 * MCP behind the AI privacy gate.
 *
 *   - pure: summary scrubbing of tool results, input unmasking, the stricter-of rule
 *   - end to end through handleMcpPost with the REAL gate (src/lib/ai-privacy/gate.ts)
 *     and the real shape hook: off refusal, summary scrubbing, drilling into a
 *     token, full passthrough. The DB (AI config row), names source, token lookup
 *     and the services behind the tools are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { externalLevel, newNames, parseMcpDetail, ph } from '@/lib/ai-privacy/privacy';
import { scrubMcpResult, scrubMcpText, unmaskToolArgs } from '../privacy';

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const MERCHANT = 'Zorblax Coffee Roasters';
const CATEGORY = 'Quillfeather Dining';
const TOKEN_BOOK = 'b'.repeat(32);
const ROOT = 'r'.repeat(32);
const EXP = 'e'.repeat(32);
const DIN = 'd'.repeat(32);
const TX = 'a1'.repeat(16);

const state = vi.hoisted(() => ({
    aiRow: null as Record<string, unknown> | null,
    mcpDetail: 'summary' as string | undefined,
}));

const { queryRawMock, detectRecurringChargesMock } = vi.hoisted(() => ({
    queryRawMock: vi.fn(),
    detectRecurringChargesMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    query: vi.fn(async (sql: string) => {
        if (/gnucash_web_ai_config/.test(sql)) return { rows: state.aiRow ? [state.aiRow] : [] };
        return { rows: [] };
    }),
    toDecimal: vi.fn(),
}));
vi.mock('@/lib/ai-privacy/names-source', () => ({
    loadNamesSource: vi.fn(async () => ({
        accounts: [
            { name: 'Expenses', fullname: 'Expenses' },
            { name: CATEGORY, fullname: `Expenses:${CATEGORY}` },
        ],
        descriptions: [{ description: MERCHANT }],
        commodities: [],
    })),
}));
vi.mock('@/lib/api-tokens', () => ({
    authenticateBearer: vi.fn(async () => ({
        user: { id: 7, username: 'owner' },
        role: 'readonly',
        bookGuid: TOKEN_BOOK,
        mcpDetail: state.mcpDetail,
    })),
    parseBearerToken: (header: string | null) => {
        const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
        return match && match[1].startsWith('gcw_') ? match[1] : null;
    },
}));
vi.mock('@/lib/book-scope', () => ({ getAccountGuidsForBook: vi.fn(async () => [ROOT, EXP, DIN]) }));
vi.mock('@/lib/recurring-detection', () => ({ detectRecurringCharges: detectRecurringChargesMock }));
vi.mock('@/lib/prisma', () => ({
    default: {
        $queryRaw: queryRawMock,
        books: { findUnique: vi.fn(async () => ({ root_account_guid: ROOT })) },
        accounts: {
            findMany: vi.fn(async () => [
                { guid: ROOT, name: 'Root Account', account_type: 'ROOT', parent_guid: null, hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
                { guid: EXP, name: 'Expenses', account_type: 'EXPENSE', parent_guid: ROOT, hidden: 0, placeholder: 1, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
                { guid: DIN, name: CATEGORY, account_type: 'EXPENSE', parent_guid: EXP, hidden: 0, placeholder: 0, commodity_guid: 'usd', commodity: { mnemonic: 'USD', namespace: 'CURRENCY' } },
            ]),
        },
        splits: {
            findMany: vi.fn(async () => [
                { tx_guid: TX, account_guid: DIN, memo: '', quantity_num: 1873420n, quantity_denom: 100000n, reconcile_state: 'n' },
            ]),
        },
    },
}));

import { handleMcpPost } from '../server';
import { clearNamesCache } from '@/lib/ai-privacy/gate';

const DETECTION = {
    series: [{
        merchantKey: 'zorblax', merchantLabel: MERCHANT, cadence: 'monthly', medianIntervalDays: 30,
        occurrences: 6, currentAmount: 18.73, typicalAmount: 18.73, amountChangePct: 2.5,
        firstSeen: '2026-05-14', lastSeen: '2026-10-14', nextExpected: '2026-11-14', status: 'active',
        monthlyEquivalent: 18.73, accountGuid: DIN, accountName: `Expenses:${CATEGORY}`,
    }],
    totals: { activeCount: 1, activeMonthlyTotal: 18.73, activeAnnualTotal: 224.76, priceIncreaseCount: 1, totalSeries: 1 },
};

function configure(mode: 'off' | 'summary' | 'full' | undefined, detail: string | undefined) {
    state.aiRow = mode === undefined ? null : { user_id: 7, enabled: false, privacy_mode: mode, self_hosted: false };
    state.mcpDetail = detail;
}

async function call(name: string, args: Record<string, unknown>) {
    const response = await handleMcpPost(new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: 'Bearer gcw_0123456789abcdef0123456789abcdef',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }));
    const json = await response.json();
    return json.result as { isError?: boolean; content: Array<{ text: string }> };
}

/** Every value of a Prisma.Sql tree (the bind parameters a query would send). */
function sqlValues(v: unknown, out: unknown[] = []): unknown[] {
    if (Array.isArray(v)) v.forEach(x => sqlValues(x, out));
    else if (v && typeof v === 'object' && 'values' in (v as object)) sqlValues((v as { values: unknown[] }).values, out);
    else out.push(v);
    return out;
}

beforeEach(() => {
    vi.clearAllMocks();
    clearNamesCache();
    detectRecurringChargesMock.mockResolvedValue(DETECTION);
    queryRawMock.mockResolvedValue([{ guid: TX, post_date: new Date('2026-10-14T00:00:00Z'), num: '', description: MERCHANT }]);
});

/* ------------------------------------------------------------------ */
/* Pure                                                                */
/* ------------------------------------------------------------------ */

describe('externalLevel: the stricter of owner mode and token detail', () => {
    it.each([
        ['off', 'summary', 'off'],
        ['off', 'full', 'off'],
        ['summary', 'summary', 'summary'],
        ['summary', 'full', 'summary'],
        ['full', 'summary', 'summary'],
        ['full', 'full', 'full'],
    ] as const)('mode %s + detail %s = %s', (mode, detail, level) => {
        expect(externalLevel(mode, detail)).toBe(level);
    });

    it('parses the stored detail: only exactly "full" is full', () => {
        expect(parseMcpDetail('full')).toBe('full');
        expect(parseMcpDetail('FULL')).toBe('summary');
        expect(parseMcpDetail(undefined)).toBe('summary');
    });
});

describe('scrubMcpResult', () => {
    it('tokenises names, rounds money, keeps counts/percentages/codes/GUIDs, reduces dates', () => {
        const names = newNames();
        const out = scrubMcpResult({
            reportCurrency: 'USD',
            asOf: '2026-10-14',
            signConvention: 'Amounts are in natural sign: income earned is positive.',
            totalMatching: 17,
            accounts: [{ guid: DIN, path: `Expenses:${CATEGORY}`, type: 'EXPENSE', commodity: 'USD', ownBalance: 1873.42, totalValue: 45678.91, placeholder: true }],
            series: [{ merchant: MERCHANT, cadence: 'monthly', currentAmount: 18.73, amountChangePct: 2.5, occurrences: 6, nextExpected: '2026-11-14' }],
            months: [{ month: '2026-10', income: 8000.01 }],
            transactions: [{ guid: TX, date: '2026-10-14', description: MERCHANT, splits: [{ account: `Expenses:${CATEGORY}`, amount: -18.73, reconciled: 'n', memo: 'latte' }] }],
            items: [{ id: 'fix:1', lane: 'fix', severity: 'warning', title: `${MERCHANT} charged $1,873.42 on 2026-10-14`, impact: { low: 1873.42, high: 2345.67, period: 'month' } }],
        }, names) as Record<string, unknown>;

        const text = JSON.stringify(out);
        expect(text).not.toContain(MERCHANT);
        expect(text).not.toContain(CATEGORY);
        expect(text).not.toMatch(/1873\.42|45678\.91|2345\.67|18\.73|2026-10-14|2026-11-14|latte/);

        expect(out.reportCurrency).toBe('USD');
        expect(out.asOf).toBe('2026-10');
        expect(out.signConvention).toBe('Amounts are in natural sign: income earned is positive.');
        expect(out.totalMatching).toBe(17);
        const account = (out.accounts as Array<Record<string, unknown>>)[0];
        expect(account).toEqual({ guid: DIN, path: 'Expenses:⟨A1⟩', type: 'EXPENSE', commodity: 'USD', ownBalance: 1900, totalValue: 45700, placeholder: true });
        const s = (out.series as Array<Record<string, unknown>>)[0];
        expect(s).toEqual({ merchant: '⟨M1⟩', cadence: 'monthly', currentAmount: 20, amountChangePct: 2.5, occurrences: 6, nextExpected: '2026-11' });
        expect((out.months as Array<Record<string, unknown>>)[0]).toEqual({ month: '2026-10', income: 8000 });
        const tx = (out.transactions as Array<Record<string, unknown>>)[0];
        expect(tx.guid).toBe(TX);
        expect(tx.description).toBe('⟨M1⟩'); // the same name keeps the same token
        expect(tx.splits).toEqual([{ account: 'Expenses:⟨A1⟩', amount: -20, reconciled: 'n', memo: '⟨M2⟩' }]);
        const item = (out.items as Array<Record<string, unknown>>)[0];
        expect(item.lane).toBe('fix');
        expect(item.title).toBe('⟨M1⟩ charged about $1,900 on 2026-10');
        expect(item.impact).toEqual({ low: 1900, high: 2300, period: 'month' });
    });

    it('keeps counts, fractions and period labels that look like money columns to the generic rules', () => {
        const out = scrubMcpResult({
            summary: { new: 3, resolved: 1, automated: 0, overdue: 2 },
            items: [{ confidence: 0.8 }],
            period: { periodNum: 9, start: '2026-10-01', end: '2026-10-31', label: 'Oct 2026' },
            scope: 'current period',
        }, newNames());
        expect(out).toEqual({
            summary: { new: 3, resolved: 1, automated: 0, overdue: 2 },
            items: [{ confidence: 0.8 }],
            period: { periodNum: 9, start: '2026-10', end: '2026-10', label: 'Oct 2026' },
            scope: 'current period',
        });
    });

    it('scrubs tool error text', () => {
        const names = newNames();
        ph(names, 'Account', CATEGORY);
        expect(scrubMcpText(`"${CATEGORY}" matches 2 accounts`, names)).toBe('"⟨A1⟩" matches 2 accounts');
    });
});

describe('unmaskToolArgs', () => {
    it('swaps exact tokens inside any string argument, including account paths', () => {
        const names = newNames();
        const m = ph(names, 'Merchant', MERCHANT);
        const a = ph(names, 'Account', CATEGORY);
        expect(unmaskToolArgs({ text: m, account: `Expenses:${a}`, limit: 5, types: ['EXPENSE'] }, names)).toEqual({
            args: { text: MERCHANT, account: `Expenses:${CATEGORY}`, limit: 5, types: ['EXPENSE'] },
            unknown: [],
        });
    });

    it('reports a token it never issued and leaves it in place', () => {
        expect(unmaskToolArgs({ text: '⟨M9⟩' }, newNames())).toEqual({ args: { text: '⟨M9⟩' }, unknown: ['⟨M9⟩'] });
    });
});

/* ------------------------------------------------------------------ */
/* End to end through the real gate                                    */
/* ------------------------------------------------------------------ */

describe('MCP through the gate', () => {
    it('off: every tools/call is refused and no tool runs', async () => {
        configure('off', 'full');
        const result = await call('recurring_charges', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/AI access is turned off in Settings/);
        expect(detectRecurringChargesMock).not.toHaveBeenCalled();
    });

    it('summary (the default for a new user and a new token): results are scrubbed', async () => {
        configure(undefined, undefined);
        const result = await call('recurring_charges', {});
        const text = result.content[0].text;
        expect(text).not.toContain(MERCHANT);
        expect(text).not.toContain(CATEGORY);
        expect(text).not.toMatch(/18\.73|224\.76|2026-10-14/);
        const payload = JSON.parse(text);
        expect(payload.series[0]).toMatchObject({ merchant: '⟨M1⟩', account: 'Expenses:⟨A1⟩', currentAmount: 20, lastSeen: '2026-10' });
        expect(payload.totals).toEqual({ activeCount: 1, activeMonthlyTotal: 20, activeAnnualTotal: 220, priceIncreaseCount: 1 });
    });

    it('summary: the model can drill into a token it was given', async () => {
        configure('summary', 'full'); // full token detail is capped by the owner's summary mode
        const listed = JSON.parse((await call('recurring_charges', {})).content[0].text);
        const token = listed.series[0].merchant as string;
        expect(token).toBe('⟨M1⟩');

        const result = await call('search_transactions', { text: token });
        expect(result.isError).toBeUndefined();
        // The query ran with the REAL name...
        const values = sqlValues(queryRawMock.mock.calls[0].slice(1));
        expect(values).toContain(`%${MERCHANT}%`);
        // ...and the answer went back scrubbed.
        const payload = JSON.parse(result.content[0].text);
        expect(payload.transactions[0]).toMatchObject({ guid: TX, date: '2026-10', description: token });
        expect(payload.transactions[0].splits[0]).toMatchObject({ account: 'Expenses:⟨A1⟩', amount: 20 });
    });

    it('summary: an unknown token is refused instead of searched for', async () => {
        configure('summary', 'summary');
        const result = await call('search_transactions', { text: '⟨M77⟩' });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Unknown placeholder ⟨M77⟩/);
        expect(queryRawMock).not.toHaveBeenCalled();
    });

    it('summary: a tool error that echoes a name is scrubbed too', async () => {
        configure('summary', 'summary');
        const miss = await call('account_balance_history', { account: `${CATEGORY} Annex` });
        expect(miss.isError).toBe(true);
        expect(miss.content[0].text).not.toContain(CATEGORY);
        expect(miss.content[0].text).toMatch(/No account matches "⟨A1⟩ Annex"/);
    });

    it('full detail needs BOTH the owner mode and the token detail', async () => {
        configure('full', 'summary');
        const capped = (await call('recurring_charges', {})).content[0].text;
        expect(capped).not.toContain(MERCHANT);

        configure('full', 'full');
        const full = JSON.parse((await call('recurring_charges', {})).content[0].text);
        expect(full.series[0]).toMatchObject({ merchant: MERCHANT, account: `Expenses:${CATEGORY}`, currentAmount: 18.73, lastSeen: '2026-10-14' });
        expect(full.totals.activeAnnualTotal).toBe(224.76);
    });

    it('full: tool inputs pass through untouched (no unmasking)', async () => {
        configure('full', 'full');
        await call('search_transactions', { text: '⟨M1⟩' });
        expect(sqlValues(queryRawMock.mock.calls[0].slice(1))).toContain('%⟨M1⟩%');
    });
});
