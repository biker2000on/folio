import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DigestPage from './page';
import type { MonthlyDigest } from '@/lib/digest';
import { generateTips, gradeTips } from '@/lib/digest-tips';

vi.mock('@/components/RelatedLinks', () => ({ RelatedLinks: () => null }));

function mkDigest(overrides: Partial<MonthlyDigest> = {}): MonthlyDigest {
    return {
        month: '2026-10',
        monthLabel: 'October 2026',
        generatedAt: '2026-11-02T00:00:00.000Z',
        currency: 'USD',
        netWorth: { end: 100000, change: 1000, changePercent: 1 },
        cashFlow: { income: 4000, expenses: 4500, savingsRate: -12.5 },
        topCategories: [],
        subscriptions: { new: [], changed: [], stopped: [] },
        upcomingBills: [],
        budget: null,
        ...overrides,
    };
}

const baseInput = {
    currency: 'USD',
    expenseHistory: [],
    categories: [],
    budgetRows: [],
    priceHikes: [],
    newSubscriptions: [],
};

function stubFetch(digest: MonthlyDigest) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => digest })));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DigestPage tips', () => {
    it('renders last month\'s graded tips and next month\'s tips', async () => {
        const septTips = generateTips({ ...baseInput, month: '2026-09', income: 4000, expenses: 4500 });
        const tipChecks = gradeTips(
            septTips,
            { month: '2026-10', complete: true, totalExpenses: 4500, accountSpend: {}, categorySpend: {}, charges: {} },
            'USD'
        );
        const tips = generateTips({ ...baseInput, month: '2026-10', income: 4000, expenses: 4500 });
        stubFetch(mkDigest({ tips, tipChecks }));

        render(<DigestPage />);

        expect(await screen.findByText("How September's tips went")).toBeTruthy();
        expect(screen.getByText('1 missed')).toBeTruthy();
        expect(screen.getByText('Missed')).toBeTruthy();
        expect(screen.getByText('Spending came to $4,500.00, $500.00 over the $4,000.00 target.')).toBeTruthy();
        expect(screen.getByText('Tips for November')).toBeTruthy();
        expect(screen.getByText('Keep total spending under $4,000.00 in November.')).toBeTruthy();
        expect(screen.getByText('by Nov 30')).toBeTruthy();
    });

    it('says when nothing called for a tip, and hides grading without checks', async () => {
        stubFetch(mkDigest({ tips: [] }));
        render(<DigestPage />);
        expect(await screen.findByText(/Nothing in October called for a tip/)).toBeTruthy();
        expect(screen.queryByText(/tips went/)).toBeNull();
    });

    it('hides both sections for an old month that issued no tips', async () => {
        stubFetch(mkDigest({ month: '2025-01', monthLabel: 'January 2025' }));
        render(<DigestPage />);
        await waitFor(() => expect(screen.getByText(/Net worth · end of January 2025/)).toBeTruthy());
        expect(screen.queryByText(/Tips for/)).toBeNull();
    });
});
