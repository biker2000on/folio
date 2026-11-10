/**
 * DB side of the monthly digest tips (see `digest-tips.ts` for the pure
 * generation and grading).
 *
 * - Tips are issued once per (book, month) into `gnucash_web_digest_tips`
 *   (INSERT ... ON CONFLICT DO NOTHING, then read back), so re-generating a
 *   digest reuses the same tips and grading stays fair. An empty array is
 *   stored when nothing qualified, which marks the month as handled.
 * - Tips are only issued from the most recently completed month.
 * - The digest for month M grades the tips issued by M-1 against M.
 *
 * The table is raw SQL only (no Prisma client access) so this compiles
 * without regenerating the client; the matching Prisma model exists only for
 * the schema drift check.
 */

import prisma from '@/lib/prisma';
import type { Currency } from '@/lib/currency';
import { FinancialSummaryService } from '@/lib/services/financial-summary.service';
import { loadSpendingTransactions, normalizeMerchant } from '@/lib/recurring-detection';
import type {
    DigestBudget,
    DigestSubscription,
    DigestSubscriptions,
    MonthBounds,
} from '@/lib/digest';
import {
    generateTips,
    gradeTips,
    parseStoredTips,
    prevMonthKey,
    tipMonthPolicy,
    type DigestTip,
    type DigestTipCheck,
    type TipCharge,
    type TipGenerationInput,
    type TipSubscriptionInput,
} from '@/lib/digest-tips';

/** Complete months before the issuing month used for "typical". */
const HISTORY_MONTHS = 6;

export interface ResolveDigestTipsInput {
    bookGuid: string;
    bookAccountGuids: string[];
    bounds: MonthBounds;
    baseCurrency: Currency | null;
    currency: string;
    income: number;
    expenses: number;
    budget: DigestBudget | null;
    subscriptions: DigestSubscriptions;
    /** Positive spend per expense account for the digest month. */
    expenseByAccount: Map<string, number>;
    now?: Date;
}

export interface DigestTipsSection {
    /** Tips issued by this month for the next one; undefined when none were issued. */
    tips?: DigestTip[];
    /** Last month's tips graded against this month; undefined when none exist. */
    tipChecks?: DigestTipCheck[];
}

/* ------------------------------------------------------------------ */
/* SQL (thin)                                                          */
/* ------------------------------------------------------------------ */

/** Stored tips for (book, month), or null when none were issued. */
export async function loadIssuedTips(bookGuid: string, month: string): Promise<DigestTip[] | null> {
    const rows = await prisma.$queryRaw<Array<{ tips: unknown }>>`
        SELECT tips
        FROM gnucash_web_digest_tips
        WHERE book_guid = ${bookGuid} AND month = ${month}
        LIMIT 1
    `;
    return rows.length > 0 ? parseStoredTips(rows[0].tips) : null;
}

/** Store tips unless already issued, then return whatever is stored. */
async function issueTips(bookGuid: string, month: string, tips: DigestTip[]): Promise<DigestTip[]> {
    await prisma.$executeRaw`
        INSERT INTO gnucash_web_digest_tips (book_guid, month, tips)
        VALUES (${bookGuid}, ${month}, ${JSON.stringify(tips)}::jsonb)
        ON CONFLICT (book_guid, month) DO NOTHING
    `;
    return (await loadIssuedTips(bookGuid, month)) ?? tips;
}

/** Account guid -> top-level category (key = category account guid). */
async function loadCategoryMap(
    accountGuids: string[]
): Promise<Map<string, { key: string; name: string }>> {
    const map = new Map<string, { key: string; name: string }>();
    if (accountGuids.length === 0) return map;
    const rows = await prisma.$queryRaw<Array<{
        guid: string;
        name: string;
        level1: string | null;
        level2: string | null;
        guid1: string | null;
        guid2: string | null;
    }>>`
        SELECT guid, name, level1, level2, guid1, guid2
        FROM account_hierarchy
        WHERE guid = ANY(${accountGuids})
    `;
    for (const r of rows) {
        // Same grouping as digest.ts top categories ("Food" in Expenses:Food:...).
        map.set(r.guid, {
            key: r.guid2 || r.guid1 || r.guid,
            name: r.level2 || r.level1 || r.name,
        });
    }
    return map;
}

