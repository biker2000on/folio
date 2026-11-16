import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { getAccountGuidsForBook } from '@/lib/book-scope';
import { getBaseCurrencyForBook } from '@/lib/currency';
import { MONEY_DISPLAY_EPSILON } from '@/lib/tolerances';
import { verifiedThroughDate } from '@/lib/financial-actions/store';
import type { DashboardStatus, DashboardStatusAccount } from '@/lib/dashboard-status';

async function safe<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await work();
    } catch (error) {
        console.warn(`Dashboard status: ${label} unavailable:`, error);
        return fallback;
    }
}

/**
 * The small facts the dashboard shows around its charts: data freshness, cash
 * and credit balances, and the latest ledger activity. One request, each part
 * independent, so a failure in one leaves the others standing.
 */
export async function GET() {
    try {
        const roleResult = await requireRole('readonly');
        if (roleResult instanceof NextResponse) return roleResult;
        const { bookGuid } = roleResult;
        const guids = await getAccountGuidsForBook(bookGuid);
        const baseCurrency = await safe('base currency', () => getBaseCurrencyForBook(bookGuid), null);

        const [priceRows, syncRows, reconciledThrough, balanceRows, recentRows, unreviewedRows] = await Promise.all([
            safe('latest price', () => prisma.$queryRaw<Array<{ latest: Date | null }>>`
                SELECT MAX(p.date) AS latest
                FROM prices p
                WHERE p.commodity_guid IN (
                    SELECT DISTINCT a.commodity_guid FROM accounts a
                    WHERE a.guid = ANY(${guids}::text[]) AND a.account_type IN ('STOCK', 'MUTUAL')
                )
            `, []),
            safe('bank sync', () => prisma.$queryRaw<Array<{ latest: Date | null }>>`
                SELECT MAX(last_successful_sync_at) AS latest
                FROM gnucash_web_simplefin_connections
                WHERE book_guid = ${bookGuid}
            `, []),
            safe('reconciliation coverage', () => verifiedThroughDate(guids), null),
            safe('balances', () => prisma.$queryRaw<Array<{
                guid: string;
                name: string;
                account_type: string;
                commodity_guid: string | null;
                balance: number;
            }>>`
                SELECT a.guid, a.name, a.account_type, a.commodity_guid,
                       COALESCE(SUM(s.quantity_num::numeric / NULLIF(s.quantity_denom, 0)::numeric), 0)::float8 AS balance
                FROM accounts a
                LEFT JOIN splits s ON s.account_guid = a.guid
                LEFT JOIN transactions t ON t.guid = s.tx_guid AND t.post_date <= NOW()
                WHERE a.guid = ANY(${guids}::text[])
                  AND a.account_type IN ('BANK', 'CASH', 'CREDIT')
                  AND COALESCE(a.hidden, 0) = 0
                  AND COALESCE(a.placeholder, 0) = 0
                  AND (s.guid IS NULL OR t.guid IS NOT NULL)
                GROUP BY a.guid, a.name, a.account_type, a.commodity_guid
            `, []),
            safe('recent transactions', () => prisma.$queryRaw<Array<{
                guid: string;
                post_date: Date;
                description: string | null;
                amount: number | null;
                account: string | null;
                source: string | null;
                reviewed: boolean | null;
            }>>`
                SELECT t.guid, t.post_date, t.description,
                       (SELECT MAX(ABS(s.value_num::numeric / NULLIF(s.value_denom, 0)::numeric))::float8
                          FROM splits s WHERE s.tx_guid = t.guid) AS amount,
                       (SELECT a.name FROM splits s JOIN accounts a ON a.guid = s.account_guid
                         WHERE s.tx_guid = t.guid
                         ORDER BY (a.account_type IN ('EXPENSE', 'INCOME')) DESC, a.name
                         LIMIT 1) AS account,
                       m.source, m.reviewed
                FROM transactions t
                LEFT JOIN gnucash_web_transaction_meta m
                  ON m.transaction_guid = t.guid AND m.deleted_at IS NULL
                WHERE t.post_date <= NOW()
                  AND EXISTS (
                      SELECT 1 FROM splits s
                      WHERE s.tx_guid = t.guid AND s.account_guid = ANY(${guids}::text[])
                  )
                ORDER BY t.post_date DESC, t.enter_date DESC
                LIMIT 8
            `, []),
            safe('unreviewed count', () => prisma.$queryRaw<Array<{ count: number }>>`
                SELECT COUNT(DISTINCT m.transaction_guid)::int AS count
                FROM gnucash_web_transaction_meta m
                JOIN splits s ON s.tx_guid = m.transaction_guid
                WHERE m.reviewed = FALSE
                  AND m.source <> 'manual'
                  AND m.deleted_at IS NULL
                  AND s.account_guid = ANY(${guids}::text[])
            `, []),
        ]);

        const inBase = balanceRows.filter(row => !baseCurrency || row.commodity_guid === baseCurrency.guid);
        const toAccount = (row: typeof balanceRows[number]): DashboardStatusAccount => ({
            guid: row.guid,
            name: row.name,
            balance: Math.round(Number(row.balance) * 100) / 100,
        });
        // An account with nothing in it is not worth a row.
        const nonZero = (account: DashboardStatusAccount) => Math.abs(account.balance) >= MONEY_DISPLAY_EPSILON;
        const cash = inBase.filter(row => row.account_type !== 'CREDIT').map(toAccount).filter(nonZero)
            .sort((a, b) => b.balance - a.balance);
        const credit = inBase.filter(row => row.account_type === 'CREDIT').map(toAccount).filter(nonZero)
            .sort((a, b) => a.balance - b.balance);
        const sum = (list: DashboardStatusAccount[]) =>
            Math.round(list.reduce((total, account) => total + account.balance, 0) * 100) / 100;

        const status: DashboardStatus = {
            freshness: {
                latestPriceDate: priceRows[0]?.latest ? priceRows[0].latest.toISOString().slice(0, 10) : null,
                lastBankSyncAt: syncRows[0]?.latest ? syncRows[0].latest.toISOString() : null,
                reconciledThrough,
            },
            accounts: {
                cash,
                cashTotal: sum(cash),
                credit,
                creditOwed: Math.max(0, -sum(credit)),
                otherCurrencyCount: balanceRows.length - inBase.length,
            },
            recent: {
                transactions: recentRows.map(row => ({
                    guid: row.guid,
                    date: row.post_date.toISOString().slice(0, 10),
                    description: row.description?.trim() || 'No description',
                    amount: Math.round(Number(row.amount ?? 0) * 100) / 100,
                    account: row.account,
                    imported: typeof row.source === 'string' && row.source !== 'manual',
                    reviewed: row.reviewed !== false,
                })),
                unreviewedCount: unreviewedRows[0]?.count ?? 0,
            },
        };
        return NextResponse.json(status);
    } catch (error) {
        console.error('Error loading dashboard status:', error);
        return NextResponse.json({ error: 'Failed to load dashboard status' }, { status: 500 });
    }
}
