// src/lib/ai-query/answer.ts

/**
 * Final answer composition: sends the query results back to the model for a
 * concise natural-language answer, plus optional drill-down links into the
 * ledger and specific account pages.
 *
 * Goes through the privacy gate's session. In summary mode the model sees
 * scrubbed rows (names as tokens, money rounded, dates as YYYY-MM, GUIDs kept)
 * and the reply is unmasked before the user sees it. Either way every currency
 * figure and percentage in the answer must match a number the model was given
 * (see src/lib/ai-privacy/number-check.ts); otherwise the deterministic
 * fallback answer is used. The result table shown to the user always holds the
 * exact rows; only the model's copy is summarised.
 */

import type { GatedAi } from '@/lib/ai-privacy/session';
import { SUMMARY_PROMPT_NOTE } from '@/lib/ai-privacy/privacy';
import { collectKnownNumbers, unsupportedFigures, warnUnsupported } from '@/lib/ai-privacy/number-check';
import { extractJsonObject, type AiChatMessage } from './client';
import type { QueryRow } from './execute';

export interface DrillDownLink {
    label: string;
    href: string;
}

export interface ComposedAnswer {
    answer: string;
    links: DrillDownLink[];
}

const MAX_ROWS_TO_MODEL = 50;
const GUID_RE = /^[0-9a-f]{32}$/i;

const ANSWER_SYSTEM_PROMPT = `You are a personal-finance assistant. You are given a user's question about their GnuCash books, the SQL that was run, and the resulting rows. Write a concise, direct answer.

Rules:
- 1-3 sentences. Lead with the number(s) the user asked for.
- Format currency like $1,234.56 (thousands separators, 2 decimals). Remember
  GnuCash sign conventions: income sums come back negative — present them as
  positive income. Expense sums are positive.
- If the result set is empty, say so plainly and suggest a likely reason.
- Never invent numbers that are not derivable from the rows. Only quote amounts
  and percentages that appear in the rows; do not add or subtract them yourself.

Respond with ONLY a JSON object (no markdown fences):
{
  "answer": "<the answer text>",
  "ledger_search": "<a short search term for the transaction journal that would let the user see the underlying transactions, or null if not useful>",
  "accounts": [{"guid": "<32-char hex account guid taken from the rows>", "name": "<account name>"}]
}
"accounts": up to 3 accounts central to the answer — ONLY guids that literally appear in the result rows; otherwise [].`;

/** Fallback answer when the answer-composition call fails or quotes an unsupported figure. */
export function fallbackAnswer(rows: QueryRow[]): ComposedAnswer {
    const n = rows.length;
    return {
        answer: n === 0
            ? 'The query ran successfully but returned no rows.'
            : `The query returned ${n} row${n === 1 ? '' : 's'} — see the result table below.`,
        links: [],
    };
}

export async function composeAnswer(params: {
    question: string;
    /** The SQL as the model wrote it (tokenised in summary mode). */
    sql: string;
    plan: string;
    rows: QueryRow[];
    /** The gated session the generation step used. */
    ai: GatedAi;
    /** Book scope — account links are only emitted for guids inside it. */
    accountGuids: string[];
}): Promise<ComposedAnswer> {
    const { question, sql, plan, rows, ai, accountGuids } = params;

    // Exactly what the model sees; the known numbers for the check come from here.
    const modelRows = ai.scrubRows(rows.slice(0, MAX_ROWS_TO_MODEL));
    const maskedQuestion = ai.mask(question);
    const payload = {
        question: maskedQuestion,
        plan,
        sql,
        row_count: rows.length,
        rows: modelRows,
        rows_truncated: rows.length > MAX_ROWS_TO_MODEL,
    };
    const system = ai.level === 'summary' ? `${ANSWER_SYSTEM_PROMPT}\n\n${SUMMARY_PROMPT_NOTE}` : ANSWER_SYSTEM_PROMPT;
    const messages: AiChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
    ];

    let parsed: Record<string, unknown>;
    try {
        const content = await ai.chat(messages, { maxTokens: 800, timeoutMs: 60000 });
        parsed = extractJsonObject(content);
    } catch {
        return fallbackAnswer(rows);
    }

    let answer = typeof parsed.answer === 'string' && parsed.answer.trim()
        ? parsed.answer.trim()
        : fallbackAnswer(rows).answer;

    if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
        const bad = unsupportedFigures(answer, collectKnownNumbers(modelRows, rows.length, maskedQuestion));
        if (bad.length > 0) {
            warnUnsupported('ask-answer', bad);
            answer = fallbackAnswer(rows).answer;
        } else {
            answer = ai.unmask(answer);
        }
    }

    const links: DrillDownLink[] = [];

    // Account drill-downs: validate shape, guid format, and book membership
    // so a confabulated guid can never become a link.
    const inBook = new Set(accountGuids.map(g => g.toLowerCase()));
    const seen = new Set<string>();
    if (Array.isArray(parsed.accounts)) {
        for (const item of parsed.accounts) {
            if (links.length >= 3) break;
            if (!item || typeof item !== 'object') continue;
            const acct = item as Record<string, unknown>;
            const guid = typeof acct.guid === 'string' ? acct.guid.toLowerCase() : '';
            if (!GUID_RE.test(guid) || !inBook.has(guid) || seen.has(guid)) continue;
            seen.add(guid);
            const name = typeof acct.name === 'string' && acct.name.trim() ? ai.unmask(acct.name.trim()) : 'Account';
            links.push({ label: name, href: `/accounts/${guid}` });
        }
    }

    if (typeof parsed.ledger_search === 'string' && parsed.ledger_search.trim()) {
        const term = ai.unmask(parsed.ledger_search.trim()).slice(0, 100);
        links.push({
            label: `Search ledger: "${term}"`,
            href: `/ledger?search=${encodeURIComponent(term)}`,
        });
    }

    return { answer, links };
}
