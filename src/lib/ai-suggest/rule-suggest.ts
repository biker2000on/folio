/**
 * AI rule suggestions: the server half. Loads the book's history, asks the
 * model through the AI privacy gate, and validates what comes back with the
 * pure validator in ./rule-proposals.ts. Writes nothing: the Rules page
 * creates the rules the user picks through the ordinary create route.
 *
 * Complements the deterministic learned suggestions (suggestRules): the model
 * only sees descriptions those do not cover, which are descriptions seen
 * fewer than 3 times, without a clear majority account, or sitting in
 * Imbalance/Orphan, and that no existing rule already takes.
 *
 * Privacy: off means no call (openGatedAi returns { ok: false }). Summary
 * sends merchant tokens for descriptions and account tokens for path
 * segments; replies are unmasked server-side with exact-token matching.
 */

import prisma from '@/lib/prisma';
import { openGatedAi } from '@/lib/ai-privacy/gate';
import { unmaskStrict } from '@/lib/ai-privacy/privacy';
import { warnUnsupported } from '@/lib/ai-privacy/number-check';
import { extractJsonObject } from '@/lib/ai-query/client';
import { getAccountGuidsForBook } from '@/lib/book-scope';
import { buildBookRelativeAccountPaths } from '@/lib/account-path';
import { listRules, suggestRules } from '@/lib/services/categorization.service';
import {
    MAX_RULE_PROMPT_ACCOUNTS,
    buildRuleMessages,
    buildRulePromptPayload,
    pickRuleCandidates,
    ruleKnownNumbers,
    validateRuleProposals,
    type HistoryDescription,
    type RuleDropReason,
    type RuleProposal,
    type RuleTargetAccount,
} from './rule-proposals';

export type AiRuleSuggestResult =
    | { ok: false; reason: 'off' | 'unconfigured' | 'bad-reply' }
    | {
        ok: true;
        level: 'summary' | 'full';
        proposals: RuleProposal[];
        dropped: number;
        reasons: Partial<Record<RuleDropReason, number>>;
        whyDropped: number;
        /** Description groups sent to the model. */
        considered: number;
    };

/** Account names that mean "not categorised yet". */
const UNCATEGORIZED_ACCOUNT_RE = '^((imbalance|orphan)(-[a-z]{3})?|uncategori[sz]ed.*)$';

interface BookAccountRow {
    guid: string;
    name: string;
    account_type: string;
    parent_guid: string | null;
    placeholder: number | null;
    hidden: number | null;
}

async function loadAccounts(bookGuid: string, guids: string[]): Promise<{ all: RuleTargetAccount[]; leaves: RuleTargetAccount[] }> {
    const book = await prisma.books.findUnique({ where: { guid: bookGuid }, select: { root_account_guid: true } });
    if (!book || guids.length === 0) return { all: [], leaves: [] };
    const rows = (await prisma.accounts.findMany({
        where: { guid: { in: guids } },
        select: { guid: true, name: true, account_type: true, parent_guid: true, placeholder: true, hidden: true },
    })) as BookAccountRow[];
    const paths = buildBookRelativeAccountPaths(rows, book.root_account_guid);
    const parents = new Set(rows.map(r => r.parent_guid).filter((g): g is string => !!g));
    const all = rows
        .filter(r => r.guid !== book.root_account_guid && r.account_type !== 'ROOT')
        .map(r => ({
            guid: r.guid,
            path: paths.get(r.guid) || r.name,
            name: r.name,
            type: r.account_type,
            placeholder: r.placeholder === 1,
            hidden: r.hidden === 1,
        }));
    const leaves = all
        .filter(a => (a.type === 'EXPENSE' || a.type === 'INCOME') && !a.placeholder && !a.hidden && !parents.has(a.guid))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, MAX_RULE_PROMPT_ACCOUNTS);
    return { all: all.map(({ hidden: _h, ...a }) => a), leaves: leaves.map(({ hidden: _h, ...a }) => a) };
}

