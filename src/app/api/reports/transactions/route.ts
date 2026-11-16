import { NextRequest, NextResponse } from 'next/server';
import { fetchPeriodTransactions } from '@/lib/reports/income-statement-by-period-transactions';
import { getBookAccountGuids } from '@/lib/book-scope';
import { requireRole } from '@/lib/auth';

/**
 * Generic report drill-down: transactions for any account (and its
 * descendants) over a date range, book-scoped. Powers the account links in
 * report drill-down tables (net-worth attribution, breakdowns, etc.).
 *
 * GET /api/reports/transactions?accountGuid=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD[&opening=1]
 *
 * `opening=1` adds `openingBalance` (the tree's balance before startDate), for
 * drilling into a point-in-time balance rather than a period's activity.
 * `descendants=0` limits it to the account itself, without sub-accounts.
 */
export async function GET(request: NextRequest) {
    try {
        const roleResult = await requireRole('readonly');
        if (roleResult instanceof NextResponse) return roleResult;

        const { searchParams } = new URL(request.url);
        const accountGuid = searchParams.get('accountGuid');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        if (!accountGuid || !startDate || !endDate) {
            return NextResponse.json(
                { error: 'accountGuid, startDate, and endDate are required' },
                { status: 400 },
            );
        }

        const bookAccountGuids = await getBookAccountGuids();

        // No account-type restriction: any account (asset, liability, holding,
        // income, expense, equity) can be drilled into.
        const result = await fetchPeriodTransactions({
            accountGuid,
            startDate,
            endDate,
            bookAccountGuids,
            includeOpening: searchParams.get('opening') === '1',
            accountOnly: searchParams.get('descendants') === '0',
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error fetching report drill-down transactions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch transactions' },
            { status: 500 },
        );
    }
}