/** Positive charges in the month per normalized merchant key (same-day merged). */
async function loadMonthCharges(
    bookAccountGuids: string[],
    bounds: MonthBounds,
    keys: Set<string>,
    now: Date
): Promise<Record<string, TipCharge[]>> {
    if (keys.size === 0) return {};
    const monthsBack =
        (now.getUTCFullYear() - bounds.year) * 12 + (now.getUTCMonth() + 1 - bounds.monthNumber) + 1;
    const txs = await loadSpendingTransactions(bookAccountGuids, Math.max(1, monthsBack));
    const byKeyDay = new Map<string, Map<string, number>>();
    for (const tx of txs) {
        if (!(tx.amount > 0)) continue;
        if (tx.date < bounds.monthStart || tx.date > bounds.monthEnd) continue;
        const key = normalizeMerchant(tx.description);
        if (!keys.has(key)) continue;
        const day = tx.date.toISOString().slice(0, 10);
        const days = byKeyDay.get(key) ?? new Map<string, number>();
        days.set(day, (days.get(day) ?? 0) + tx.amount);
        byKeyDay.set(key, days);
    }
    const out: Record<string, TipCharge[]> = {};
    for (const [key, days] of byKeyDay) {
        out[key] = [...days].map(([date, amount]) => ({ date, amount }));
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Pure-ish assembly helpers                                           */
/* ------------------------------------------------------------------ */

function sumByCategory(
    expenseByAccount: Map<string, number>,
    categories: Map<string, { key: string; name: string }>
): Map<string, number> {
    const totals = new Map<string, number>();
    for (const [guid, amount] of expenseByAccount) {
        const key = categories.get(guid)?.key ?? guid;
        totals.set(key, (totals.get(key) ?? 0) + amount);
    }
    return totals;
}

function toSubscriptionInput(s: DigestSubscription): TipSubscriptionInput | null {
    // merchantLabel is a description from the series, so it normalizes back
    // to the series' merchant key.
    const key = normalizeMerchant(s.label);
    if (!key) return null;
    return {
        key,
        label: s.label,
        cadence: s.cadence,
        currentAmount: s.currentAmount,
        previousAmount: s.previousAmount,
        changePercent: s.changePercent,
        nextExpected: s.nextExpected,
    };
}

async function buildGenerationInput(input: ResolveDigestTipsInput): Promise<TipGenerationInput> {
    const { bounds, bookAccountGuids, baseCurrency } = input;

    // Recent complete months before the digest month, for "typical".
    const history: Array<Map<string, number>> = [];
    const expenseHistory: number[] = [];
    for (let i = 1; i <= HISTORY_MONTHS; i++) {
        const start = new Date(Date.UTC(bounds.year, bounds.monthNumber - 1 - i, 1));
        const end = new Date(Date.UTC(bounds.year, bounds.monthNumber - i, 0, 23, 59, 59, 999));
        const ie = await FinancialSummaryService.computeIncomeExpenses(bookAccountGuids, start, end, baseCurrency);
        // Months before the book had any spending are not "typical" months.
        if (!(ie.totalExpenses > 0)) continue;
        expenseHistory.push(ie.totalExpenses);
        history.push(ie.expenseByAccount);
    }

    const allGuids = new Set<string>(input.expenseByAccount.keys());
    for (const m of history) for (const g of m.keys()) allGuids.add(g);
    const categoryMap = await loadCategoryMap([...allGuids]);

    const current = sumByCategory(input.expenseByAccount, categoryMap);
    const past = history.map(m => sumByCategory(m, categoryMap));
    const names = new Map<string, string>();
    for (const { key, name } of categoryMap.values()) names.set(key, name);

    const categories = [...current]
        .filter(([, amount]) => amount > 0)
        .map(([key, amount]) => ({
            key,
            name: names.get(key) ?? 'Other',
            amount,
            history: past.map(p => Math.max(0, p.get(key) ?? 0)),
        }));

    const budgetRows = input.budget && !input.budget.outOfRange ? input.budget.rows : [];

    return {
        month: bounds.month,
        currency: input.currency,
        income: input.income,
        expenses: input.expenses,
        expenseHistory,
        categories,
        budgetRows,
        priceHikes: input.subscriptions.changed
            .filter(s => s.direction === 'up')
            .map(toSubscriptionInput)
            .filter((s): s is TipSubscriptionInput => s !== null),
        newSubscriptions: input.subscriptions.new
            .map(toSubscriptionInput)
            .filter((s): s is TipSubscriptionInput => s !== null),
    };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tips issued by this digest month (issuing them when allowed and missing)
 * and last month's tips graded against this month.
 */
export async function resolveDigestTips(input: ResolveDigestTipsInput): Promise<DigestTipsSection> {
    const now = input.now ?? new Date();
    const { bookGuid, bounds } = input;
    const policy = tipMonthPolicy(bounds.month, now);
    const section: DigestTipsSection = {};

    // 1. Tips for next month, issued from this (completed) month.
    const stored = await loadIssuedTips(bookGuid, bounds.month);
    if (stored) {
        section.tips = stored;
    } else if (policy.canIssue) {
        const generated = generateTips(await buildGenerationInput(input));
        section.tips = await issueTips(bookGuid, bounds.month, generated);
    }

    // 2. Last month's tips, graded against this month.
    const prevMonth = prevMonthKey(bounds.month);
    let previous = await loadIssuedTips(bookGuid, prevMonth);
    if (!previous && policy.isOpenMonth) {
        // Viewing the open month (the page default) before anyone opened last
        // month's digest: build it once so its tips get issued. That inner
        // digest is for a completed month, so it never recurses further.
        try {
            const { generateDigest } = await import('@/lib/digest');
            await generateDigest(bookGuid, { month: prevMonth });
            previous = await loadIssuedTips(bookGuid, prevMonth);
        } catch (error) {
            console.error('Digest tips: issuing last month\'s tips failed:', error);
        }
    }
    if (!previous) return section;

    const subKeys = new Set(
        previous.filter(t => t.kind === 'hike' || t.kind === 'new_sub').map(t => t.key)
    );
    const charges = await loadMonthCharges(input.bookAccountGuids, bounds, subKeys, now);
    const needsCategories = previous.some(t => t.kind === 'spike');
    const categoryMap = needsCategories
        ? await loadCategoryMap([...input.expenseByAccount.keys()])
        : new Map<string, { key: string; name: string }>();

    section.tipChecks = gradeTips(
        previous,
        {
            month: bounds.month,
            complete: policy.complete,
            totalExpenses: input.expenses,
            accountSpend: Object.fromEntries(input.expenseByAccount),
            categorySpend: Object.fromEntries(sumByCategory(input.expenseByAccount, categoryMap)),
            charges,
        },
        input.currency
    );
    return section;
}
