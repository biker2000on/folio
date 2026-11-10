import { describe, expect, it } from 'vitest';
import { newNames, ph, unmask, unmaskStrict } from '@/lib/ai-privacy/privacy';
import {
    MAX_BUDGET_AMOUNT,
    MAX_BUDGET_PROPOSALS,
    ancestorsOf,
    branchConflicts,
    budgetKnownNumbers,
    buildBudgetMessages,
    buildBudgetPromptPayload,
    completeMonths,
    lineState,
    periodMonthsOf,
    rollUpMonthly,
    toRawBudgetAmount,
    validateBudgetProposals,
    type BudgetAccount,
    type BudgetLineState,
    type BudgetValidationContext,
} from '../budget-proposals';

const G = (c: string) => c.repeat(32);

//   Expenses (e)
//     Food (f)
//       Groceries (g)
//       Dining (d)
//     Housing (h)
//   Income (i)
//     Salary (s)
//   Assets (a) > Checking (k)   [BANK]
//   Equity (q)                  [EQUITY, not budgetable]
const ACCOUNTS: BudgetAccount[] = [
    { guid: G('e'), path: 'Expenses', name: 'Expenses', type: 'EXPENSE', parentGuid: null },
    { guid: G('f'), path: 'Expenses:Food', name: 'Food', type: 'EXPENSE', parentGuid: G('e') },
    { guid: G('g'), path: 'Expenses:Food:Groceries', name: 'Groceries', type: 'EXPENSE', parentGuid: G('f') },
    { guid: G('d'), path: 'Expenses:Food:Dining', name: 'Dining', type: 'EXPENSE', parentGuid: G('f') },
    { guid: G('h'), path: 'Expenses:Housing', name: 'Housing', type: 'EXPENSE', parentGuid: G('e') },
    { guid: G('i'), path: 'Income', name: 'Income', type: 'INCOME', parentGuid: null },
    { guid: G('s'), path: 'Income:Salary', name: 'Salary', type: 'INCOME', parentGuid: G('i') },
    { guid: G('a'), path: 'Assets', name: 'Assets', type: 'ASSET', parentGuid: null },
    { guid: G('k'), path: 'Assets:Checking', name: 'Checking', type: 'BANK', parentGuid: G('a') },
    { guid: G('q'), path: 'Equity', name: 'Equity', type: 'EQUITY', parentGuid: null },
];
const BY_GUID = new Map(ACCOUNTS.map(a => [a.guid, a]));

const LINES: BudgetLineState[] = [
    { accountGuid: G('f'), amount: 600, varies: false },     // Food (parent line)
    { accountGuid: G('h'), amount: 1500, varies: false },    // Housing
    { accountGuid: G('s'), amount: 5000, varies: true },     // Salary (periods differ)
];

function ctx(over: Partial<BudgetValidationContext> = {}): BudgetValidationContext {
    return {
        unmaskStrict: t => ({ text: t, unknown: [] }),
        unmask: t => t,
        accounts: ACCOUNTS,
        lines: LINES,
        knownNumbers: [600, 1500, 5000, 640, 610],
        ...over,
    };
}

describe('validateBudgetProposals: accepted changes', () => {
    it('updates an existing line, rounding to whole units', () => {
        const r = validateBudgetProposals([{ account: 'Expenses:Food', amount: 649.6, why: 'You spent about $640.' }], ctx());
        expect(r.dropped).toBe(0);
        expect(r.proposals).toEqual([{
            accountGuid: G('f'),
            accountPath: 'Expenses:Food',
            accountType: 'EXPENSE',
            from: 600,
            fromVaries: false,
            to: 650,
            rawTo: 650,
            why: 'You spent about $640.',
            requires: [],
        }]);
    });

    it('removes an existing line (amount null)', () => {
        const r = validateBudgetProposals([{ account: 'Expenses:Housing', amount: null }], ctx());
        expect(r.proposals[0]).toMatchObject({ from: 1500, to: null, rawTo: null });
    });

    it('adds a new line in an unbudgeted branch', () => {
        const r = validateBudgetProposals([{ account: 'Assets:Checking', amount: 200 }], ctx());
        expect(r.proposals[0]).toMatchObject({ from: null, to: 200, rawTo: 200, requires: [] });
    });

    it('stores income negative (GnuCash sign) and accepts 0 and the maximum', () => {
        const r = validateBudgetProposals([
            { account: 'Income:Salary', amount: 5200 },
            { account: 'Assets:Checking', amount: 0 },
        ], ctx());
        expect(r.proposals[0]).toMatchObject({ to: 5200, rawTo: -5200, fromVaries: true });
        expect(r.proposals[1]).toMatchObject({ to: 0, rawTo: 0 });
        const max = validateBudgetProposals([{ account: 'Assets:Checking', amount: MAX_BUDGET_AMOUNT }], ctx());
        expect(max.proposals[0].to).toBe(MAX_BUDGET_AMOUNT);
    });

    it('treats the same amount on a line whose periods vary as a real change (it evens them out)', () => {
        const r = validateBudgetProposals([{ account: 'Income:Salary', amount: 5000 }], ctx());
        expect(r.proposals).toHaveLength(1);
    });
});

