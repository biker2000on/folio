/**
 * AI budget suggestions: the server half. Loads the budget's lines and the
 * last complete months of actuals (rolled up per subtree, budget-the-parent),
 * asks the model through the AI privacy gate, and validates the reply with
 * the pure validator in ./budget-proposals.ts. Writes nothing: the budget
 * page applies the changes the user picks through the ordinary amount routes.
 *
 * Privacy: off means no call. Summary sends account tokens per path segment
 * and rounded amounts; replies are unmasked server-side with exact tokens.
 */

import prisma from '@/lib/prisma';
import { openGatedAi } from '@/lib/ai-privacy/gate';
import { unmaskStrict } from '@/lib/ai-privacy/privacy';
import { warnUnsupported } from '@/lib/ai-privacy/number-check';
import { extractJsonObject } from '@/lib/ai-query/client';
import { getAccountGuidsForBook } from '@/lib/book-scope';
import { buildBookRelativeAccountPaths } from '@/lib/account-path';
import { getBaseCurrencyForBook } from '@/lib/currency';
import { sumSplitsByAccountAndMonth } from '@/lib/reports/utils';
import { BudgetService } from '@/lib/services/budget.service';
import {
    BUDGET_ACTUAL_MONTHS,
    MAX_BUDGET_PROMPT_ACCOUNTS,
    budgetKnownNumbers,
    buildBudgetMessages,
    buildBudgetPromptPayload,
    completeMonths,
    lineState,
    periodMonthsOf,
    rollUpMonthly,
    validateBudgetProposals,
    type BudgetAccount,
    type BudgetDropReason,
    type BudgetPromptAccount,
    type BudgetPromptLine,
    type BudgetProposal,
} from './budget-proposals';

export type AiBudgetSuggestResult =
    | { ok: false; reason: 'off' | 'unconfigured' | 'not-found' | 'bad-reply' }
    | {
        ok: true;
        level: 'summary' | 'full';
        proposals: BudgetProposal[];
        dropped: number;
        reasons: Partial<Record<BudgetDropReason, number>>;
        whyDropped: number;
        /** The complete months of actuals the model saw (YYYY-MM). */
        months: string[];
    };

interface BudgetAmountRow {
    account_guid: string;
    period_num: number;
    amount_decimal: string | number;
    account?: { account_type?: string };
}

