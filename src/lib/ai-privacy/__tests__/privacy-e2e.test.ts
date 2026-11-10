/**
 * Privacy end to end (Folio's version of broke's privacy-e2e).
 *
 * A local `http` server plays an OpenAI-compatible chat endpoint and records
 * every request body. The real config loader (DB mocked), the real gate, the
 * real chatComplete client and the real gated flows run against fixture data
 * with distinctive fake names and exact, unrounded amounts:
 *
 *   - Ask your books (route: generate → unmask SQL → guardrails → execute (mocked) → answer)
 *   - digest narrative
 *   - insights polish
 *   - AI rule suggestions (suggestRulesWithAi: tokens out, validated proposals back)
 *   - AI budget suggestions (suggestBudgetChangesWithAi: tokens + rounded actuals out)
 *   - receipt extraction (exempt)
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/* Fixture data                                                        */
/* ------------------------------------------------------------------ */

const MERCHANT = 'Zorblax Coffee Roasters';
const MERCHANT_2 = 'Vantablack Hardware Emporium';
const ACCOUNT = 'Zephyrine Credit Union Checking';
const CATEGORY = 'Quillfeather Dining';
const COMMODITY = 'Quixotic Total Market';
const REAL_NAMES = [MERCHANT, MERCHANT_2, ACCOUNT, CATEGORY, COMMODITY];
const EXACT_AMOUNTS = ['1873.42', '1,873.42', '987.65', '45678.91', '45,678.91', '73.21', '123456.78', '123,456.78', '2345.67', '2,345.67'];
const EXACT_DATE = '2026-10-14';
const GUID_A = 'a1'.repeat(16);
const GUIDS = [GUID_A, 'b2'.repeat(16)];

const state = vi.hoisted(() => ({
    row: null as Record<string, unknown> | null,
    executedSql: [] as string[],
}));

// Accounts for the suggestion flows (rule targets, budget lines).
const BOOK_ROOT = 'f0'.repeat(16);
const EXP_GUID = 'e1'.repeat(16);
const CAT_GUID = 'c1'.repeat(16);
const CHK_GUID = 'd1'.repeat(16);
const BOOK_ACCOUNT_ROWS = [
    { guid: BOOK_ROOT, name: 'Root Account', account_type: 'ROOT', parent_guid: null, placeholder: 0, hidden: 0 },
    { guid: EXP_GUID, name: 'Expenses', account_type: 'EXPENSE', parent_guid: BOOK_ROOT, placeholder: 1, hidden: 0 },
    { guid: CAT_GUID, name: CATEGORY, account_type: 'EXPENSE', parent_guid: EXP_GUID, placeholder: 0, hidden: 0 },
    { guid: CHK_GUID, name: ACCOUNT, account_type: 'BANK', parent_guid: BOOK_ROOT, placeholder: 0, hidden: 0 },
];

