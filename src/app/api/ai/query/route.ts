/**
 * "Ask your books" — natural-language query endpoint.
 *
 * GET  -> { configured, off, privacy }  (whether questions can be asked, and at which privacy level)
 * POST -> { question, history? } -> { answer, sql, rows, links, privacy, error? }
 *
 * Pipeline: generate SQL (AI) → unmask name tokens → validate (guardrails) →
 * execute (READ ONLY transaction, book-scoped via $1) → compose answer (AI).
 * This route never writes to the GnuCash tables; the guardrails reject anything
 * that is not a single SELECT, and execution runs inside SET TRANSACTION READ
 * ONLY.
 *
 * Both AI calls go through the privacy gate (src/lib/ai-privacy/gate.ts). Off:
 * no model call. Summary: the model sees tokens for names and rounded rows; any
 * token in its SQL is swapped for the quoted real name BEFORE the guardrails
 * run, so validation always sees the statement that will execute.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { aiAvailability, openGatedAi } from '@/lib/ai-privacy/gate';
import { getAccountGuidsForBook, getBookAccountGuids } from '@/lib/book-scope';
import { getAuthorizedFamilyGraph } from '@/lib/family-office/service';
import { generateQuery, type ChatTurn } from '@/lib/ai-query/generate';
import { validateGeneratedSql } from '@/lib/ai-query/guardrails';
import { executeReadOnlyQuery, type QueryRow } from '@/lib/ai-query/execute';
import { composeAnswer } from '@/lib/ai-query/answer';

const NOT_CONFIGURED_MESSAGE =
    'AI is not configured. Set up a provider under Settings → AI first.';
const OFF_MESSAGE =
    'AI analysis is off. Choose a privacy mode other than Off under Settings → AI to ask questions.';

export async function GET() {
    try {
        const roleResult = await requireRole('readonly');
        if (roleResult instanceof NextResponse) return roleResult;
        const { user } = roleResult;

        const { configured, level } = await aiAvailability(user.id);
        return NextResponse.json({ configured: configured && level !== 'off', off: configured && level === 'off', privacy: level });
    } catch (error) {
        console.error('AI query config check error:', error);
        return NextResponse.json({ configured: false, off: false, privacy: 'off' });
    }
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
    if (!Array.isArray(raw)) return [];
    const turns: ChatTurn[] = [];
    for (const item of raw.slice(-12)) {
        if (!item || typeof item !== 'object') continue;
        const t = item as Record<string, unknown>;
        if ((t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim()) {
            turns.push({ role: t.role, content: t.content.slice(0, 1000) });
        }
    }
    return turns;
}

export async function POST(request: NextRequest) {
    try {
        const roleResult = await requireRole('readonly');
        if (roleResult instanceof NextResponse) return roleResult;
        const { user } = roleResult;

        const body = await request.json().catch(() => null);
        const question = typeof body?.question === 'string' ? body.question.trim() : '';
        if (!question) {
            return NextResponse.json({ error: 'question is required' }, { status: 400 });
        }
        if (question.length > 1000) {
            return NextResponse.json({ error: 'question is too long (max 1000 characters)' }, { status: 400 });
        }
        const history = sanitizeHistory(body?.history);

        const familyScope = body?.scope === 'family';
        const accountGuids = familyScope
            ? (await Promise.all(
                (await getAuthorizedFamilyGraph(user.id, roleResult.bookGuid)).entities
                    .map(entity => getAccountGuidsForBook(entity.bookGuid)),
            )).flat()
            : await getBookAccountGuids();
        if (accountGuids.length === 0) {
            return NextResponse.json({ error: 'The active book has no accounts to query.' }, { status: 400 });
        }

        const gate = await openGatedAi({ userId: user.id, path: 'ask', accountGuids });
        if (!gate.ok) {
            return NextResponse.json(
                { error: gate.reason === 'off' ? OFF_MESSAGE : NOT_CONFIGURED_MESSAGE },
                { status: 400 },
            );
        }
        const { ai } = gate;

        // Generate SQL; give the model one shot at fixing a guardrail rejection.
        // Tokens become quoted real names BEFORE validation, never after.
        let generated = await generateQuery(question, history, ai);
        let check = validateGeneratedSql(ai.unmaskSql(generated.sql));
        if (!check.ok) {
            generated = await generateQuery(question, history, ai, {
                rejectedSql: generated.sql,
                reason: check.reason!,
            });
            check = validateGeneratedSql(ai.unmaskSql(generated.sql));
        }
        if (!check.ok || !check.sql) {
            return NextResponse.json(
                { error: `Could not generate a safe query: ${check.reason}`, sql: ai.unmaskSql(generated.sql) },
                { status: 422 },
            );
        }
        const sql = check.sql;

        let rows: QueryRow[];
        try {
            rows = await executeReadOnlyQuery(sql, accountGuids);
        } catch (err) {
            console.error('AI query execution failed:', err);
            const detail = err instanceof Error && /statement timeout/i.test(err.message)
                ? 'The query timed out (5s limit). Try a narrower question.'
                : 'The generated query failed to execute. Try rephrasing the question.';
            return NextResponse.json({ error: detail, sql }, { status: 422 });
        }

        const { answer, links } = await composeAnswer({
            question,
            sql: ai.level === 'summary' ? generated.sql : sql,
            plan: generated.plan,
            rows,
            ai,
            accountGuids,
        });

        return NextResponse.json({ answer, sql, rows, links, scope: familyScope ? 'family' : 'book', privacy: ai.level });
    } catch (error) {
        console.error('AI query error:', error);
        const message = error instanceof Error && error.name === 'TimeoutError'
            ? 'AI request timed out'
            : error instanceof Error && error.message.startsWith('AI API error')
                ? error.message
                : 'Failed to answer the question';
        const status = message.startsWith('AI') ? 502 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
