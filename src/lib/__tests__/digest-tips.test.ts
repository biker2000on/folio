/**
 * Monthly digest tips: generation, grading and month rollover (pure, no DB).
 */

import { describe, it, expect } from 'vitest';
import {
    MAX_TIPS,
    generateTips,
    gradeTips,
    median,
    monthEndIso,
    monthlyFactor,
    nextMonthKey,
    parseStoredTips,
    prevMonthKey,
    tipMonthPolicy,
    tipsSummaryLines,
    type DigestTip,
    type TipGenerationInput,
    type TipGradingFacts,
    type TipSubscriptionInput,
} from '../digest-tips';
import type { DigestBudgetRow } from '../digest';

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

/** A quiet month: nothing qualifies. */
function mkInput(overrides: Partial<TipGenerationInput> = {}): TipGenerationInput {
    return {
        month: '2026-10',
        currency: 'USD',
        income: 5000,
        expenses: 3000,
        expenseHistory: [3000, 3100, 2900, 3050],
        categories: [],
        budgetRows: [],
        priceHikes: [],
        newSubscriptions: [],
        ...overrides,
    };
}

function mkBudgetRow(overrides: Partial<DigestBudgetRow> = {}): DigestBudgetRow {
    return {
        accountGuid: 'acct-groceries',
        accountName: 'Groceries',
        budgeted: 600,
        actual: 742,
        variance: -142,
        status: 'over',
        ...overrides,
    };
}

function mkSub(overrides: Partial<TipSubscriptionInput> = {}): TipSubscriptionInput {
    return {
        key: 'netflix',
        label: 'Netflix',
        cadence: 'monthly',
        currentAmount: 17.99,
        previousAmount: 15.49,
        changePercent: 16.1,
        nextExpected: '2026-11-12',
        ...overrides,
    };
}

function mkFacts(overrides: Partial<TipGradingFacts> = {}): TipGradingFacts {
    return {
        month: '2026-11',
        complete: true,
        totalExpenses: 0,
        accountSpend: {},
        categorySpend: {},
        charges: {},
        ...overrides,
    };
}

function only(tips: DigestTip[], kind: DigestTip['kind']): DigestTip {
    const found = tips.filter(t => t.kind === kind);
    expect(found).toHaveLength(1);
    return found[0];
}

function tipOf(input: Partial<TipGenerationInput>, kind: DigestTip['kind']): DigestTip {
    return only(generateTips(mkInput(input)), kind);
}

/* ------------------------------------------------------------------ */
/* Month rollover                                                      */
/* ------------------------------------------------------------------ */

describe('month helpers', () => {
    it('rolls December into January of the next year and back', () => {
        expect(nextMonthKey('2026-12')).toBe('2027-01');
        expect(prevMonthKey('2027-01')).toBe('2026-12');
        expect(nextMonthKey('2026-06')).toBe('2026-07');
        expect(prevMonthKey('2026-07')).toBe('2026-06');
    });

    it('computes the last day of a month, including leap February', () => {
        expect(monthEndIso('2027-01')).toBe('2027-01-31');
        expect(monthEndIso('2028-02')).toBe('2028-02-29');
        expect(monthEndIso('2026-11')).toBe('2026-11-30');
    });

    it('rejects malformed months', () => {
        expect(() => nextMonthKey('2026-13')).toThrow();
        expect(() => prevMonthKey('26-01')).toThrow();
    });

    it('issues tips from December when January is the current month', () => {
        const now = new Date(Date.UTC(2027, 0, 5));
        expect(tipMonthPolicy('2026-12', now)).toEqual({ complete: true, isOpenMonth: false, canIssue: true });
        // Older completed months are never issued retroactively.
        expect(tipMonthPolicy('2026-11', now)).toEqual({ complete: true, isOpenMonth: false, canIssue: false });
        expect(tipMonthPolicy('2027-01', now)).toEqual({ complete: false, isOpenMonth: true, canIssue: false });
        expect(tipMonthPolicy('2027-02', now)).toEqual({ complete: false, isOpenMonth: false, canIssue: false });
    });

    it('dates December tips to the end of January', () => {
        const tip = tipOf({ month: '2026-12', income: 4000, expenses: 5000 }, 'pace');
        expect(tip.issuedMonth).toBe('2026-12');
        expect(tip.forMonth).toBe('2027-01');
        expect(tip.actBy).toBe('2027-01-31');
        expect(tip.text).toContain('in January');
    });
});

describe('median / monthlyFactor', () => {
    it('handles odd, even and empty lists', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([])).toBe(0);
    });

    it('normalizes cadences to charges per month', () => {
        expect(monthlyFactor('monthly')).toBe(1);
        expect(monthlyFactor('weekly')).toBeCloseTo(52 / 12);
        expect(monthlyFactor('quarterly')).toBeCloseTo(1 / 3);
        expect(monthlyFactor('annual')).toBeCloseTo(1 / 12);
    });
});

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

