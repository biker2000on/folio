/**
 * Monthly digest tips: issue up to three concrete, checkable tips from a
 * completed month, then grade them against the following month's actuals.
 *
 * Deterministic and code-computed (no AI). Pure: no DB, no clock, no
 * server-only imports, so the digest page can import these types and helpers.
 * The DB side (loading history, persisting issued tips, loading the next
 * month's charges) lives in `digest-tips-store.ts`.
 *
 * Flow: the digest for month M issues tips for M+1 (stored once per book and
 * month so re-generating never moves the goalposts). The digest for M+1 loads
 * those tips and grades each one against M+1's figures.
 */

import { formatCurrency } from '@/lib/format';
import type { Cadence } from '@/lib/recurring-detection';
import type { DigestBudgetRow } from '@/lib/digest';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/** At most this many tips per month, most valuable first. */
export const MAX_TIPS = 3;

// Every threshold below is a judgment call; adjust freely.
export const MIN_HISTORY_MONTHS = 3; // tunable: complete prior months needed before "typical" means anything
export const PACE_ABOVE_TYPICAL_RATIO = 1.2; // tunable: pace fires when spending >= typical x this...
export const PACE_MIN_EXCESS = 100; // tunable: ...and is at least this many units above typical
// tunable: the "spent more than income" tip needs income of at least this share of a typical month's
// spending (this month's when there is no history). Below it, income is likely recorded elsewhere
// (another book, an untracked account) and "keep spending under $37" would be nonsense.
export const PACE_MIN_INCOME_SHARE = 0.5;
export const BUDGET_MIN_OVER = 10; // tunable: budget fires when over by >= max(this,
export const BUDGET_MIN_OVER_PCT = 0.05; // tunable: ...this share of the budgeted amount)
export const SPIKE_RATIO = 1.5; // tunable: spike fires when a category >= typical x this...
export const SPIKE_MIN_EXCESS = 75; // tunable: ...and is at least this many units above typical...
export const SPIKE_MIN_TYPICAL = 25; // tunable: ...and its typical month is at least this (skips one-offs)
export const SPIKE_CHECK_TOLERANCE = 1.1; // tunable: spike check holds at <= typical x this
export const HIKE_MIN_INCREASE = 1; // tunable: hike needs this much more per charge (digest already requires +5%)
export const HIKE_CHECK_TOLERANCE = 1.02; // tunable: hike check holds when the next charge <= old x this
export const NEW_SUB_MIN_MONTHLY = 3; // tunable: skip new recurring charges cheaper than this per month

/** Sub-cent slack for "actual <= target" comparisons. */
const EPSILON = 0.005;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DigestTipKind = 'pace' | 'budget' | 'spike' | 'hike' | 'new_sub';

export type DigestTipOutcome = 'held' | 'missed' | 'neutral';

export interface DigestTip {
    kind: DigestTipKind;
    /**
     * Stable identity of what the tip is about: 'total' (pace), the budget
     * account guid (budget), the top-level category account guid (spike), or
     * the normalized merchant key (hike, new_sub).
     */
    key: string;
    /** Display name: category / account / merchant, or "Total spending". */
    label: string;
    /**
     * Headline figure: the spending cap (pace, budget), the typical month
     * (spike), the old price (hike), or the monthly cost (new_sub).
     */
    amount: number;
    /**
     * Threshold the check compares against: amount (pace, budget),
     * typical x 1.1 (spike), old price x 1.02 (hike). 0 for new_sub, which
     * has no threshold (it is held only when the charge stops).
     */
    target: number;
    /** The issuing month's figure that triggered the tip. */
    observed: number;
    /** One-line action. */
    text: string;
    /** One-line reason. */
    why: string;
    /** YYYY-MM-DD: last day of the month the tip is for. */
    actBy: string;
    /** YYYY-MM: the digest month that issued the tip. */
    issuedMonth: string;
    /** YYYY-MM: the month the tip is graded against (issuedMonth + 1). */
    forMonth: string;
    /** Estimated monthly currency at stake; drives ordering. */
    impact: number;
    /** hike / new_sub only */
    cadence?: Cadence;
    /** hike / new_sub only: next expected charge as of issuing (YYYY-MM-DD). */
    nextExpected?: string;
}