const suggestMocks = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    budgetGetById: vi.fn(),
    sumByMonth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    query: vi.fn(async (sql: string) => {
        if (/gnucash_web_ai_config/.test(sql)) return { rows: state.row ? [state.row] : [] };
        return { rows: [] };
    }),
    toDecimal: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
    default: {
        $queryRaw: suggestMocks.queryRaw,
        $executeRaw: vi.fn(),
        books: { findUnique: vi.fn(async () => ({ root_account_guid: BOOK_ROOT })) },
        accounts: { findMany: vi.fn(async () => BOOK_ACCOUNT_ROWS) },
    },
}));
vi.mock('@/lib/currency', () => ({
    getBaseCurrency: vi.fn(async () => ({ mnemonic: 'USD' })),
    getBaseCurrencyForBook: vi.fn(async () => ({ mnemonic: 'USD' })),
}));
vi.mock('@/lib/services/categorization.service', () => ({
    listRules: vi.fn(async () => []),
    suggestRules: vi.fn(async () => []),
}));
vi.mock('@/lib/services/budget.service', () => ({ BudgetService: { getById: suggestMocks.budgetGetById } }));
vi.mock('@/lib/reports/utils', async (orig) => ({
    ...(await orig<typeof import('@/lib/reports/utils')>()),
    sumSplitsByAccountAndMonth: suggestMocks.sumByMonth,
}));
vi.mock('@/lib/services/financial-summary.service', () => ({ FinancialSummaryService: {} }));
vi.mock('@/lib/ai-privacy/names-source', () => ({
    loadNamesSource: vi.fn(async () => ({
        accounts: [
            { name: 'Expenses', fullname: 'Expenses' },
            { name: CATEGORY, fullname: `Expenses:${CATEGORY}` },
            { name: ACCOUNT, fullname: `Assets:${ACCOUNT}` },
        ],
        descriptions: [{ description: MERCHANT }, { description: MERCHANT_2 }],
        commodities: [{ mnemonic: 'QXZT', fullname: COMMODITY }],
    })),
}));
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ user: { id: 7 }, bookGuid: 'book1' })) }));
vi.mock('@/lib/book-scope', () => ({
    getBookAccountGuids: vi.fn(async () => GUIDS),
    getAccountGuidsForBook: vi.fn(async () => GUIDS),
}));
vi.mock('@/lib/family-office/service', () => ({ getAuthorizedFamilyGraph: vi.fn() }));
vi.mock('@/lib/ai-query/execute', () => ({
    executeReadOnlyQuery: vi.fn(async (sql: string) => {
        state.executedSql.push(sql);
        return [{
            description: MERCHANT,
            account_guid: GUID_A,
            account_name: ACCOUNT,
            total_spent: '1873.42',
            txn_count: 17,
            last_date: `${EXACT_DATE}T00:00:00.000Z`,
        }];
    }),
}));

import { POST as askPost } from '@/app/api/ai/query/route';
import { generateGatedDigestNarrative } from '@/lib/digest-narrative';
import { detectBalanceDrops, detectNewMerchants, polishInsightsGated } from '@/lib/insights';
import { extractReceiptData } from '@/lib/receipt-extraction';
import { getAiConfig } from '@/lib/ai-config';
import { clearNamesCache } from '@/lib/ai-privacy/gate';
import { suggestRulesWithAi } from '@/lib/ai-suggest/rule-suggest';
import { suggestBudgetChangesWithAi } from '@/lib/ai-suggest/budget-suggest';
import { completeMonths } from '@/lib/ai-suggest/budget-proposals';
import type { MonthlyDigest } from '@/lib/digest';
import type { NextRequest } from 'next/server';

/* ------------------------------------------------------------------ */
/* Fake OpenAI-compatible endpoint                                     */
/* ------------------------------------------------------------------ */

interface Captured {
    raw: string;
    messages: Array<{ role: string; content: string }>;
}
const captured: Captured[] = [];
let invent = false;
let server: http.Server;
let baseUrl = '';

const TOKEN_M = /⟨M\d+⟩/;