describe('generateTips', () => {
    it('issues nothing for a quiet month', () => {
        expect(generateTips(mkInput())).toEqual([]);
    });

    it('pace: caps spending at income when spending exceeded it', () => {
        const tip = tipOf({ income: 4000.5, expenses: 4500 }, 'pace');
        expect(tip.key).toBe('total');
        expect(tip.amount).toBe(4000);
        expect(tip.target).toBe(4000);
        expect(tip.observed).toBe(4500);
        expect(tip.text).toBe('Keep total spending under $4,000.00 in November.');
        expect(tip.why).toContain('more than income');
        expect(tip.actBy).toBe('2026-11-30');
    });

    it('pace: caps spending at the typical month when it ran well above it', () => {
        // median(3000, 3100, 2900, 3050) = 3025; 3700 >= 3025 x 1.2 and +675
        const tip = tipOf({ income: 9000, expenses: 3700 }, 'pace');
        expect(tip.amount).toBe(3025);
        expect(tip.why).toContain('above a typical month');
    });

    it('pace: needs enough history and a real excess', () => {
        expect(generateTips(mkInput({ expenses: 3700, expenseHistory: [3000, 3000] }))).toEqual([]);
        // +20% but under the minimum absolute excess
        expect(generateTips(mkInput({ expenses: 480, expenseHistory: [400, 400, 400] }))).toEqual([]);
        // Months without spending (before the book started) do not count.
        expect(generateTips(mkInput({ expenses: 3700, expenseHistory: [3000, 0, 0, 3000] }))).toEqual([]);
    });

    it('pace: ignores the income rule when no income was recorded', () => {
        expect(generateTips(mkInput({ income: 0, expenses: 3000 }))).toEqual([]);
    });

    it('budget: keeps an over-budget line under its budget', () => {
        const tip = tipOf({ budgetRows: [mkBudgetRow()] }, 'budget');
        expect(tip.key).toBe('acct-groceries');
        expect(tip.amount).toBe(600);
        expect(tip.target).toBe(600);
        expect(tip.observed).toBe(742);
        expect(tip.impact).toBe(142);
        expect(tip.text).toBe('Keep Groceries under its $600.00 budget in November.');
    });

    it('budget: skips small overages and lines that are not over', () => {
        const rows = [
            mkBudgetRow({ accountGuid: 'a', actual: 625 }), // +25 < 5% of 600 (30)
            mkBudgetRow({ accountGuid: 'b', budgeted: 50, actual: 58 }), // +8 < $10 floor
            mkBudgetRow({ accountGuid: 'c', actual: 500, status: 'under' }),
        ];
        expect(generateTips(mkInput({ budgetRows: rows }))).toEqual([]);
    });

    it('spike: brings a category far above typical back near typical', () => {
        const tip = tipOf(
            { categories: [{ key: 'cat-dining', name: 'Dining', amount: 640, history: [300, 280, 320, 310] }] },
            'spike'
        );
        expect(tip.key).toBe('cat-dining');
        expect(tip.amount).toBe(305);
        expect(tip.target).toBe(335.5);
        expect(tip.observed).toBe(640);
        expect(tip.text).toBe('Bring Dining back to about $305.00 in November.');
    });

    it('spike: skips modest rises, small dollar moves, one-offs and short history', () => {
        const categories = [
            { key: 'a', name: 'A', amount: 400, history: [300, 300, 300] }, // 1.33x
            { key: 'b', name: 'B', amount: 120, history: [60, 60, 60] }, // 2x but +60
            { key: 'c', name: 'C', amount: 900, history: [0, 0, 10] }, // typical below floor
            { key: 'd', name: 'D', amount: 900, history: [300, 300] }, // not enough months
        ];
        expect(generateTips(mkInput({ categories }))).toEqual([]);
    });

    it('hike: asks for the old price, with a 2% check tolerance', () => {
        const tip = tipOf({ priceHikes: [mkSub()] }, 'hike');
        expect(tip.key).toBe('netflix');
        expect(tip.amount).toBe(15.49);
        expect(tip.target).toBe(15.8);
        expect(tip.observed).toBe(17.99);
        expect(tip.impact).toBe(2.5);
        expect(tip.nextExpected).toBe('2026-11-12');
        expect(tip.text).toBe('Ask Netflix for the old $15.49 price, or cancel, before Nov 30.');
    });

    it('hike: skips increases under the per-charge minimum', () => {
        const sub = mkSub({ currentAmount: 5.25, previousAmount: 4.99, changePercent: 5.2 });
        expect(generateTips(mkInput({ priceHikes: [sub] }))).toEqual([]);
    });

    it('new_sub: states the monthly cost, normalizing weekly charges', () => {
        const tip = tipOf(
            { newSubscriptions: [mkSub({ key: 'meal kit', label: 'Meal Kit', cadence: 'weekly', currentAmount: 30 })] },
            'new_sub'
        );
        expect(tip.amount).toBe(130);
        expect(tip.target).toBe(0);
        expect(tip.cadence).toBe('weekly');
        expect(tip.text).toBe('Decide whether Meal Kit is worth $130.00/mo before Nov 30.');
    });

    it('new_sub: skips trivially cheap charges', () => {
        const sub = mkSub({ cadence: 'annual', currentAmount: 24 }); // $2/mo
        expect(generateTips(mkInput({ newSubscriptions: [sub] }))).toEqual([]);
    });

    it('caps at three tips, most valuable first', () => {
        const tips = generateTips(
            mkInput({
                income: 4000,
                expenses: 4500, // pace impact 500
                budgetRows: [mkBudgetRow()], // impact 142
                categories: [{ key: 'cat-dining', name: 'Dining', amount: 640, history: [300, 300, 300] }], // 340
                priceHikes: [mkSub()], // 2.5
                newSubscriptions: [mkSub({ key: 'hulu', label: 'Hulu', currentAmount: 7.99 })], // 7.99
            })
        );
        expect(tips).toHaveLength(MAX_TIPS);
        expect(tips.map(t => t.kind)).toEqual(['pace', 'spike', 'budget']);
    });

    it('breaks impact ties by kind, and keeps one tip per subject', () => {
        const tips = generateTips(
            mkInput({
                budgetRows: [mkBudgetRow({ accountGuid: 'cat-food', accountName: 'Food', budgeted: 300, actual: 500 })],
                categories: [{ key: 'cat-food', name: 'Food', amount: 500, history: [300, 300, 300] }],
            })
        );
        // Both have impact 200 and the same key: the budget tip wins.
        expect(tips).toHaveLength(1);
        expect(tips[0].kind).toBe('budget');
    });
});

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