describe('validateBudgetProposals: every rejection reason', () => {
    const cases: Array<[string, unknown[], string, Partial<BudgetValidationContext>?]> = [
        ['malformed (not an object)', ['Expenses:Food'], 'malformed'],
        ['malformed (no amount key)', [{ account: 'Expenses:Food' }], 'malformed'],
        ['malformed (account not a string)', [{ account: 7, amount: 1 }], 'malformed'],
        ['unknown account', [{ account: 'Expenses:Pets', amount: 50 }], 'unknown-account'],
        ['unknown token', [{ account: '⟨A9⟩', amount: 50 }], 'unknown-token', { unmaskStrict: t => unmaskStrict(t, newNames()) }],
        ['not budgetable (equity)', [{ account: 'Equity', amount: 50 }], 'not-budgetable'],
        ['negative amount', [{ account: 'Expenses:Food', amount: -5 }], 'bad-amount'],
        ['amount above the maximum', [{ account: 'Expenses:Food', amount: MAX_BUDGET_AMOUNT + 1 }], 'bad-amount'],
        ['non-finite amount', [{ account: 'Expenses:Food', amount: Number.POSITIVE_INFINITY }], 'bad-amount'],
        ['amount as a string', [{ account: 'Expenses:Food', amount: '650' }], 'bad-amount'],
        ['removing a line that is not there', [{ account: 'Assets:Checking', amount: null }], 'not-a-line'],
        ['no-op (same amount, even periods)', [{ account: 'Expenses:Food', amount: 600.4 }], 'no-op'],
    ];
    it.each(cases)('drops %s', (_label, raw, reason, over) => {
        const r = validateBudgetProposals(raw, ctx(over));
        expect(r.proposals).toEqual([]);
        expect(r.reasons).toEqual({ [reason]: 1 });
        expect(r.dropped).toBe(1);
    });

    it('drops a second change to the same account', () => {
        const r = validateBudgetProposals([
            { account: 'Expenses:Food', amount: 700 },
            { account: 'expenses:food', amount: 800 },
        ], ctx());
        expect(r.proposals.map(p => p.to)).toEqual([700]);
        expect(r.reasons).toEqual({ 'duplicate-proposal': 1 });
    });

    it('treats a non-array reply as nothing', () => {
        expect(validateBudgetProposals(null, ctx())).toMatchObject({ proposals: [], dropped: 0 });
    });
});