/** Ask the model for budget changes the user can apply. Never writes. */
export async function suggestBudgetChangesWithAi(opts: {
    userId: number;
    bookGuid: string;
    budgetGuid: string;
    now?: Date;
}): Promise<AiBudgetSuggestResult> {
    const budget = (await BudgetService.getById(opts.bookGuid, opts.budgetGuid)) as unknown as {
        num_periods: number;
        recurrence: { period_type?: string | null; mult?: number | null } | null;
        amounts: BudgetAmountRow[];
    } | null;
    if (!budget) return { ok: false, reason: 'not-found' };

    const guids = await getAccountGuidsForBook(opts.bookGuid);
    const gate = await openGatedAi({ userId: opts.userId, path: 'budget-suggest', accountGuids: guids });
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const { ai } = gate;

    const [book, rows, base] = await Promise.all([
        prisma.books.findUnique({ where: { guid: opts.bookGuid }, select: { root_account_guid: true } }),
        guids.length === 0 ? Promise.resolve([]) : prisma.accounts.findMany({
            where: { guid: { in: guids } },
            select: { guid: true, name: true, account_type: true, parent_guid: true, hidden: true },
        }),
        getBaseCurrencyForBook(opts.bookGuid),
    ]);
    const rootGuid = book?.root_account_guid ?? '';
    const paths = buildBookRelativeAccountPaths(rows, rootGuid);
    const accounts: BudgetAccount[] = rows
        .filter(r => r.guid !== rootGuid && r.account_type !== 'ROOT')
        .map(r => ({
            guid: r.guid,
            path: paths.get(r.guid) || r.name,
            name: r.name,
            type: r.account_type,
            parentGuid: r.parent_guid && r.parent_guid !== rootGuid ? r.parent_guid : null,
        }));
    const byGuid = new Map(accounts.map(a => [a.guid, a]));
    const hidden = new Set(rows.filter(r => r.hidden === 1).map(r => r.guid));

    // Existing lines: natural sign per period (missing periods are zero).
    const periods = new Map<string, number[]>();
    for (const amt of budget.amounts) {
        const account = byGuid.get(amt.account_guid);
        if (!account) continue;
        const list = periods.get(amt.account_guid) ?? new Array(budget.num_periods).fill(0);
        const raw = Number(amt.amount_decimal) || 0;
        if (amt.period_num >= 0 && amt.period_num < list.length) list[amt.period_num] = account.type === 'INCOME' ? -raw : raw;
        periods.set(amt.account_guid, list);
    }
    const lines = [...periods.entries()].map(([guid, list]) => lineState(guid, list));

    // Actuals for the last complete months, rolled up over each subtree.
    const window = completeMonths(opts.now ?? new Date(), BUDGET_ACTUAL_MONTHS);
    const flowAccounts = accounts.filter(a => a.type === 'EXPENSE' || a.type === 'INCOME');
    const monthly = await sumSplitsByAccountAndMonth(flowAccounts.map(a => a.guid), { gte: window.start, lt: window.end });
    const own = new Map<string, Map<string, number>>();
    for (const row of monthly) {
        const account = byGuid.get(row.accountGuid);
        if (!account) continue;
        const m = own.get(row.accountGuid) ?? new Map<string, number>();
        m.set(row.month, (m.get(row.month) ?? 0) + (account.type === 'INCOME' ? -row.quantity : row.quantity));
        own.set(row.accountGuid, m);
    }
    const rolled = rollUpMonthly(accounts, own);
    const series = (guid: string) => window.months.map(month => rolled.get(guid)?.get(month) ?? 0);

    const lineGuids = new Set(lines.map(l => l.accountGuid));
    const promptLines: BudgetPromptLine[] = lines.map(l => {
        const account = byGuid.get(l.accountGuid)!;
        return { path: account.path, type: account.type, budget: l.amount, varies: l.varies, actuals: series(l.accountGuid) };
    });
    const promptAccounts: BudgetPromptAccount[] = flowAccounts
        .filter(a => !lineGuids.has(a.guid) && !hidden.has(a.guid))
        .map(a => {
            const s = series(a.guid);
            return { path: a.path, type: a.type, average: s.reduce((x, y) => x + y, 0) / Math.max(1, s.length) };
        })
        .filter(a => Math.abs(a.average) >= 0.5)
        .sort((a, b) => Math.abs(b.average) - Math.abs(a.average) || a.path.localeCompare(b.path))
        .slice(0, MAX_BUDGET_PROMPT_ACCOUNTS);

    const payload = buildBudgetPromptPayload({
        currency: base?.mnemonic ?? 'USD',
        periodMonths: periodMonthsOf(budget.recurrence),
        months: window.months,
        lines: promptLines,
        accounts: promptAccounts,
    }, ai);
    const reply = await ai.chat(buildBudgetMessages(payload, ai.level === 'summary'), { maxTokens: 2000, timeoutMs: 45000 });
    let parsed: Record<string, unknown>;
    try {
        parsed = extractJsonObject(reply);
    } catch {
        return { ok: false, reason: 'bad-reply' };
    }

    const names = ai.names;
    const result = validateBudgetProposals(parsed.changes, {
        unmaskStrict: t => (names ? unmaskStrict(t, names) : { text: t, unknown: [] }),
        unmask: t => ai.unmask(t),
        accounts,
        lines,
        knownNumbers: budgetKnownNumbers(payload),
    });
    if (result.failedFigures.length > 0) warnUnsupported('budget-suggest', result.failedFigures);

    return {
        ok: true,
        level: ai.level,
        proposals: result.proposals,
        dropped: result.dropped,
        reasons: result.reasons,
        whyDropped: result.whyDropped,
        months: window.months,
    };
}