describe('gradeTips', () => {
    const pace = tipOf({ income: 4000, expenses: 4500 }, 'pace'); // target 4000
    const budget = tipOf({ budgetRows: [mkBudgetRow()] }, 'budget'); // target 600
    const spike = tipOf(
        { categories: [{ key: 'cat-dining', name: 'Dining', amount: 640, history: [300, 300, 300] }] },
        'spike'
    ); // target 330
    const hike = tipOf({ priceHikes: [mkSub()] }, 'hike'); // target 15.80, next expected 2026-11-12
    const newSub = tipOf(
        { newSubscriptions: [mkSub({ key: 'hulu', label: 'Hulu', currentAmount: 7.99, nextExpected: '2026-11-20' })] },
        'new_sub'
    );

    it('pace: held at exactly the target, missed a cent over', () => {
        const [held] = gradeTips([pace], mkFacts({ totalExpenses: 4000 }), 'USD');
        expect(held).toMatchObject({ outcome: 'held', actual: 4000, final: true });
        expect(held.text).toBe('Spending came to $4,000.00, under the $4,000.00 target.');

        const [missed] = gradeTips([pace], mkFacts({ totalExpenses: 4000.01 }), 'USD');
        expect(missed.outcome).toBe('missed');
        expect(missed.text).toContain('$0.01 over');
    });

    it('marks checks provisional while the graded month is open', () => {
        const [check] = gradeTips([pace], mkFacts({ complete: false, totalExpenses: 1200 }), 'USD');
        expect(check).toMatchObject({ outcome: 'held', final: false });
        expect(check.text).toContain('so far');
    });

    it('budget: reads the account spend, treating no spend as held', () => {
        expect(gradeTips([budget], mkFacts({ accountSpend: { 'acct-groceries': 600 } }), 'USD')[0].outcome).toBe('held');
        expect(gradeTips([budget], mkFacts({ accountSpend: { 'acct-groceries': 650 } }), 'USD')[0].outcome).toBe('missed');
        expect(gradeTips([budget], mkFacts(), 'USD')[0]).toMatchObject({ outcome: 'held', actual: 0 });
    });

    it('spike: holds within typical x 1.1', () => {
        expect(spike.target).toBe(330);
        expect(gradeTips([spike], mkFacts({ categorySpend: { 'cat-dining': 330 } }), 'USD')[0].outcome).toBe('held');
        expect(gradeTips([spike], mkFacts({ categorySpend: { 'cat-dining': 330.5 } }), 'USD')[0].outcome).toBe('missed');
    });

    it('hike: grades the first charge in the month against old x 1.02', () => {
        const charges = (amount: number) => ({
            netflix: [
                { date: '2026-11-28', amount: 99 },
                { date: '2026-11-12', amount },
            ],
        });
        expect(gradeTips([hike], mkFacts({ charges: charges(15.8) }), 'USD')[0]).toMatchObject({
            outcome: 'held',
            actual: 15.8,
        });
        const [missed] = gradeTips([hike], mkFacts({ charges: charges(17.99) }), 'USD');
        expect(missed).toMatchObject({ outcome: 'missed', actual: 17.99, final: true });
        expect(missed.text).toBe('Netflix still charges $17.99 (was $15.49).');
    });

    it('hike: a due charge that never came counts as stopped (held)', () => {
        const [check] = gradeTips([hike], mkFacts(), 'USD');
        expect(check).toMatchObject({ outcome: 'held', actual: 0 });
        expect(check.text).toContain('looks cancelled');
    });

    it('hike: no charge is neutral while the month is open or nothing was due', () => {
        expect(gradeTips([hike], mkFacts({ complete: false }), 'USD')[0].outcome).toBe('neutral');
        const notDue = { ...hike, nextExpected: '2027-02-12' };
        expect(gradeTips([notDue], mkFacts(), 'USD')[0].outcome).toBe('neutral');
    });

    it('new_sub: still charging is neutral, stopping is held', () => {
        const [active] = gradeTips(
            [newSub],
            mkFacts({ charges: { hulu: [{ date: '2026-11-20', amount: 7.99 }] } }),
            'USD'
        );
        expect(active).toMatchObject({ outcome: 'neutral', actual: 7.99 });
        expect(active.text).toBe('Hulu is still active ($7.99 this month).');

        expect(gradeTips([newSub], mkFacts(), 'USD')[0].outcome).toBe('held');
    });

    it('skips tips meant for a different month', () => {
        expect(gradeTips([pace], mkFacts({ month: '2026-12' }), 'USD')).toEqual([]);
    });

    it('grades a December tip in January', () => {
        const dec = tipOf({ month: '2026-12', income: 4000, expenses: 5000 }, 'pace');
        const checks = gradeTips([dec], mkFacts({ month: '2027-01', totalExpenses: 3900 }), 'USD');
        expect(checks).toHaveLength(1);
        expect(checks[0].outcome).toBe('held');
    });
});

