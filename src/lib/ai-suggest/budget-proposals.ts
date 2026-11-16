/**
 * AI budget suggestions: the pure half (prompt payload, roll-up and
 * validation).
 *
 * The model proposes `{ account, amount | null }` changes; this code checks
 * them and nothing is saved until the user clicks Apply on the budget page,
 * which calls the ordinary amount routes. Checks:
 *
 *   - the account resolves to a budgetable account of the book (unknown → dropped)
 *   - amount is null (remove an existing line) or a finite number from 0 to
 *     MAX_BUDGET_AMOUNT, rounded to whole currency units
 *   - the change is not a no-op (same amount on a line whose periods are all equal,
 *     or removing a line that is not there)
 *   - budget-the-parent: a budget line rolls up its whole subtree, so one level
 *     per branch. A NEW line may not sit above or below an existing line unless
 *     this same set of changes removes that line; the new line then lists the
 *     removals it depends on in `requires`, and the page applies them together.
 *     Two new lines in one branch: the first wins.
 *   - at most MAX_BUDGET_PROPOSALS changes
 *
 * Amounts here are in natural sign (income planned as a positive number);
 * `rawTo` is the GnuCash-signed value to write (income stored negative).
 *
 * No database or server imports: unit-tested directly.
 */

import { BUDGETABLE_ACCOUNT_TYPES } from '@/lib/budget-constants';
import { MONEY_DISPLAY_EPSILON } from '@/lib/tolerances';
import { collectKnownNumbers, unsupportedFigures, type Figure } from '@/lib/ai-privacy/number-check';
import { SUMMARY_PROMPT_NOTE, roundMoney, tokenizeAccountPath, type Names } from '@/lib/ai-privacy/privacy';
import type { AiChatMessage } from '@/lib/ai-query/client';
import { resolveAccountRef } from './rule-proposals';

export const MAX_BUDGET_AMOUNT = 1e8;
export const MAX_BUDGET_PROPOSALS = 25;
export const MAX_BUDGET_PROPOSALS_SCANNED = 80;
/** Complete calendar months of actuals sent with each line. */
export const BUDGET_ACTUAL_MONTHS = 3;
/** Unbudgeted accounts sent as candidates for new lines. */
export const MAX_BUDGET_PROMPT_ACCOUNTS = 150;
export const MAX_BUDGET_WHY_LENGTH = 240;

export type BudgetDropReason =
    | 'malformed'
    | 'unknown-token'
    | 'unknown-account'
    | 'not-budgetable'
    | 'bad-amount'
    | 'not-a-line'
    | 'no-op'
    | 'duplicate-proposal'
    | 'conflict'
    | 'over-cap';

export interface BudgetAccount {
    guid: string;
    /** Book-relative path, e.g. "Expenses:Food". */
    path: string;
    name: string;
    type: string;
    parentGuid: string | null;
}

/** An existing budget line: the account and its per-period amount (natural sign). */
export interface BudgetLineState {
    accountGuid: string;
    /** The per-period amount when all periods are equal, else their average. */
    amount: number;
    /** True when the periods are not all equal (applying a flat amount evens them out). */
    varies: boolean;
}

export interface BudgetProposal {
    accountGuid: string;
    accountPath: string;
    accountType: string;
    /** Current per-period amount, null for a new line. */
    from: number | null;
    fromVaries: boolean;
    /** New per-period amount in whole units, null to remove the line. */
    to: number | null;
    /** `to` in GnuCash sign (income negative), what the amount route writes. */
    rawTo: number | null;
    why: string | null;
    /** Removals (account guids) this new line depends on to keep one level per branch. */
    requires: string[];
}

export interface BudgetValidationContext {
    unmaskStrict: (text: string) => { text: string; unknown: string[] };
    unmask: (text: string) => string;
    accounts: readonly BudgetAccount[];
    lines: readonly BudgetLineState[];
    /** Numbers in the payload the model saw. */
    knownNumbers: readonly number[];
}

export interface BudgetValidationResult {
    proposals: BudgetProposal[];
    dropped: number;
    reasons: Partial<Record<BudgetDropReason, number>>;
    whyDropped: number;
    failedFigures: Figure[];
}

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