describe('validateBudgetProposals: budget-the-parent conflicts', () => {
    it('drops a new child line under a budgeted parent', () => {
        const r = validateBudgetProposals([{ account: 'Expenses:Food:Groceries', amount: 400 }], ctx());
        expect(r.reasons).toEqual({ conflict: 1 });
    });

    it('drops a new parent line above budgeted children', () => {
        const r = validateBudgetProposals([{ account: 'Expenses', amount: 2500 }], ctx());
        expect(r.reasons).toEqual({ conflict: 1 });
    });

    it('accepts a replacement when the same set removes the conflicting line, and ties them together', () => {
        const r = validateBudgetProposals([
            { account: 'Expenses:Food:Groceries', amount: 400 },
            { account: 'Expenses:Food:Dining', amount: 200 },
            { account: 'Expenses:Food', amount: null },
        ], ctx());
        expect(r.dropped).toBe(0);
        expect(r.proposals.map(p => [p.accountPath, p.to, p.requires])).toEqual([
            ['Expenses:Food:Groceries', 400, [G('f')]],
            ['Expenses:Food:Dining', 200, [G('f')]],
            ['Expenses:Food', null, []],
        ]);
    });

    it('still drops a parent line when only some of its budgeted children are removed', () => {
        const r = validateBudgetProposals([
            { account: 'Expenses', amount: 2500 },
            { account: 'Expenses:Food', amount: null },
        ], ctx());
        // Housing is still a line under Expenses.
        expect(r.proposals.map(p => p.accountPath)).toEqual(['Expenses:Food']);
        expect(r.reasons).toEqual({ conflict: 1 });
    });

    it('allows changing the amount of an existing line even if the book already had a conflict', () => {
        const lines = [...LINES, { accountGuid: G('g'), amount: 300, varies: false }];
        const r = validateBudgetProposals([{ account: 'Expenses:Food:Groceries', amount: 350 }], ctx({ lines }));
        expect(r.proposals).toHaveLength(1);
    });

    it('two new lines in one branch: the first wins', () => {
        const r = validateBudgetProposals([
            { account: 'Assets', amount: 100 },
            { account: 'Assets:Checking', amount: 50 },
        ], ctx());
        expect(r.proposals.map(p => p.accountPath)).toEqual(['Assets']);
        expect(r.reasons).toEqual({ conflict: 1 });
    });

    it('drops a new line whose required removal was cut by the cap', () => {
        const filler = Array.from({ length: MAX_BUDGET_PROPOSALS }, () => null);
        const accounts = [
            ...ACCOUNTS,
            ...filler.map((_, i) => ({ guid: `x${String(i).padStart(31, '0')}`, path: `Expenses:Extra${i}`, name: `Extra${i}`, type: 'EXPENSE', parentGuid: G('e') })),
        ];
        // Expenses:Extra* are children of Expenses, so they never conflict with Food/Housing lines.
        const raw = [
            { account: 'Expenses:Food:Groceries', amount: 400 },
            ...filler.map((_, i) => ({ account: `Expenses:Extra${i}`, amount: 10 + i })),
            { account: 'Expenses:Food', amount: null },
        ];
        const r = validateBudgetProposals(raw, ctx({ accounts }));
        expect(r.proposals.some(p => p.accountPath === 'Expenses:Food:Groceries')).toBe(false);
        expect(r.proposals.some(p => p.accountPath === 'Expenses:Food')).toBe(false);
        // 27 valid changes: the cap keeps Groceries + 24 extras, cutting the last extra and the
        // Food removal; Groceries then loses the removal it needs.
        expect(r.proposals).toHaveLength(MAX_BUDGET_PROPOSALS - 1);
        expect(r.reasons).toEqual({ 'over-cap': 2, conflict: 1 });
    });
});

describe('validateBudgetProposals: unmasking and why', () => {
    it('resolves a tokenised path and unmasks the why', () => {
        const names = newNames();
        const food = ph(names, 'Account', 'Food');
        const r = validateBudgetProposals(
            [{ account: `Expenses:${food}`, amount: 700, why: `${food} ran about $640.` }],
            ctx({ unmaskStrict: t => unmaskStrict(t, names), unmask: t => unmask(t, names) }),
        );
        expect(r.proposals[0]).toMatchObject({ accountPath: 'Expenses:Food', to: 700, why: 'Food ran about $640.' });
    });

    it('drops a why with an invented figure, but lets the model name its own amount', () => {
        const bad = validateBudgetProposals([{ account: 'Expenses:Food', amount: 700, why: 'You overspent by $87.' }], ctx());
        expect(bad.proposals[0].why).toBeNull();
        expect(bad.whyDropped).toBe(1);
        const own = validateBudgetProposals([{ account: 'Expenses:Food', amount: 700, why: 'Raise it to $700.' }], ctx());
        expect(own.proposals[0].why).toBe('Raise it to $700.');
    });
});