function reply(messages: Array<{ role: string; content: string }>): string {
    const system = messages[0]?.content ?? '';
    const user = messages[messages.length - 1]?.content ?? '';
    if (system.includes('SQL analyst')) {
        const who = TOKEN_M.exec(user)?.[0] ?? MERCHANT;
        return JSON.stringify({
            sql: 'SELECT t.description, ROUND(SUM(s.value_num::numeric / s.value_denom), 2) AS total_spent '
                + 'FROM book_transactions t JOIN book_splits s ON s.tx_guid = t.guid '
                + `WHERE t.description ILIKE '%${who}%' GROUP BY t.description LIMIT 10`,
            plan: 'Sum spend for the merchant.',
        });
    }
    if (system.includes('personal-finance assistant')) {
        const payload = JSON.parse(user) as { rows: Array<Record<string, unknown>> };
        const row = payload.rows[0];
        const total = Number(row.total_spent).toLocaleString('en-US');
        return JSON.stringify({
            answer: invent
                ? `You spent $${total} at ${row.description}, plus $4,321.00 elsewhere.`
                : `You spent $${total} at ${row.description} over ${row.txn_count} visits.`,
            ledger_search: row.description,
            accounts: [{ guid: row.account_guid, name: row.account_name }],
        });
    }
    if (system.includes('narrative summary')) {
        const p = JSON.parse(user) as { netWorth: { end: number; change: number }; topCategories: Array<{ name: string; amount: number }> };
        const fig = (n: number) => `$${n.toLocaleString('en-US')}`;
        return `Net worth rose by ${fig(p.netWorth.change)} to ${fig(p.netWorth.end)}. `
            + `${p.topCategories[0].name} led spending at ${fig(p.topCategories[0].amount)}.`
            + (invent ? ' You also saved $9,999.' : '');
    }
    if (system.includes('rewrite short personal-finance insight')) {
        const items = JSON.parse(user) as Array<{ i: number; title: string; detail: string }>;
        return JSON.stringify({
            items: items.map(it => ({
                i: it.i,
                title: `Heads up: ${it.title}`,
                detail: invent && it.i === 0 ? `${it.detail} That is $7,777 more than usual.` : it.detail,
            })),
        });
    }
    if (system.includes('You suggest categorization rules')) {
        const p = JSON.parse(user) as { descriptions: Array<{ d: string }>; accounts: Array<{ a: string }> };
        return JSON.stringify({
            rules: [
                { match: p.descriptions[0].d, account: p.accounts[0].a, why: 'A coffee roaster.' },
                // A token the server never issued: dropped, never guessed.
                { match: p.descriptions[0].d, account: 'Expenses:⟨A999⟩' },
            ],
        });
    }
    if (system.includes('You review a personal budget')) {
        const p = JSON.parse(user) as { lines: Array<{ a: string; budget: number; actuals: number[] }> };
        const line = p.lines[0];
        const spent = line.actuals[0].toLocaleString('en-US');
        return JSON.stringify({
            changes: [{
                account: line.a,
                amount: line.budget + 60,
                why: invent ? `${line.a} overshot by $4,321.` : `${line.a} ran $${spent} in one month.`,
            }],
        });
    }
    if (system.includes('Extract structured data from this receipt')) {
        return JSON.stringify({ amount: 1873.42, currency: 'USD', date: EXACT_DATE, vendor: MERCHANT });
    }
    return 'unexpected';
}

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c as Buffer));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> };
            captured.push({ raw, messages: body.messages });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply(body.messages) } }] }));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    // jsdom swaps in its own AbortSignal, which Node's fetch rejects. Keep the
    // real network call, minus the timeout signal.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => realFetch(input, { ...init, signal: undefined }));
});

afterAll(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
    captured.length = 0;
    state.executedSql.length = 0;
    invent = false;
    clearNamesCache();

    // Rule suggestions: payee history and the transaction total.
    suggestMocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        if (sql.includes('AS payee')) {
            return [
                { description: MERCHANT, count: 2, uncategorized: 2 },
                { description: MERCHANT_2, count: 1, uncategorized: 1 },
            ];
        }
        if (sql.includes('COUNT(DISTINCT s.tx_guid)')) return [{ n: 40 }];
        return [];
    });
    // Budget suggestions: one monthly line with exact amounts and exact actuals.
    suggestMocks.budgetGetById.mockResolvedValue({
        num_periods: 12,
        recurrence: { period_type: 'month', mult: 1 },
        amounts: Array.from({ length: 12 }, (_, p) => ({ account_guid: CAT_GUID, period_num: p, amount_decimal: '987.65' })),
    });
    const { months } = completeMonths(new Date(), 3);
    suggestMocks.sumByMonth.mockResolvedValue([
        { month: months[0], accountGuid: CAT_GUID, quantity: 1873.42 },
        { month: months[1], accountGuid: CAT_GUID, quantity: 73.21 },
        { month: months[2], accountGuid: CAT_GUID, quantity: 2345.67 },
    ]);
});