/* ------------------------------------------------------------------ */
/* Storage shape and summary text                                      */
/* ------------------------------------------------------------------ */

describe('parseStoredTips', () => {
    it('keeps well-formed tips and drops junk', () => {
        const pace = tipOf({ income: 4000, expenses: 4500 }, 'pace');
        expect(parseStoredTips([pace, { kind: 'bogus' }, null, 3])).toEqual([pace]);
        expect(parseStoredTips(JSON.stringify([pace]))).toEqual([pace]);
        expect(parseStoredTips('not json')).toEqual([]);
        expect(parseStoredTips({})).toEqual([]);
    });
});

describe('tipsSummaryLines', () => {
    it('renders graded checks and new tips', () => {
        const pace = tipOf({ income: 4000, expenses: 4500 }, 'pace');
        const checks = gradeTips([pace], mkFacts({ totalExpenses: 3900 }), 'USD');
        const next = tipOf({ month: '2026-11', budgetRows: [mkBudgetRow()] }, 'budget');
        const lines = tipsSummaryLines({ month: '2026-11', tips: [next], tipChecks: checks });
        expect(lines).toContain("**How October's tips went**");
        expect(lines).toContain('- Held: Spending came to $3,900.00, under the $4,000.00 target.');
        expect(lines).toContain('**Tips for December**');
        expect(lines).toContain('- Keep Groceries under its $600.00 budget in December.');
    });

    it('renders nothing without tips', () => {
        expect(tipsSummaryLines({ month: '2026-11' })).toEqual([]);
    });
});

describe('digestToSummaryText with tips', () => {
    it('appends the compact tips block to the notification / email body', async () => {
        const { digestToSummaryText } = await import('../digest');
        const tip = tipOf({ month: '2026-11', income: 4000, expenses: 4500 }, 'pace');
        const text = digestToSummaryText({
            month: '2026-11',
            monthLabel: 'November 2026',
            generatedAt: '2026-12-01T00:00:00.000Z',
            currency: 'USD',
            netWorth: { end: 1000, change: 0, changePercent: 0 },
            cashFlow: { income: 4000, expenses: 4500, savingsRate: -12.5 },
            topCategories: [],
            subscriptions: { new: [], changed: [], stopped: [] },
            upcomingBills: [],
            budget: null,
            tips: [tip],
        });
        expect(text).toContain('**Tips for December**');
        expect(text).toContain('- Keep total spending under $4,000.00 in December.');
        expect(text).not.toContain('tips went');
    });
});
