import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { aiAvailability } from '@/lib/ai-privacy/gate';
import { suggestRulesWithAi } from '@/lib/ai-suggest/rule-suggest';

const OFF_MESSAGE = 'AI analysis is off. Choose another privacy mode under Settings → AI.';
const UNCONFIGURED_MESSAGE = 'AI is not set up. Add a provider under Settings → AI.';

/**
 * @openapi
 * /api/categorization/ai-suggestions:
 *   get:
 *     tags: [Categorization]
 *     summary: Whether AI rule suggestions are available, and at which privacy level.
 *     responses:
 *       200:
 *         description: "{ configured: boolean, level: 'off' | 'summary' | 'full' }"
 */
export async function GET() {
    try {
        const roleResult = await requireRole('readonly');
        if (roleResult instanceof NextResponse) return roleResult;
        return NextResponse.json(await aiAvailability(roleResult.user.id));
    } catch (error) {
        console.error('AI rule suggestion availability failed:', error);
        return NextResponse.json({ configured: false, level: 'off' });
    }
}

/**
 * @openapi
 * /api/categorization/ai-suggestions:
 *   post:
 *     tags: [Categorization]
 *     summary: Ask the AI for categorization rules. Saves nothing.
 *     description: >
 *       Sends descriptions the learned suggestions do not cover, and the book's
 *       leaf expense and income accounts, through the AI privacy gate (tokens
 *       instead of names in summary mode). Every proposal is validated against
 *       the book: a valid pattern of 2+ characters, an EXPENSE or INCOME
 *       non-placeholder target, no duplicate of an existing rule, and a dry run
 *       that matches at least one past transaction and no more than 20% of
 *       them. At most 20 proposals; the rest are counted in `dropped`. Create
 *       the ones you want with POST /api/categorization/rules.
 *     responses:
 *       200:
 *         description: "{ level, proposals: [{ match, matchType, accountGuid, accountPath, why, matchCount, uncategorizedCount, share, samples }], dropped, reasons, whyDropped, considered }"
 *       400:
 *         description: AI is off or not set up.
 *       502:
 *         description: The model's reply could not be read.
 */
export async function POST() {
    try {
        const roleResult = await requireRole('edit');
        if (roleResult instanceof NextResponse) return roleResult;

        const result = await suggestRulesWithAi({ userId: roleResult.user.id, bookGuid: roleResult.bookGuid });
        if (!result.ok) {
            if (result.reason === 'bad-reply') {
                return NextResponse.json({ error: 'The AI reply could not be read. Try again.' }, { status: 502 });
            }
            return NextResponse.json(
                { error: result.reason === 'off' ? OFF_MESSAGE : UNCONFIGURED_MESSAGE, reason: result.reason },
                { status: 400 },
            );
        }
        const { ok: _ok, ...body } = result;
        return NextResponse.json(body);
    } catch (error) {
        console.error('AI rule suggestions failed:', error);
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return NextResponse.json(
            { error: timedOut ? 'The AI took too long to answer. Try again.' : 'Could not get AI suggestions.' },
            { status: timedOut ? 504 : 500 },
        );
    }
}