export interface DigestTipCheck {
    tip: DigestTip;
    /** The figure the check read in the graded month. */
    actual: number;
    outcome: DigestTipOutcome;
    /** False while the graded month is still in progress (provisional). */
    final: boolean;
    /** One-line result. */
    text: string;
}

export interface TipCategoryInput {
    /** Stable category key (top-level category account guid). */
    key: string;
    name: string;
    /** Spend in the issuing month. */
    amount: number;
    /** Spend in each recent complete month before it (0 when none). */
    history: number[];
}

export interface TipSubscriptionInput {
    /** Normalized merchant key. */
    key: string;
    label: string;
    cadence: Cadence;
    /** Latest charge. */
    currentAmount: number;
    /** Typical charge before the latest one. */
    previousAmount: number;
    changePercent: number;
    /** YYYY-MM-DD */
    nextExpected: string;
}

export interface TipGenerationInput {
    /** YYYY-MM: the completed month the tips are issued from. */
    month: string;
    currency: string;
    /** Positive income for the month (GnuCash credits already negated). */
    income: number;
    /** Positive expenses for the month. */
    expenses: number;
    /** Total expenses of recent complete months before `month`. */
    expenseHistory: number[];
    categories: TipCategoryInput[];
    /** Budget rows for the month (omit when the month is outside the budget). */
    budgetRows: DigestBudgetRow[];
    /** Subscriptions whose price went up this month. */
    priceHikes: TipSubscriptionInput[];
    /** Recurring charges first seen this month. */
    newSubscriptions: TipSubscriptionInput[];
}

export interface TipCharge {
    /** YYYY-MM-DD */
    date: string;
    amount: number;
}

export interface TipGradingFacts {
    /** YYYY-MM: the month being graded. */
    month: string;
    /** True once the month has ended. */
    complete: boolean;
    /** Positive total expenses for the month. */
    totalExpenses: number;
    /** Positive spend per expense account guid. */
    accountSpend: Record<string, number>;
    /** Positive spend per top-level category key. */
    categorySpend: Record<string, number>;
    /** Charges in the month per normalized merchant key. */
    charges: Record<string, TipCharge[]>;
}

/* ------------------------------------------------------------------ */
/* Month helpers                                                       */
/* ------------------------------------------------------------------ */

function parseMonth(month: string): { year: number; monthNumber: number } {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!m) throw new Error(`Invalid month "${month}" (expected YYYY-MM)`);
    return { year: parseInt(m[1], 10), monthNumber: parseInt(m[2], 10) };
}