describe('helpers', () => {
    it('ancestorsOf and branchConflicts', () => {
        expect(ancestorsOf(G('g'), BY_GUID)).toEqual([G('f'), G('e')]);
        expect(branchConflicts(G('g'), [G('f'), G('h'), G('s')], BY_GUID)).toEqual([G('f')]);
        expect(branchConflicts(G('e'), [G('f'), G('h'), G('s')], BY_GUID)).toEqual([G('f'), G('h')]);
        expect(branchConflicts(G('d'), [G('g')], BY_GUID)).toEqual([]); // siblings are fine
    });

    it('rollUpMonthly adds each account into all its ancestors', () => {
        const own = new Map([
            [G('g'), new Map([['2026-08', 300], ['2026-09', 310]])],
            [G('d'), new Map([['2026-08', 100]])],
            [G('h'), new Map([['2026-08', 1500]])],
        ]);
        const rolled = rollUpMonthly(ACCOUNTS, own);
        expect(rolled.get(G('f'))?.get('2026-08')).toBe(400);
        expect(rolled.get(G('f'))?.get('2026-09')).toBe(310);
        expect(rolled.get(G('e'))?.get('2026-08')).toBe(1900);
        expect(rolled.get(G('g'))?.get('2026-08')).toBe(300);
        expect(rolled.has(G('s'))).toBe(false);
    });

    it('lineState: common value, or the average when periods differ', () => {
        expect(lineState('x', [100, 100, 100])).toEqual({ accountGuid: 'x', amount: 100, varies: false });
        expect(lineState('x', [100, 200])).toEqual({ accountGuid: 'x', amount: 150, varies: true });
        expect(lineState('x', [])).toEqual({ accountGuid: 'x', amount: 0, varies: false });
    });

    it('completeMonths and periodMonthsOf', () => {
        expect(completeMonths(new Date('2026-11-10T12:00:00Z'), 3)).toEqual({
            months: ['2026-08', '2026-09', '2026-10'],
            start: new Date('2026-08-01T00:00:00Z'),
            end: new Date('2026-11-01T00:00:00Z'),
        });
        expect(completeMonths(new Date('2026-01-15T00:00:00Z'), 2).months).toEqual(['2025-11', '2025-12']);
        expect(periodMonthsOf({ period_type: 'month', mult: 1 })).toBe(1);
        expect(periodMonthsOf({ period_type: 'month', mult: 3 })).toBe(3);
        expect(periodMonthsOf({ period_type: 'year', mult: 1 })).toBe(12);
        expect(periodMonthsOf(null)).toBe(1);
    });

    it('toRawBudgetAmount negates income only', () => {
        expect(toRawBudgetAmount('INCOME', 100)).toBe(-100);
        expect(toRawBudgetAmount('EXPENSE', 100)).toBe(100);
    });

    it('buildBudgetPromptPayload: summary tokenises names and rounds every amount', () => {
        const names = newNames();
        const payload = buildBudgetPromptPayload({
            currency: 'USD',
            periodMonths: 1,
            months: ['2026-08', '2026-09', '2026-10'],
            lines: [{ path: 'Expenses:Quillfeather Dining', type: 'EXPENSE', budget: 987.65, varies: false, actuals: [1873.42, 73.21, 45678.91] }],
            accounts: [{ path: 'Expenses:Zorblax Hobbies', type: 'EXPENSE', average: 123.45 }],
        }, { level: 'summary', names });
        expect(payload.lines).toEqual([{ a: 'Expenses:⟨A1⟩', t: 'EXPENSE', budget: 990, actuals: [1900, 75, 45700] }]);
        expect(payload.accounts).toEqual([{ a: 'Expenses:⟨A2⟩', t: 'EXPENSE', average: 120 }]);
        const text = buildBudgetMessages(payload, true).map(m => m.content).join('\n');
        expect(text).not.toMatch(/Quillfeather|Zorblax|987\.65|1873\.42/);
        expect(budgetKnownNumbers(payload)).toEqual(expect.arrayContaining([990, 1900, 120]));

        const full = buildBudgetPromptPayload({
            currency: 'USD', periodMonths: 1, months: [],
            lines: [{ path: 'Expenses:Quillfeather Dining', type: 'EXPENSE', budget: 987.654, varies: true, actuals: [] }],
            accounts: [],
        }, { level: 'full', names: null });
        expect(full.lines[0]).toEqual({ a: 'Expenses:Quillfeather Dining', t: 'EXPENSE', budget: 987.65, varies: true, actuals: [] });
    });
});
