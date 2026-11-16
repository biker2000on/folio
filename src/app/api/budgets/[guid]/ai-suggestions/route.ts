import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { aiAvailability } from '@/lib/ai-privacy/gate';
import { suggestBudgetChangesWithAi } from '@/lib/ai-suggest/budget-suggest';

const OFF_MESSAGE = 'AI analysis is off. Choose another privacy mode under Settings → AI.';
const UNCONFIGURED_MESSAGE = 'AI is not set up. Add a provider under Settings → AI.';

/**
 * @openapi
 * /api/budgets/{guid}/ai-suggestions:
 *   get:
 *     tags: [Budgets]
 *     summary: Whether AI budget suggestions are available, and at which privacy level.
 *     parameters:
 *       - in: path
 *         name: guid
 *         required: true
 *         schema: { type: string }
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
        console.error('AI budget suggestion availability failed:', error);
        return NextResponse.json({ configured: false, level: 'off' });
    }
}

/**
 * @openapi
 * /api/budgets/{guid}/ai-suggestions:
 *   post:
 *     tags: [Budgets]
 *     summary: Ask the AI for budget changes. Saves nothing.
 *     description: >
 *       Sends the budget's lines with the last three complete months of actuals
 *       (rolled up per subtree) and the other expense and income accounts,
 *       through the AI privacy gate (tokens and rounded amounts in summary
 *       mode). Each change is validated: a budgetable account in the book, an
 *       amount from 0 to 100,000,000 rounded to whole units or null to remove a
 *       line, not a no-op, and no parent/child conflict with another line
 *       unless the same set removes it (listed in `requires`). Apply the ones
 *       you want with POST /api/budgets/{guid}/amounts/all-periods (amount =
 *       rawTo) or DELETE /api/budgets/{guid}/amounts.
 *     parameters:
 *       - in: path
 *         name: guid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ level, proposals: [{ accountGuid, accountPath, accountType, from, fromVaries, to, rawTo, why, requires }], dropped, reasons, whyDropped, months }"
 *       400:
 *         description: AI is off or not set up.
 *       404:
 *         description: Budget not found in the active book.
 *       502:
 *         description: The model's reply could not be read.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ guid: string }> },
) {
    try {
        const roleResult = await requireRole('edit');
        if (roleResult instanceof NextResponse) return roleResult;
        const { guid } = await params;

        const result = await suggestBudgetChangesWithAi({
            userId: roleResult.user.id,
            bookGuid: roleResult.bookGuid,
            budgetGuid: guid,
        });
        if (!result.ok) {
            if (result.reason === 'not-found') return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
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
        console.error('AI budget suggestions failed:', error);
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        const invalid = error instanceof Error && error.message.startsWith('Invalid budget GUID');
        if (invalid) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
        return NextResponse.json(
            { error: timedOut ? 'The AI took too long to answer. Try again.' : 'Could not get AI suggestions.' },
            { status: timedOut ? 504 : 500 },
        );
    }
}