function keyOf(year: number, monthIndex0: number): string {
    const d = new Date(Date.UTC(year, monthIndex0, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM of the month after `month` (Dec rolls into Jan of the next year). */
export function nextMonthKey(month: string): string {
    const { year, monthNumber } = parseMonth(month);
    return keyOf(year, monthNumber);
}

/** YYYY-MM of the month before `month` (Jan rolls back to Dec of the prior year). */
export function prevMonthKey(month: string): string {
    const { year, monthNumber } = parseMonth(month);
    return keyOf(year, monthNumber - 2);
}

/** YYYY-MM-DD of the last day of `month`. */
export function monthEndIso(month: string): string {
    const { year, monthNumber } = parseMonth(month);
    return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

/** YYYY-MM for a date, in UTC (matches digest.ts month selection). */
export function monthKeyOf(date: Date): string {
    return keyOf(date.getUTCFullYear(), date.getUTCMonth());
}

/** "December" (or "December 2026" with year). */
export function monthName(month: string, withYear = false): string {
    const { year, monthNumber } = parseMonth(month);
    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        ...(withYear ? { year: 'numeric' as const } : {}),
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

/** "Dec 31" for a YYYY-MM-DD. */
function shortDay(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
}

export interface TipMonthPolicy {
    /** The month has ended (UTC). */
    complete: boolean;
    /** The month is the current, still-open month. */
    isOpenMonth: boolean;
    /**
     * Tips may be issued from this month: it is complete AND it is the most
     * recently completed month. Older months are never issued retroactively,
     * so every graded tip was live while the month it targets was open.
     */
    canIssue: boolean;
}

export function tipMonthPolicy(month: string, now: Date): TipMonthPolicy {
    const current = monthKeyOf(now);
    const complete = month < current;
    return {
        complete,
        isOpenMonth: month === current,
        canIssue: complete && nextMonthKey(month) === current,
    };
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function round2(value: number): number {
    const r = Math.round(value * 100) / 100;
    return r === 0 ? 0 : r;
}

/** Median of the values; 0 for an empty list. */
export function median(values: number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Charges per month for a cadence (weekly 52/12, quarterly 1/3, annual 1/12). */
export function monthlyFactor(cadence: Cadence): number {
    switch (cadence) {
        case 'weekly': return 52 / 12;
        case 'quarterly': return 1 / 3;
        case 'annual': return 1 / 12;
        default: return 1;
    }
}

const KIND_ORDER: Record<DigestTipKind, number> = {
    pace: 0,
    budget: 1,
    spike: 2,
    hike: 3,
    new_sub: 4,
};

/**
 * Issue at most MAX_TIPS tips for the month after `input.month`, most
 * valuable (largest monthly impact) first. Returns [] when nothing qualifies.
 */
export function generateTips(input: TipGenerationInput): DigestTip[] {
    const fmt = (n: number) => formatCurrency(n, input.currency);
    const forMonth = nextMonthKey(input.month);
    const actBy = monthEndIso(forMonth);
    const thisName = monthName(input.month);
    const nextName = monthName(forMonth);
    const base = { actBy, issuedMonth: input.month, forMonth };

    const candidates: DigestTip[] = [];

    // pace: spending past income, or well above a typical month.
    const expenses = round2(input.expenses);
    const income = round2(input.income);
    const pastMonths = input.expenseHistory.filter(v => v > 0);
    const typicalSpend = pastMonths.length >= MIN_HISTORY_MONTHS ? round2(median(pastMonths)) : 0;
    const incomeLooksComplete = income >= (typicalSpend > 0 ? typicalSpend : expenses) * PACE_MIN_INCOME_SHARE;
    if (income > 0 && expenses > income && incomeLooksComplete) {
        const cap = Math.floor(income);
        candidates.push({
            ...base,
            kind: 'pace',
            key: 'total',
            label: 'Total spending',
            amount: cap,
            target: cap,
            observed: expenses,
            text: `Keep total spending under ${fmt(cap)} in ${nextName}.`,
            why: `${thisName} spending of ${fmt(expenses)} was ${fmt(expenses - income)} more than income.`,
            impact: round2(expenses - cap),
        });
    } else if (
        typicalSpend > 0 &&
        expenses >= typicalSpend * PACE_ABOVE_TYPICAL_RATIO &&
        expenses - typicalSpend >= PACE_MIN_EXCESS
    ) {
        const cap = Math.floor(typicalSpend);
        candidates.push({
            ...base,
            kind: 'pace',
            key: 'total',
            label: 'Total spending',
            amount: cap,
            target: cap,
            observed: expenses,
            text: `Keep total spending under ${fmt(cap)} in ${nextName}.`,
            why: `${thisName} spending of ${fmt(expenses)} ran ${fmt(expenses - typicalSpend)} above a typical month (${fmt(typicalSpend)}).`,
            impact: round2(expenses - cap),
        });
    }

    // budget: a budget line went over.
    for (const row of input.budgetRows) {
        if (row.status !== 'over' || row.budgeted <= 0) continue;
        const over = round2(row.actual - row.budgeted);
        if (over < Math.max(BUDGET_MIN_OVER, row.budgeted * BUDGET_MIN_OVER_PCT)) continue;
        candidates.push({
            ...base,
            kind: 'budget',
            key: row.accountGuid,
            label: row.accountName,
            amount: round2(row.budgeted),
            target: round2(row.budgeted),
            observed: round2(row.actual),
            text: `Keep ${row.accountName} under its ${fmt(row.budgeted)} budget in ${nextName}.`,
            why: `It reached ${fmt(row.actual)} in ${thisName}, ${fmt(over)} over.`,
            impact: over,
        });
    }

    // spike: a category far above its typical month.
    for (const c of input.categories) {
        if (c.history.length < MIN_HISTORY_MONTHS) continue;
        const typical = round2(median(c.history));
        const amount = round2(c.amount);
        if (typical < SPIKE_MIN_TYPICAL) continue;
        if (amount < typical * SPIKE_RATIO || amount - typical < SPIKE_MIN_EXCESS) continue;
        candidates.push({
            ...base,
            kind: 'spike',
            key: c.key,
            label: c.name,
            amount: typical,
            target: round2(typical * SPIKE_CHECK_TOLERANCE),
            observed: amount,
            text: `Bring ${c.name} back to about ${fmt(typical)} in ${nextName}.`,
            why: `${thisName} came in at ${fmt(amount)}, ${(amount / typical).toFixed(1)}× a typical month.`,
            impact: round2(amount - typical),
        });
    }

    // hike: a subscription's price went up.
    for (const s of input.priceHikes) {
        const increase = round2(s.currentAmount - s.previousAmount);
        if (increase < HIKE_MIN_INCREASE || s.previousAmount <= 0) continue;
        candidates.push({
            ...base,
            kind: 'hike',
            key: s.key,
            label: s.label,
            amount: round2(s.previousAmount),
            target: round2(s.previousAmount * HIKE_CHECK_TOLERANCE),
            observed: round2(s.currentAmount),
            text: `Ask ${s.label} for the old ${fmt(s.previousAmount)} price, or cancel, before ${shortDay(actBy)}.`,
            why: `The charge went up to ${fmt(s.currentAmount)} (+${s.changePercent.toFixed(1)}%).`,
            impact: round2(increase * monthlyFactor(s.cadence)),
            cadence: s.cadence,
            nextExpected: s.nextExpected,
        });
    }

    // new_sub: a new recurring charge appeared.
    for (const s of input.newSubscriptions) {
        const monthly = round2(s.currentAmount * monthlyFactor(s.cadence));
        if (monthly < NEW_SUB_MIN_MONTHLY) continue;
        candidates.push({
            ...base,
            kind: 'new_sub',
            key: s.key,
            label: s.label,
            amount: monthly,
            target: 0,
            observed: round2(s.currentAmount),
            text: `Decide whether ${s.label} is worth ${fmt(monthly)}/mo before ${shortDay(actBy)}.`,
            why: `New recurring charge, first seen in ${thisName}.`,
            impact: monthly,
            cadence: s.cadence,
            nextExpected: s.nextExpected,
        });
    }

    candidates.sort(
        (a, b) =>
            b.impact - a.impact ||
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            a.key.localeCompare(b.key)
    );

    // One tip per subject (a budget line can also be a top-level category).
    const seen = new Set<string>();
    const tips: DigestTip[] = [];
    for (const tip of candidates) {
        if (tip.impact <= 0 || seen.has(tip.key)) continue;
        seen.add(tip.key);
        tips.push(tip);
        if (tips.length >= MAX_TIPS) break;
    }
    return tips;
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

function capCheck(tip: DigestTip, actual: number, final: boolean, currency: string): DigestTipCheck {
    const fmt = (n: number) => formatCurrency(n, currency);
    const held = actual <= tip.target + EPSILON;
    const subject = tip.kind === 'pace' ? 'Spending' : tip.label;
    const over = round2(actual - tip.target);
    let text: string;
    if (final) {
        text = held
            ? `${subject} came to ${fmt(actual)}, under the ${fmt(tip.target)} target.`
            : `${subject} came to ${fmt(actual)}, ${fmt(over)} over the ${fmt(tip.target)} target.`;
    } else {
        text = held
            ? `${subject} is at ${fmt(actual)} so far, against a ${fmt(tip.target)} target.`
            : `${subject} is already ${fmt(actual)}, ${fmt(over)} past the ${fmt(tip.target)} target.`;
    }
    return { tip, actual: round2(actual), outcome: held ? 'held' : 'missed', final, text };
}

function subscriptionCheck(
    tip: DigestTip,
    facts: TipGradingFacts,
    currency: string
): DigestTipCheck {
    const fmt = (n: number) => formatCurrency(n, currency);
    const final = facts.complete;
    const charges = [...(facts.charges[tip.key] ?? [])]
        .filter(c => c.amount > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (charges.length === 0) {
        // A charge was due by the end of the graded month and never came.
        const wasDue = !!tip.nextExpected && tip.nextExpected <= monthEndIso(facts.month);
        if (final && wasDue) {
            return {
                tip,
                actual: 0,
                outcome: 'held',
                final,
                text: `No ${tip.label} charge when one was due. It looks cancelled.`,
            };
        }
        return {
            tip,
            actual: 0,
            outcome: 'neutral',
            final,
            text: final ? `No ${tip.label} charge this month; none was due.` : `No ${tip.label} charge yet this month.`,
        };
    }

    if (tip.kind === 'hike') {
        const next = round2(charges[0].amount);
        const held = next <= tip.target + EPSILON;
        return {
            tip,
            actual: next,
            outcome: held ? 'held' : 'missed',
            final: true, // the next charge has landed; it will not change
            text: held
                ? `${tip.label} charged ${fmt(next)}, back near the old ${fmt(tip.amount)}.`
                : `${tip.label} still charges ${fmt(next)} (was ${fmt(tip.amount)}).`,
        };
    }

    // new_sub: still being charged. Not a failure, just still active.
    const total = round2(charges.reduce((s, c) => s + c.amount, 0));
    return {
        tip,
        actual: total,
        outcome: 'neutral',
        final,
        text: `${tip.label} is still active (${fmt(total)} this month).`,
    };
}

/**
 * Grade tips issued for `facts.month` against that month's figures. Tips
 * meant for another month are skipped. Pure and deterministic.
 */
export function gradeTips(
    tips: DigestTip[],
    facts: TipGradingFacts,
    currency: string
): DigestTipCheck[] {
    const checks: DigestTipCheck[] = [];
    for (const tip of tips) {
        if (tip.forMonth !== facts.month) continue;
        switch (tip.kind) {
            case 'pace':
                checks.push(capCheck(tip, facts.totalExpenses, facts.complete, currency));
                break;
            case 'budget':
                checks.push(capCheck(tip, facts.accountSpend[tip.key] ?? 0, facts.complete, currency));
                break;
            case 'spike':
                checks.push(capCheck(tip, facts.categorySpend[tip.key] ?? 0, facts.complete, currency));
                break;
            case 'hike':
            case 'new_sub':
                checks.push(subscriptionCheck(tip, facts, currency));
                break;
        }
    }
    return checks;
}

/* ------------------------------------------------------------------ */
/* Stored-shape validation and text rendering                          */
/* ------------------------------------------------------------------ */

const KINDS = new Set<DigestTipKind>(['pace', 'budget', 'spike', 'hike', 'new_sub']);

/** Keep only well-formed tips from a stored JSONB value. */
export function parseStoredTips(value: unknown): DigestTip[] {
    const raw = typeof value === 'string' ? safeJson(value) : value;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is DigestTip =>
        !!t &&
        typeof t === 'object' &&
        KINDS.has((t as DigestTip).kind) &&
        typeof (t as DigestTip).key === 'string' &&
        typeof (t as DigestTip).amount === 'number' &&
        typeof (t as DigestTip).target === 'number' &&
        typeof (t as DigestTip).forMonth === 'string' &&
        typeof (t as DigestTip).text === 'string'
    );
}

function safeJson(s: string): unknown {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

const OUTCOME_WORD: Record<DigestTipOutcome, string> = {
    held: 'Held',
    missed: 'Missed',
    neutral: 'Still open',
};

/** Compact markdown lines for the notification / email body. */
export function tipsSummaryLines(opts: {
    month: string;
    tips?: DigestTip[];
    tipChecks?: DigestTipCheck[];
}): string[] {
    const lines: string[] = [];
    const checks = opts.tipChecks ?? [];
    if (checks.length > 0) {
        lines.push('');
        lines.push(`**How ${monthName(prevMonthKey(opts.month))}'s tips went**`);
        for (const c of checks) {
            const word = c.final ? OUTCOME_WORD[c.outcome] : `${OUTCOME_WORD[c.outcome]} so far`;
            lines.push(`- ${word}: ${c.text}`);
        }
    }
    const tips = opts.tips ?? [];
    if (tips.length > 0) {
        lines.push('');
        lines.push(`**Tips for ${monthName(nextMonthKey(opts.month))}**`);
        for (const t of tips) lines.push(`- ${t.text}`);
    }
    return lines;
}
