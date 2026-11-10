// src/lib/ai-query/generate.ts

/**
 * SQL generation: turns a natural-language question about the user's books
 * into a single guard-railed SELECT statement plus a short answer plan.
 */

import type { GatedAi } from '@/lib/ai-privacy/session';
import { SUMMARY_PROMPT_NOTE } from '@/lib/ai-privacy/privacy';
import { extractJsonObject, type AiChatMessage } from './client';
import { SCHEMA_CONTEXT } from './schema-context';
import { MAX_LIMIT } from './guardrails';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface GeneratedQuery {
    /**
     * The generated SELECT statement as the model wrote it. In summary mode it
     * may hold name tokens: run it through ai.unmaskSql() before
     * validateGeneratedSql, and never execute it as-is.
     */
    sql: string;
    /** Short natural-language plan describing how the query answers the question. */
    plan: string;
}

const SYSTEM_PROMPT = `You are a SQL analyst for a personal-finance app backed by a GnuCash PostgreSQL database. Given a user question, write ONE PostgreSQL SELECT statement that answers it.

${SCHEMA_CONTEXT}

STRICT OUTPUT RULES:
- PostgreSQL dialect only.
- Produce exactly ONE statement: a single SELECT, optionally preceded by WITH
  (read-only CTEs only). No INSERT/UPDATE/DELETE/DDL of any kind, no
  data-modifying CTEs, no semicolons, no comments.
- ALWAYS aggregate money as value_num::numeric / value_denom (fractions).
- Read ONLY the book_ relations listed above. They are already restricted to the
  user's active book, so add no scope filter of your own and use no query
  parameters. Naming a base table (accounts, splits, transactions,
  account_hierarchy) is rejected.
- Use explicit JOIN ... ON syntax; comma joins and quoted identifiers are rejected.
- ALWAYS end the outer query with LIMIT ${MAX_LIMIT} or less.
- Round money to 2 decimals with ROUND(..., 2) and use clear column aliases.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{"sql": "<the SELECT statement>", "plan": "<one or two sentences describing what the query computes and how you will phrase the answer>"}`;

/** Extra rules for summary mode: names in the question are tokens. */
const SUMMARY_SQL_NOTE = `${SUMMARY_PROMPT_NOTE}
- When the question names a token, match it in SQL as a string literal, for
  example book_account_hierarchy.fullname ILIKE '%⟨A1⟩%' or
  book_transactions.description ILIKE '%⟨M1⟩%'. Folio replaces the token with the
  real name before the query runs. Never put a token outside a string literal.`;

/**
 * Ask the configured provider for a SQL statement + answer plan, through the
 * privacy gate's session. In summary mode the question is masked and earlier
 * answers are scrubbed (names to tokens, amounts rounded) before sending.
 *
 * @param feedback when a previous attempt failed guardrail validation, pass it
 *   back so the model can correct itself. `rejectedSql` is the model's own
 *   (still tokenised) SQL.
 */
export async function generateQuery(
    question: string,
    history: ChatTurn[],
    ai: GatedAi,
    feedback?: { rejectedSql: string; reason: string },
): Promise<GeneratedQuery> {
    const system = ai.level === 'summary' ? `${SYSTEM_PROMPT}\n\n${SUMMARY_SQL_NOTE}` : SYSTEM_PROMPT;
    const messages: AiChatMessage[] = [{ role: 'system', content: system }];

    // Prior conversation gives the model context for follow-up questions
    // ("what about Q2?"). Keep it short — the answers, not the row dumps.
    // Earlier answers were unmasked for the user, so they are scrubbed again.
    for (const turn of history.slice(-8)) {
        const content = turn.content.slice(0, 1000);
        messages.push({ role: turn.role, content: turn.role === 'assistant' ? ai.scrubText(content) : ai.mask(content) });
    }

    messages.push({ role: 'user', content: ai.mask(question) });

    if (feedback) {
        messages.push({ role: 'assistant', content: JSON.stringify({ sql: feedback.rejectedSql }) });
        messages.push({
            role: 'user',
            content: `That SQL was rejected by the safety validator: ${ai.mask(feedback.reason)}. Produce a corrected statement that follows every rule, as the same JSON format.`,
        });
    }

    const content = await ai.chat(messages, { maxTokens: 1200, timeoutMs: 60000 });
    const parsed = extractJsonObject(content);

    const sql = typeof parsed.sql === 'string' ? parsed.sql.trim() : '';
    if (!sql) throw new Error('AI did not return a SQL statement');

    return {
        sql,
        plan: typeof parsed.plan === 'string' ? parsed.plan.trim() : '',
    };
}