/** Ancestor guids of an account, nearest first. */
export function ancestorsOf(guid: string, byGuid: ReadonlyMap<string, Pick<BudgetAccount, 'parentGuid'>>): string[] {
    const out: string[] = [];
    const seen = new Set<string>([guid]);
    let cur = byGuid.get(guid)?.parentGuid ?? null;
    while (cur && !seen.has(cur)) {
        out.push(cur);
        seen.add(cur);
        cur = byGuid.get(cur)?.parentGuid ?? null;
    }
    return out;
}

/** Members of `lines` that are an ancestor or a descendant of `guid` (not `guid` itself). */
export function branchConflicts(
    guid: string,
    lines: Iterable<string>,
    byGuid: ReadonlyMap<string, Pick<BudgetAccount, 'parentGuid'>>,
): string[] {
    const ancestors = new Set(ancestorsOf(guid, byGuid));
    const out: string[] = [];
    for (const other of lines) {
        if (other === guid) continue;
        if (ancestors.has(other) || ancestorsOf(other, byGuid).includes(guid)) out.push(other);
    }
    return out;
}

/** Natural sign → GnuCash sign for a budget amount (income is stored negative). */
export function toRawBudgetAmount(type: string, amount: number): number {
    return type === 'INCOME' ? -amount : amount;
}

/**
 * Per-account monthly totals rolled up over each account's subtree
 * (budget-the-parent). `own` maps account → month → own amount (natural sign).
 */
