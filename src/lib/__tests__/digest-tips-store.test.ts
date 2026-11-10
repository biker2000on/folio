/**
 * Digest tips store: issue-once persistence, the issuing policy, and grading
 * wiring. Prisma and the services are faked; the SQL itself stays thin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, unknown>();

vi.mock('@/lib/prisma', () => ({
    default: {
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = strings.join('?');
            if (sql.includes('FROM gnucash_web_digest_tips')) {
                const key = `${values[0]}|${values[1]}`;
                return db.has(key) ? [{ tips: db.get(key) }] : [];
            }
            if (sql.includes('FROM account_hierarchy')) {
                return (values[0] as string[]).map(guid => ({
                    guid,
                    name: guid,
                    level1: 'Expenses',
                    level2: guid === 'acct-dining' ? 'Dining' : 'Other',
                    guid1: 'acct-expenses',
                    guid2: guid === 'acct-dining' ? 'cat-dining' : 'cat-other',
                }));
            }
            throw new Error(`unexpected query: ${sql}`);
        }),
        $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = strings.join('?');
            if (!sql.includes('ON CONFLICT (book_guid, month) DO NOTHING')) throw new Error(`unexpected: ${sql}`);
            const key = `${values[0]}|${values[1]}`;
            if (db.has(key)) return 0;
            db.set(key, JSON.parse(values[2] as string));
            return 1;
        }),
    },
}));

vi.mock('@/lib/services/financial-summary.service', () => ({
    FinancialSummaryService: {
        computeIncomeExpenses: vi.fn(async () => ({
            totalIncome: 5000,
            totalExpenses: 3000,
            expenseByAccount: new Map([['acct-dining', 300]]),
        })),
    },
}));

vi.mock('@/lib/recurring-detection', async importOriginal => {
    const actual = await importOriginal<typeof import('@/lib/recurring-detection')>();
    return { ...actual, loadSpendingTransactions: vi.fn(async () => []) };
});

vi.mock('@/lib/digest', () => ({ generateDigest: vi.fn() }));

import prisma from '@/lib/prisma';
import { generateDigest } from '@/lib/digest';
import { loadSpendingTransactions } from '@/lib/recurring-detection';
import { FinancialSummaryService } from '@/lib/services/financial-summary.service';
import { resolveDigestTips, type ResolveDigestTipsInput } from '../digest-tips-store';
import { generateTips, type DigestTip } from '../digest-tips';

function bounds(month: string): ResolveDigestTipsInput['bounds'] {
    const [year, monthNumber] = month.split('-').map(Number);
    return {
        month,
        label: month,
        monthStart: new Date(Date.UTC(year, monthNumber - 1, 1)),
        monthEnd: new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999)),
        priorMonthStart: new Date(Date.UTC(year, monthNumber - 2, 1)),
        priorMonthEnd: new Date(Date.UTC(year, monthNumber - 1, 0, 23, 59, 59, 999)),
        monthKeyStart: '',
        monthKeyEnd: '',
        year,
        monthNumber,
    };
}

const NOW = new Date(Date.UTC(2026, 10, 10)); // 2026-11-10: October is the latest complete month

function mkInput(month: string, overrides: Partial<ResolveDigestTipsInput> = {}): ResolveDigestTipsInput {
    return {
        bookGuid: 'book-1',
        bookAccountGuids: ['acct-dining'],
        bounds: bounds(month),
        baseCurrency: null,
        currency: 'USD',
        income: 4000,
        expenses: 4500,
        budget: null,
        subscriptions: { new: [], changed: [], stopped: [] },
        expenseByAccount: new Map([['acct-dining', 640]]),
        now: NOW,
        ...overrides,
    };
}

function paceTipFor(month: string): DigestTip {
    const [tip] = generateTips({
        month,
        currency: 'USD',
        income: 4000,
        expenses: 4500,
        expenseHistory: [],
        categories: [],
        budgetRows: [],
        priceHikes: [],
        newSubscriptions: [],
    });
    return tip;
}

beforeEach(() => {
    db.clear();
    vi.clearAllMocks();
});

describe('resolveDigestTips', () => {
    it('issues tips from the latest complete month and stores them once', async () => {
        const first = await resolveDigestTips(mkInput('2026-10'));
        expect(first.tips?.map(t => t.kind)).toEqual(['pace', 'spike']);
        expect(first.tips?.[0]).toMatchObject({ forMonth: '2026-11', actBy: '2026-11-30', amount: 4000 });
        expect(first.tips?.[1]).toMatchObject({ key: 'cat-dining', amount: 300 });
        expect(first.tipChecks).toBeUndefined();
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(FinancialSummaryService.computeIncomeExpenses).toHaveBeenCalledTimes(6);

        // Re-generating with different figures reuses the stored tips.
        vi.clearAllMocks();
        const again = await resolveDigestTips(mkInput('2026-10', { expenses: 9999 }));
        expect(again.tips).toEqual(first.tips);
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(FinancialSummaryService.computeIncomeExpenses).not.toHaveBeenCalled();
    });

    it('stores an empty list when nothing qualifies', async () => {
        const result = await resolveDigestTips(
            mkInput('2026-10', { expenses: 3000, expenseByAccount: new Map([['acct-dining', 300]]) })
        );
        expect(result.tips).toEqual([]);
        expect(db.get('book-1|2026-10')).toEqual([]);
    });

    it('never issues for an older complete month', async () => {
        const result = await resolveDigestTips(mkInput('2026-08'));
        expect(result.tips).toBeUndefined();
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('grades last month\'s stored tips against this month', async () => {
        db.set('book-1|2026-09', [paceTipFor('2026-09')]);
        const result = await resolveDigestTips(mkInput('2026-10', { expenses: 3900 }));
        expect(result.tipChecks).toHaveLength(1);
        expect(result.tipChecks?.[0]).toMatchObject({ outcome: 'held', actual: 3900, final: true });
    });

    it('on the open month, builds last month\'s digest once to issue its tips, then grades provisionally', async () => {
        vi.mocked(generateDigest).mockImplementation(async () => {
            db.set('book-1|2026-10', [paceTipFor('2026-10')]);
            return {} as Awaited<ReturnType<typeof generateDigest>>;
        });
        const result = await resolveDigestTips(mkInput('2026-11', { expenses: 4200 }));
        expect(generateDigest).toHaveBeenCalledWith('book-1', { month: '2026-10' });
        expect(result.tips).toBeUndefined(); // the open month issues nothing
        expect(result.tipChecks?.[0]).toMatchObject({ outcome: 'missed', actual: 4200, final: false });
    });

    it('grades subscription tips from the month\'s charges only', async () => {
        const [hike] = generateTips({
            month: '2026-09',
            currency: 'USD',
            income: 0,
            expenses: 0,
            expenseHistory: [],
            categories: [],
            budgetRows: [],
            priceHikes: [{
                key: 'netflix com',
                label: 'NETFLIX.COM',
                cadence: 'monthly',
                currentAmount: 17.99,
                previousAmount: 15.49,
                changePercent: 16.1,
                nextExpected: '2026-10-12',
            }],
            newSubscriptions: [],
        });
        db.set('book-1|2026-09', [hike]);
        vi.mocked(loadSpendingTransactions).mockResolvedValue([
            { date: new Date(Date.UTC(2026, 8, 12)), description: 'NETFLIX.COM', amount: 17.99, accountGuid: 'x', accountName: 'x' },
            { date: new Date(Date.UTC(2026, 9, 12)), description: 'NETFLIX.COM 4029', amount: 15.49, accountGuid: 'x', accountName: 'x' },
            { date: new Date(Date.UTC(2026, 9, 14)), description: 'Spotify', amount: 9.99, accountGuid: 'x', accountName: 'x' },
        ]);
        const result = await resolveDigestTips(mkInput('2026-10'));
        expect(result.tipChecks?.[0]).toMatchObject({ outcome: 'held', actual: 15.49 });
    });
});