async function runSuggestionFlows() {
    const rules = await suggestRulesWithAi({ userId: 7, bookGuid: 'book1' });
    const budget = await suggestBudgetChangesWithAi({ userId: 7, bookGuid: 'book1', budgetGuid: 'ab'.repeat(16) });
    return { rules, budget };
}

function configure(privacyMode: 'off' | 'summary' | 'full' | undefined, selfHosted = false) {
    state.row = {
        user_id: 7,
        provider: 'custom',
        base_url: baseUrl,
        api_key_encrypted: null,
        model: 'fake-model',
        enabled: true,
        // undefined = a row saved before the setting existed
        ...(privacyMode === undefined ? {} : { privacy_mode: privacyMode }),
        self_hosted: selfHosted,
    };
}

/* ------------------------------------------------------------------ */
/* Flows                                                               */
/* ------------------------------------------------------------------ */

async function ask(question = `How much did I spend at ${MERCHANT}?`) {
    const req = new Request('http://localhost/api/ai/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            question,
            history: [{ role: 'assistant', content: `Earlier: ${ACCOUNT} held $45,678.91 on ${EXACT_DATE}.` }],
        }),
    });
    const res = await askPost(req as unknown as NextRequest);
    return { status: res.status, body: await res.json() };
}

function digestFixture(): MonthlyDigest {
    return {
        month: '2026-10',
        monthLabel: 'October 2026',
        generatedAt: `${EXACT_DATE}T00:00:00.000Z`,
        currency: 'USD',
        netWorth: { end: 123456.78, change: 2345.67, changePercent: 1.94 },
        cashFlow: { income: 8000.01, expenses: 5500.25, savingsRate: 31.25 },
        topCategories: [{ name: CATEGORY, amount: 987.65, priorAmount: 900.12, delta: 87.53, percent: 9.72 }],
        subscriptions: {
            new: [{
                label: MERCHANT, accountName: `Expenses:${CATEGORY}`, cadence: 'monthly', currentAmount: 73.21,
                previousAmount: 0, changePercent: 0, lastSeen: EXACT_DATE, nextExpected: '2026-11-14',
            }],
            changed: [],
            stopped: [],
        },
        upcomingBills: [],
        budget: null,
    };
}

function insightFixture() {
    return [
        ...detectNewMerchants('2026-10', [{ description: MERCHANT_2, firstDate: EXACT_DATE, firstAmount: 987.65 }]),
        ...detectBalanceDrops('2026-W42', [{ guid: GUID_A, name: ACCOUNT, current: 1873.42, weekAgo: 45678.91 }]),
    ];
}

async function runGatedFlows() {
    const askResult = await ask();
    const narrative = await generateGatedDigestNarrative(digestFixture(), { userId: 7, bookGuid: 'book1' });
    const insights = await polishInsightsGated(insightFixture(), { userId: 7, bookGuid: 'book1' });
    return { askResult, narrative, insights };
}