export function rollUpMonthly(
    accounts: ReadonlyArray<Pick<BudgetAccount, 'guid' | 'parentGuid'>>,
    own: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, Map<string, number>> {
    const byGuid = new Map(accounts.map(a => [a.guid, a]));
    const out = new Map<string, Map<string, number>>();
    for (const [guid, months] of own) {
        const chain = [guid, ...ancestorsOf(guid, byGuid)];
        for (const target of chain) {
            if (!byGuid.has(target)) continue;
            const m = out.get(target) ?? new Map<string, number>();
            for (const [month, v] of months) m.set(month, (m.get(month) ?? 0) + v);
            out.set(target, m);
        }
    }
    return out;
}

/** The last `count` complete calendar months before `now` (UTC), oldest first, and their [start, end) range. */
export function completeMonths(now: Date, count: number): { months: string[]; start: Date; end: Date } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const months: string[] = [];
    for (let i = count; i >= 1; i--) months.push(new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 7));
    return { months, start: new Date(Date.UTC(y, m - count, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Months in one budget period, from the budget's recurrence (monthly when unknown). */
export function periodMonthsOf(recurrence: { period_type?: string | null; mult?: number | null } | null | undefined): number {
    const mult = Math.max(1, Number(recurrence?.mult ?? 1) || 1);
    return recurrence?.period_type === 'year' ? 12 * mult : mult;
}

/** The representative per-period amount of a line: the common value, else the average. */
export function lineState(accountGuid: string, periodAmounts: readonly number[]): BudgetLineState {
    if (periodAmounts.length === 0) return { accountGuid, amount: 0, varies: false };
    const first = periodAmounts[0];
    const varies = periodAmounts.some(v => Math.abs(v - first) > MONEY_DISPLAY_EPSILON);
    const amount = varies ? periodAmounts.reduce((s, v) => s + v, 0) / periodAmounts.length : first;
    return { accountGuid, amount: Math.round(amount * 100) / 100, varies };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function cleanWhy(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const t = raw.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, MAX_BUDGET_WHY_LENGTH) : null;
}

interface Parsed {
    account: BudgetAccount;
    to: number | null;
    why: string | null;
}

/** Validate the model's `changes` array against the budget and the book. Pure. */
export function validateBudgetProposals(raw: unknown, ctx: BudgetValidationContext): BudgetValidationResult {
    const reasons: Partial<Record<BudgetDropReason, number>> = {};
    const drop = (r: BudgetDropReason) => {
        reasons[r] = (reasons[r] ?? 0) + 1;
    };
    const byGuid = new Map(ctx.accounts.map(a => [a.guid, a]));
    const lineByGuid = new Map(ctx.lines.map(l => [l.accountGuid, l]));
    const budgetable = new Set<string>(BUDGETABLE_ACCOUNT_TYPES);

    const list = Array.isArray(raw) ? raw : [];
    for (let i = MAX_BUDGET_PROPOSALS_SCANNED; i < list.length; i++) drop('over-cap');

    // Pass 1: parse and check each change on its own.
    const parsed: Parsed[] = [];
    const seen = new Set<string>();
    for (const item of list.slice(0, MAX_BUDGET_PROPOSALS_SCANNED)) {
        if (!item || typeof item !== 'object') {
            drop('malformed');
            continue;
        }
        const p = item as Record<string, unknown>;
        if (typeof p.account !== 'string' || !('amount' in p)) {
            drop('malformed');
            continue;
        }
        const ua = ctx.unmaskStrict(p.account);
        if (ua.unknown.length > 0) {
            drop('unknown-token');
            continue;
        }
        const resolved = resolveAccountRef(ua.text, ctx.accounts);
        if (!resolved) {
            drop('unknown-account');
            continue;
        }
        const account = byGuid.get(resolved.guid)!;
        if (!budgetable.has(account.type)) {
            drop('not-budgetable');
            continue;
        }
        let to: number | null;
        if (p.amount === null) {
            to = null;
        } else if (typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0 && p.amount <= MAX_BUDGET_AMOUNT) {
            to = Math.round(p.amount);
        } else {
            drop('bad-amount');
            continue;
        }
        const line = lineByGuid.get(account.guid);
        if (to === null && !line) {
            drop('not-a-line');
            continue;
        }
        if (to !== null && line && !line.varies && line.amount === to) {
            drop('no-op');
            continue;
        }
        if (seen.has(account.guid)) {
            drop('duplicate-proposal');
            continue;
        }
        seen.add(account.guid);
        parsed.push({ account, to, why: cleanWhy(p.why) });
    }

    // Pass 2: budget-the-parent. Removals first, so a new line may rely on them.
    const removals = new Set(parsed.filter(c => c.to === null).map(c => c.account.guid));
    const existing = new Set(ctx.lines.map(l => l.accountGuid));
    const added = new Set<string>();
    const accepted: Array<Parsed & { requires: string[] }> = [];
    for (const c of parsed) {
        const isNew = c.to !== null && !existing.has(c.account.guid);
        let requires: string[] = [];
        if (isNew) {
            if (branchConflicts(c.account.guid, added, byGuid).length > 0) {
                drop('conflict');
                continue;
            }
            const withExisting = branchConflicts(c.account.guid, existing, byGuid);
            if (withExisting.some(g => !removals.has(g))) {
                drop('conflict');
                continue;
            }
            requires = withExisting.sort();
            added.add(c.account.guid);
        }
        accepted.push({ ...c, requires });
    }

    // Pass 3: cap, then number-check the why text.
    const proposals: BudgetProposal[] = [];
    const failedFigures: Figure[] = [];
    let whyDropped = 0;
    for (const c of accepted) {
        if (proposals.length >= MAX_BUDGET_PROPOSALS) {
            drop('over-cap');
            continue;
        }
        const line = lineByGuid.get(c.account.guid);
        let why = c.why;
        if (why) {
            // The model's own proposed amount is a figure it may name.
            const bad = unsupportedFigures(why, [...ctx.knownNumbers, ...(c.to !== null ? [c.to] : [])]);
            if (bad.length > 0) {
                failedFigures.push(...bad);
                why = null;
                whyDropped++;
            } else {
                why = ctx.unmask(why);
            }
        }
        proposals.push({
            accountGuid: c.account.guid,
            accountPath: c.account.path,
            accountType: c.account.type,
            from: line ? line.amount : null,
            fromVaries: line?.varies ?? false,
            to: c.to,
            rawTo: c.to === null ? null : toRawBudgetAmount(c.account.type, c.to),
            why,
            requires: c.requires,
        });
    }
    // A new line whose required removal was capped away cannot be applied safely.
    const kept = new Set(proposals.map(p => p.accountGuid));
    const final = proposals.filter(p => {
        if (p.requires.every(g => kept.has(g))) return true;
        drop('conflict');
        return false;
    });

    const dropped = Object.values(reasons).reduce((s, n) => s + (n ?? 0), 0);
    return { proposals: final, dropped, reasons, whyDropped, failedFigures };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export interface BudgetPromptPrivacy {
    level: 'summary' | 'full';
    names: Names | null;
}

export interface BudgetPromptLine {
    path: string;
    type: string;
    /** Per-period amount, natural sign. */
    budget: number;
    varies: boolean;
    /** Rolled-up actuals per month (natural sign), oldest first. */
    actuals: number[];
}

export interface BudgetPromptAccount {
    path: string;
    type: string;
    /** Average of the rolled-up monthly actuals over the window. */
    average: number;
}

export interface BudgetPromptPayload {
    currency: string;
    /** Months in one budget period (1 for a monthly budget, 12 for yearly). */
    periodMonths: number;
    months: string[];
    lines: Array<{ a: string; t: string; budget: number; varies?: true; actuals: number[] }>;
    accounts: Array<{ a: string; t: string; average: number }>;
}

/**
 * The payload the model sees. Summary: account path segments become tokens,
 * every amount is rounded (roundMoney). Months are already YYYY-MM. Pure.
 */
export function buildBudgetPromptPayload(
    input: {
        currency: string;
        periodMonths: number;
        months: string[];
        lines: readonly BudgetPromptLine[];
        accounts: readonly BudgetPromptAccount[];
    },
    privacy: BudgetPromptPrivacy,
): BudgetPromptPayload {
    const summary = privacy.level === 'summary' && privacy.names ? privacy.names : null;
    const name = (path: string) => (summary ? tokenizeAccountPath(summary, path) : path);
    const money = (n: number) => (summary ? roundMoney(n) : Math.round(n * 100) / 100);
    return {
        currency: input.currency,
        periodMonths: input.periodMonths,
        months: input.months,
        lines: input.lines.map(l => ({
            a: name(l.path),
            t: l.type,
            budget: money(l.budget),
            ...(l.varies ? { varies: true as const } : {}),
            actuals: l.actuals.map(money),
        })),
        accounts: input.accounts.slice(0, MAX_BUDGET_PROMPT_ACCOUNTS).map(a => ({
            a: name(a.path),
            t: a.type,
            average: money(a.average),
        })),
    };
}

/** Chat messages for the budget suggestion call. Pure. */
export function buildBudgetMessages(payload: BudgetPromptPayload, summary: boolean): AiChatMessage[] {
    const period = payload.periodMonths === 1 ? 'month' : `${payload.periodMonths} months`;
    const system = [
        'You review a personal budget and suggest changes.',
        `Budget amounts are per budget period (one period = ${period}), in ${payload.currency}.`,
        'You get the budget lines (a: account, t: type, budget: amount per period, actuals: spending or income per month',
        'for the listed months, already including every sub-account) and other accounts with their monthly average.',
        'A budget line covers its account and all its sub-accounts, so never budget an account and its parent or child.',
        'To replace a line with a more detailed or broader one, remove the old line (amount null) and add the new one.',
        'Reply with ONLY a JSON object: { "changes": [{ "account": string, "amount": number | null, "why": string }] }.',
        '- `account` must be copied exactly from the lists.',
        '- `amount` is the new amount per period as a whole number, or null to remove the line.',
        '- Only suggest changes the actuals clearly support. Fewer, better changes beat many small ones.',
        '- `why` is one short plain sentence. Only use figures from the data or your proposed amount.',
        `- At most ${MAX_BUDGET_PROPOSALS} changes.`,
        ...(summary ? ['', SUMMARY_PROMPT_NOTE] : []),
    ].join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

/** Numbers in the payload the model saw (for the why check). Pure. */
export function budgetKnownNumbers(payload: BudgetPromptPayload): number[] {
    return collectKnownNumbers(payload);
}