/**
 * Every distinct payee text in the book with its transaction count and how
 * many of those sit on an uncategorised account. The payee is the preserved
 * import-time description when there is one, as for rule matching on import.
 */
async function loadHistory(guids: string[]): Promise<{ history: HistoryDescription[]; totalTransactions: number }> {
    if (guids.length === 0) return { history: [], totalTransactions: 0 };
    const [rows, total] = await Promise.all([
        prisma.$queryRaw<Array<{ description: string; count: number; uncategorized: number }>>`
            SELECT p.payee AS description,
                   COUNT(*)::int AS count,
                   COUNT(*) FILTER (WHERE p.uncategorized)::int AS uncategorized
            FROM (
                SELECT t.guid,
                       btrim(COALESCE(NULLIF(btrim(m.original_description), ''), t.description)) AS payee,
                       EXISTS (
                           SELECT 1 FROM splits su JOIN accounts au ON au.guid = su.account_guid
                           WHERE su.tx_guid = t.guid
                             AND su.account_guid = ANY(${guids}::text[])
                             AND au.name ~* ${UNCATEGORIZED_ACCOUNT_RE}
                       ) AS uncategorized
                FROM transactions t
                LEFT JOIN gnucash_web_transaction_meta m ON m.transaction_guid = t.guid
                WHERE EXISTS (
                    SELECT 1 FROM splits sb
                    WHERE sb.tx_guid = t.guid AND sb.account_guid = ANY(${guids}::text[])
                )
            ) p
            WHERE p.payee IS NOT NULL AND p.payee <> ''
            GROUP BY p.payee
        `,
        prisma.$queryRaw<Array<{ n: number }>>`
            SELECT COUNT(DISTINCT s.tx_guid)::int AS n
            FROM splits s
            WHERE s.account_guid = ANY(${guids}::text[])
        `,
    ]);
    return {
        history: rows.map(r => ({ description: r.description, count: Number(r.count), uncategorized: Number(r.uncategorized) })),
        totalTransactions: Number(total[0]?.n ?? 0),
    };
}

/** Ask the model for rules the user can apply. Never writes. */
export async function suggestRulesWithAi(opts: { userId: number; bookGuid: string }): Promise<AiRuleSuggestResult> {
    const guids = await getAccountGuidsForBook(opts.bookGuid);
    const gate = await openGatedAi({ userId: opts.userId, path: 'rule-suggest', accountGuids: guids });
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const { ai } = gate;

    const [{ all, leaves }, { history, totalTransactions }, existingRules, learned] = await Promise.all([
        loadAccounts(opts.bookGuid, guids),
        loadHistory(guids),
        listRules(opts.bookGuid),
        suggestRules(opts.bookGuid),
    ]);

    const candidates = pickRuleCandidates(history, existingRules, learned.map(s => s.pattern));
    if (candidates.length === 0 || leaves.length === 0) {
        return { ok: true, level: ai.level, proposals: [], dropped: 0, reasons: {}, whyDropped: 0, considered: 0 };
    }

    const payload = buildRulePromptPayload(candidates, leaves, ai);
    const reply = await ai.chat(buildRuleMessages(payload, ai.level === 'summary'), { maxTokens: 2000, timeoutMs: 45000 });
    let parsed: Record<string, unknown>;
    try {
        parsed = extractJsonObject(reply);
    } catch {
        return { ok: false, reason: 'bad-reply' };
    }

    const names = ai.names;
    const result = validateRuleProposals(parsed.rules, {
        unmaskStrict: t => (names ? unmaskStrict(t, names) : { text: t, unknown: [] }),
        unmask: t => ai.unmask(t),
        accounts: all,
        existingRules,
        history,
        totalTransactions,
        knownNumbers: ruleKnownNumbers(payload),
    });
    if (result.failedFigures.length > 0) warnUnsupported('rule-suggest', result.failedFigures);

    return {
        ok: true,
        level: ai.level,
        proposals: result.proposals,
        dropped: result.dropped,
        reasons: result.reasons,
        whyDropped: result.whyDropped,
        considered: candidates.length,
    };
}