function leaks(): string[] {
    const found: string[] = [];
    for (const c of captured) {
        // Inspect the decoded message text, not just the JSON envelope.
        const text = c.messages.map(m => m.content).join('\n');
        const at = (s: string) => text.slice(Math.max(0, text.indexOf(s) - 60), text.indexOf(s) + s.length + 10);
        for (const n of REAL_NAMES) if (text.includes(n)) found.push(`name: ${n} in "${at(n)}"`);
        for (const a of EXACT_AMOUNTS) if (text.includes(a)) found.push(`amount: ${a} in "${at(a)}"`);
        if (text.includes(EXACT_DATE)) found.push(`date: ${EXACT_DATE} in "${at(EXACT_DATE)}"`);
    }
    return found;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('privacy e2e: summary mode (the default)', () => {
    it('sends no real names, exact amounts or exact dates, and unmasks replies', async () => {
        configure(undefined); // pre-existing row with no privacy_mode column value
        const { askResult, narrative, insights } = await runGatedFlows();

        expect(captured.length).toBe(4); // ask generate + answer, narrative, polish
        expect(leaks()).toEqual([]);
        // Tokens did go out instead.
        expect(captured.some(c => /⟨M\d+⟩/.test(c.raw) || /\\u27e8M\d+\\u27e9/.test(c.raw))).toBe(true);

        // Ask: the SQL token was unmasked BEFORE the guardrails, so the real name ran.
        expect(askResult.status).toBe(200);
        expect(state.executedSql).toHaveLength(1);
        expect(state.executedSql[0]).toContain(`ILIKE '%${MERCHANT}%'`);
        expect(askResult.body.sql).toContain(MERCHANT);
        expect(askResult.body.answer).toBe(`You spent $1,900 at ${MERCHANT} over 17 visits.`);
        expect(askResult.body.links).toEqual([
            { label: ACCOUNT, href: `/accounts/${GUID_A}` },
            { label: `Search ledger: "${MERCHANT}"`, href: `/ledger?search=${encodeURIComponent(MERCHANT)}` },
        ]);
        // The table the user sees keeps the exact rows.
        expect(askResult.body.rows[0].total_spent).toBe('1873.42');
        expect(askResult.body.privacy).toBe('summary');

        expect(narrative?.narrative).toBe(`Net worth rose by $2,300 to $123,500. ${CATEGORY} led spending at $990.`);

        expect(insights[0].title).toBe(`Heads up: New merchant: ${MERCHANT_2}`);
        expect(insights[0].detail).toBe(`First charge of about $990 from "${MERCHANT_2}" on 2026-10. You have not paid this merchant before.`);
        expect(insights[1].title).toBe(`Heads up: ${ACCOUNT} balance down 96% this week`);
    });

    it('drops model text that brings a figure the code never sent', async () => {
        configure('summary');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invent = true;
        const { askResult, narrative, insights } = await runGatedFlows();
        expect(askResult.body.answer).toBe('The query returned 1 row — see the result table below.');
        expect(narrative).toBeNull();
        // Item 0 invented a figure: template text kept. Item 1 is clean: polished.
        expect(insights[0].title).toBe(`New merchant: ${MERCHANT_2}`);
        expect(insights[1].title).toBe(`Heads up: ${ACCOUNT} balance down 96% this week`);
        const paths = warn.mock.calls.map(c => String(c[0]));
        expect(paths.some(p => p.includes('ask-answer'))).toBe(true);
        expect(paths.some(p => p.includes('digest-narrative'))).toBe(true);
        expect(paths.some(p => p.includes('insights-polish'))).toBe(true);
        warn.mockRestore();
    });
});

describe('privacy e2e: off mode', () => {
    it('makes zero model requests on every gated path', async () => {
        configure('off');
        const { askResult, narrative, insights } = await runGatedFlows();
        expect(captured).toHaveLength(0);
        expect(askResult.status).toBe(400);
        expect(askResult.body.error).toMatch(/AI analysis is off/);
        expect(narrative).toBeNull();
        expect(insights).toEqual(insightFixture());
    });
});

describe('privacy e2e: full mode', () => {
    it('sends full detail to an endpoint marked self-hosted', async () => {
        configure('full', true);
        const { askResult, narrative } = await runGatedFlows();
        expect(captured).toHaveLength(4);
        const all = captured.map(c => c.messages.map(m => m.content).join('\n')).join('\n');
        expect(all).toContain(MERCHANT);
        expect(all).toContain('1873.42');
        expect(all).toContain(ACCOUNT);
        expect(askResult.body.answer).toBe(`You spent $1,873.42 at ${MERCHANT} over 17 visits.`);
        expect(askResult.body.privacy).toBe('full');
        expect(narrative?.narrative).toBe(`Net worth rose by $2,345.67 to $123,456.78. ${CATEGORY} led spending at $987.65.`);
    });

    it('still sends only the summary to an endpoint not marked self-hosted', async () => {
        configure('full', false);
        const { askResult } = await runGatedFlows();
        expect(captured).toHaveLength(4);
        expect(leaks()).toEqual([]);
        expect(askResult.body.privacy).toBe('summary');
    });
});

describe('privacy e2e: AI suggestions you apply yourself', () => {
    it('summary: sends no names or exact amounts, and returns unmasked, validated proposals', async () => {
        configure('summary');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { rules, budget } = await runSuggestionFlows();
        warn.mockRestore();

        expect(captured).toHaveLength(2);
        expect(leaks()).toEqual([]);
        expect(captured.every(c => /⟨[MA]\d+⟩/.test(c.messages.map(m => m.content).join('\n')))).toBe(true);

        expect(rules.ok).toBe(true);
        if (!rules.ok) return;
        expect(rules.level).toBe('summary');
        expect(rules.proposals).toEqual([{
            match: MERCHANT,
            matchType: 'contains',
            accountGuid: CAT_GUID,
            accountPath: `Expenses:${CATEGORY}`,
            accountType: 'EXPENSE',
            why: 'A coffee roaster.',
            matchCount: 2,
            uncategorizedCount: 2,
            share: 0.05,
            samples: [MERCHANT],
        }]);
        expect(rules.reasons).toEqual({ 'unknown-token': 1 });

        expect(budget.ok).toBe(true);
        if (!budget.ok) return;
        expect(budget.level).toBe('summary');
        // The model saw 990 (987.65 rounded) and proposed 990 + 60.
        expect(budget.proposals).toEqual([{
            accountGuid: CAT_GUID,
            accountPath: `Expenses:${CATEGORY}`,
            accountType: 'EXPENSE',
            from: 987.65,
            fromVaries: false,
            to: 1050,
            rawTo: 1050,
            why: `Expenses:${CATEGORY} ran $1,900 in one month.`,
            requires: [],
        }]);
    });

    it('drops a budget why that brings a figure the code never sent', async () => {
        configure('summary');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invent = true;
        const { budget } = await runSuggestionFlows();
        expect(budget.ok && budget.proposals[0].why).toBeNull();
        expect(budget.ok && budget.whyDropped).toBe(1);
        expect(warn.mock.calls.some(c => String(c[0]).includes('budget-suggest'))).toBe(true);
        warn.mockRestore();
    });

    it('off: no model request on either path', async () => {
        configure('off');
        const { rules, budget } = await runSuggestionFlows();
        expect(captured).toHaveLength(0);
        expect(rules).toEqual({ ok: false, reason: 'off' });
        expect(budget).toEqual({ ok: false, reason: 'off' });
    });

    it('full on a self-hosted endpoint: real names and exact amounts go out', async () => {
        configure('full', true);
        const { rules, budget } = await runSuggestionFlows();
        expect(captured).toHaveLength(2);
        const all = captured.map(c => c.messages.map(m => m.content).join('\n')).join('\n');
        expect(all).toContain(MERCHANT);
        expect(all).toContain(CATEGORY);
        expect(all).toContain('987.65');
        expect(all).toContain('1873.42');
        expect(rules.ok && rules.proposals[0].match).toBe(MERCHANT);
        expect(budget.ok && budget.proposals[0]).toMatchObject({ to: 1048, why: `Expenses:${CATEGORY} ran $1,873.42 in one month.` });
    });
});

describe('privacy e2e: exempt document extraction', () => {
    it.each(['off', 'summary'] as const)('receipt extraction still sends the document text in %s mode', async mode => {
        configure(mode);
        const ocr = `${MERCHANT}\n${EXACT_DATE}\nTOTAL $1,873.42`;
        const result = await extractReceiptData(ocr, await getAiConfig(7));
        expect(captured).toHaveLength(1);
        expect(captured[0].messages[1].content).toBe(ocr);
        expect(result.extraction_method).toBe('ai');
        expect(result.amount).toBe(1873.42);
    });
});
