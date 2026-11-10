/**
 * Read-only MCP tools over one book.
 *
 * Every tool receives the token's book in `ctx` and scopes EXPLICITLY to it
 * (`getAccountGuidsForBook(ctx.bookGuid)`, `getBaseCurrencyForBook`, ...).
 * Nothing here may read the session's active book: an MCP request has no
 * session, and the route rejects requests that carry one.
 *
 * Results are plain JSON-able objects. They are NOT written to the wire here —
 * `server.ts` passes each one through `shapeToolResult` (src/lib/mcp/shape.ts)
 * first, which is where the AI privacy gate plugs in.
 *
 * Sign conventions (repeated in the tool descriptions the model reads):
 * GnuCash stores debits positive and credits negative, so income, liabilities
 * and equity are negative in the ledger. Summary tools present them in their
 * natural sign (income earned, debt owed as positive numbers); the
 * transaction-level tool keeps raw debit/credit signs and says so.
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { toDecimalNumber } from '@/lib/gnucash';
import { round2 } from '@/lib/format';
import { getAccountGuidsForBook } from '@/lib/book-scope';
import { buildBookRelativeAccountPaths } from '@/lib/account-path';
import { buildAccountValuationContext, UNVALUED_QUANTITY_EPSILON } from '@/lib/account-valuation';
import { MONEY_DISPLAY_EPSILON } from '@/lib/tolerances';
import { getBaseCurrencyForBook, findExchangeRate, type Currency } from '@/lib/currency';
import { sumSplitsByAccount, sumSplitsByAccountAndMonth } from '@/lib/reports/utils';
import { buildMonthlySeries } from '@/lib/dashboard/income-expense-series';
import { FinancialSummaryService } from '@/lib/services/financial-summary.service';
import { BudgetService } from '@/lib/services/budget.service';
import { loadBudgetActuals } from '@/lib/budget-actuals';
import { pickCurrentBudget, type BudgetLike } from '@/lib/budget-select';
import { detectRecurringCharges } from '@/lib/recurring-detection';
import { generateInvestmentPortfolio } from '@/lib/reports/investment-portfolio';
import { fetchScheduledTransactions } from '@/lib/scheduled-transactions';
import { computeNextOccurrencesForPatterns, type RecurrencePattern } from '@/lib/recurrence';
import { listFinancialActions } from '@/lib/financial-actions/store';
import type { Role } from '@/lib/services/permission.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolContext {
    bookGuid: string;
    userId: number;
    role: Role;
}

export interface McpTool<S extends z.ZodType = z.ZodType> {
    name: string;
    title: string;
    description: string;
    inputSchema: S;
    run(args: z.infer<S>, ctx: McpToolContext): Promise<unknown>;
}

/**
 * A failure the caller can act on (bad account name, no budget, ...). The
 * server reports its message as a tool error; any other thrown error becomes
 * a generic "tool failed" with no detail.
 */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'McpToolError';
    }
}

function defineTool<S extends z.ZodType>(tool: McpTool<S>): McpTool<S> {
    return tool;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Account types whose natural balance is a credit (stored negative). */
const CREDIT_NORMAL_TYPES = new Set(['INCOME', 'LIABILITY', 'CREDIT', 'PAYABLE', 'EQUITY']);

const ACCOUNT_TYPES = [
    'ASSET', 'BANK', 'CASH', 'RECEIVABLE', 'STOCK', 'MUTUAL',
    'LIABILITY', 'CREDIT', 'PAYABLE', 'INCOME', 'EXPENSE', 'EQUITY', 'TRADING',
] as const;

const SIGN_NOTE =
    'Amounts are in natural sign: income earned and debt owed are positive numbers ' +
    '(GnuCash stores them as negative credits; this tool has already flipped them).';

/** Flip credit-normal balances so income/liabilities/equity read positive. */
function naturalSign(accountType: string, raw: number): number {
    return CREDIT_NORMAL_TYPES.has(accountType) ? -raw : raw;
}

/** Round to cents without ever emitting -0. */
function money(value: number): number {
    const r = round2(value);
    return r === 0 ? 0 : r;
}

function round4(value: number): number {
    const r = Math.round(value * 10000) / 10000;
    return r === 0 ? 0 : r;
}

const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a real date');

function startOfDay(date: string): Date {
    return new Date(`${date}T00:00:00Z`);
}

function endOfDay(date: string): Date {
    return new Date(`${date}T23:59:59Z`);
}

function ymd(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

/** First instant of the month `monthsBack` months before the current one (UTC). */
function monthStartUtc(monthsBack: number, now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

function monthKeysBetween(start: Date, end: Date): string[] {
    const keys: string[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
        keys.push(cursor.toISOString().slice(0, 7));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return keys;
}

interface BookAccount {
    guid: string;
    name: string;
    type: string;
    parentGuid: string | null;
    hidden: boolean;
    placeholder: boolean;
    commodityGuid: string | null;
    commodity: string | null;
    commodityNamespace: string | null;
    /** Book-relative path, e.g. `Expenses:Food:Groceries` (root name excluded). */
    path: string;
}

interface BookAccounts {
    rootGuid: string;
    accounts: BookAccount[];
    byGuid: Map<string, BookAccount>;
    childrenOf: Map<string, string[]>;
}

/** Every account of the token's book (root excluded), with paths. */
async function loadBookAccounts(bookGuid: string): Promise<BookAccounts> {
    const [book, guids] = await Promise.all([
        prisma.books.findUnique({ where: { guid: bookGuid }, select: { root_account_guid: true } }),
        getAccountGuidsForBook(bookGuid),
    ]);
    if (!book) throw new McpToolError('The book this token belongs to no longer exists.');

    const rows = guids.length === 0 ? [] : await prisma.accounts.findMany({
        where: { guid: { in: guids } },
        select: {
            guid: true,
            name: true,
            account_type: true,
            parent_guid: true,
            hidden: true,
            placeholder: true,
            commodity_guid: true,
            commodity: { select: { mnemonic: true, namespace: true } },
        },
    });
    const paths = buildBookRelativeAccountPaths(rows, book.root_account_guid);

    const accounts: BookAccount[] = rows
        .filter((row) => row.guid !== book.root_account_guid && row.account_type !== 'ROOT')
        .map((row) => ({
            guid: row.guid,
            name: row.name,
            type: row.account_type,
            parentGuid: row.parent_guid,
            hidden: row.hidden === 1,
            placeholder: row.placeholder === 1,
            commodityGuid: row.commodity_guid,
            commodity: row.commodity?.mnemonic ?? null,
            commodityNamespace: row.commodity?.namespace ?? null,
            path: paths.get(row.guid) || row.name,
        }));

    const byGuid = new Map(accounts.map((a) => [a.guid, a]));
    const childrenOf = new Map<string, string[]>();
    for (const account of accounts) {
        if (!account.parentGuid) continue;
        const list = childrenOf.get(account.parentGuid) ?? [];
        list.push(account.guid);
        childrenOf.set(account.parentGuid, list);
    }
    return { rootGuid: book.root_account_guid, accounts, byGuid, childrenOf };
}

function descendantsOf(book: BookAccounts, guid: string): string[] {
    const out: string[] = [];
    const stack = [...(book.childrenOf.get(guid) ?? [])];
    while (stack.length > 0) {
        const next = stack.pop()!;
        out.push(next);
        stack.push(...(book.childrenOf.get(next) ?? []));
    }
    return out;
}

/**
 * Resolve an account reference — a 32-hex guid, a full path
 * (`Expenses:Food:Groceries`), a bare name, or a path fragment — to the
 * accounts of this book it names. Throws a McpToolError the model can act on
 * when nothing (or too much) matches.
 */
function resolveAccountRef(book: BookAccounts, ref: string): BookAccount[] {
    const trimmed = ref.trim();
    if (/^[0-9a-f]{32}$/i.test(trimmed)) {
        const account = book.byGuid.get(trimmed.toLowerCase());
        if (!account) throw new McpToolError(`No account with guid ${trimmed} in this book.`);
        return [account];
    }
    const needle = trimmed.toLowerCase();
    const byPath = book.accounts.filter((a) => a.path.toLowerCase() === needle);
    if (byPath.length > 0) return byPath;
    const byName = book.accounts.filter((a) => a.name.toLowerCase() === needle);
    if (byName.length > 0) return byName;
    const fragment = book.accounts.filter((a) => a.path.toLowerCase().includes(needle));
    if (fragment.length === 0) {
        throw new McpToolError(`No account matches "${trimmed}". Call list_accounts to see account paths.`);
    }
    return fragment;
}

function requireSingleAccount(book: BookAccounts, ref: string): BookAccount {
    const matches = resolveAccountRef(book, ref);
    if (matches.length === 1) return matches[0];
    const candidates = matches.slice(0, 10).map((a) => a.path).join('; ');
    throw new McpToolError(
        `"${ref}" matches ${matches.length} accounts (${candidates}${matches.length > 10 ? '; ...' : ''}). ` +
        'Pass a full account path or guid.',
    );
}

async function requireBaseCurrency(bookGuid: string): Promise<Currency> {
    const base = await getBaseCurrencyForBook(bookGuid);
    if (!base) throw new McpToolError('This book has no report currency (its root account is not currency-denominated).');
    return base;
}

/** Per-account multiplier into the report currency for currency-denominated accounts. */
async function ratesIntoBase(
    accounts: BookAccount[],
    base: Currency,
    asOf: Date,
): Promise<Map<string, number>> {
    const rateByCommodity = new Map<string, number>();
    const result = new Map<string, number>();
    for (const account of accounts) {
        if (!account.commodityGuid || account.commodityGuid === base.guid) continue;
        if (!rateByCommodity.has(account.commodityGuid)) {
            const rate = await findExchangeRate(account.commodityGuid, base.guid, asOf);
            // Same fallback as the dashboard: no rate path → treat as 1.
            rateByCommodity.set(account.commodityGuid, rate?.rate ?? 1);
        }
        result.set(account.guid, rateByCommodity.get(account.commodityGuid)!);
    }
    return result;
}

// ---------------------------------------------------------------------------
// list_accounts
// ---------------------------------------------------------------------------

const MAX_ACCOUNTS = 500;

const listAccounts = defineTool({
    name: 'list_accounts',
    title: 'List accounts',
    description:
        'The chart of accounts of the book with balances. Each row has the account path ' +
        '(e.g. "Assets:Current Assets:Checking"), type, commodity, its own balance in its commodity ' +
        '(shares for STOCK/MUTUAL accounts), and totalValue: the balance INCLUDING all sub-accounts ' +
        'converted to the book report currency. ' + SIGN_NOTE + ' Hidden accounts and accounts with ' +
        'a zero balance are omitted unless requested. Use the path or guid with the other tools.',
    inputSchema: z.object({
        types: z.array(z.enum(ACCOUNT_TYPES)).optional()
            .describe('Only these GnuCash account types (e.g. ["BANK","CREDIT"]).'),
        includeHidden: z.boolean().default(false).describe('Include accounts marked hidden.'),
        includeZero: z.boolean().default(false).describe('Include accounts whose balance is zero.'),
        asOf: isoDate.optional().describe('Balances as of this date (YYYY-MM-DD). Default: today.'),
        limit: z.number().int().min(1).max(MAX_ACCOUNTS).default(300).describe(`Max rows (≤ ${MAX_ACCOUNTS}).`),
    }),
    async run(args, ctx) {
        const asOf = args.asOf ? endOfDay(args.asOf) : new Date();
        const [book, base] = await Promise.all([
            loadBookAccounts(ctx.bookGuid),
            getBaseCurrencyForBook(ctx.bookGuid),
        ]);
        const sums = await sumSplitsByAccount(book.accounts.map((a) => a.guid), { lte: asOf });
        const valuation = await buildAccountValuationContext(
            book.accounts.map((a) => ({
                accountType: a.type,
                commodityGuid: a.commodityGuid,
                commodityNamespace: a.commodityNamespace,
            })),
            asOf,
            base,
        );

        const own = new Map<string, { quantity: number; value: number; valued: boolean }>();
        for (const account of book.accounts) {
            const quantity = sums.get(account.guid)?.quantity ?? 0;
            const input = {
                accountType: account.type,
                commodityGuid: account.commodityGuid,
                commodityNamespace: account.commodityNamespace,
            };
            const valued = valuation.isConvertible ? valuation.isConvertible(input) : true;
            own.set(account.guid, { quantity, value: quantity * valuation.getMultiplier(input), valued });
        }

        const totalCache = new Map<string, { value: number; complete: boolean }>();
        const total = (guid: string): { value: number; complete: boolean } => {
            const cached = totalCache.get(guid);
            if (cached) return cached;
            const self = own.get(guid)!;
            let value = self.value;
            let complete = self.valued || Math.abs(self.quantity) <= UNVALUED_QUANTITY_EPSILON;
            for (const child of book.childrenOf.get(guid) ?? []) {
                const sub = total(child);
                value += sub.value;
                complete = complete && sub.complete;
            }
            const result = { value, complete };
            totalCache.set(guid, result);
            return result;
        };

        const typeFilter = args.types ? new Set<string>(args.types) : null;
        const rows = book.accounts
            .filter((a) => args.includeHidden || !a.hidden)
            .filter((a) => !typeFilter || typeFilter.has(a.type))
            .map((a) => {
                const self = own.get(a.guid)!;
                const sub = total(a.guid);
                return {
                    guid: a.guid,
                    path: a.path,
                    type: a.type,
                    commodity: a.commodity,
                    ownBalance: round4(naturalSign(a.type, self.quantity)),
                    totalValue: money(naturalSign(a.type, sub.value)),
                    ...(sub.complete ? {} : { partiallyValued: true }),
                    ...(a.placeholder ? { placeholder: true } : {}),
                    ...(a.hidden ? { hidden: true } : {}),
                };
            })
            .filter((r) => args.includeZero || Math.abs(r.totalValue) >= MONEY_DISPLAY_EPSILON || r.ownBalance !== 0)
            .sort((x, y) => x.path.localeCompare(y.path));

        return {
            reportCurrency: base?.mnemonic ?? valuation.reportCurrencyMnemonic,
            asOf: ymd(asOf),
            signConvention: SIGN_NOTE,
            totalMatching: rows.length,
            truncated: rows.length > args.limit,
            accounts: rows.slice(0, args.limit),
            ...(valuation.warnings && valuation.warnings.length > 0 ? { valuationWarnings: valuation.warnings.slice(0, 20) } : {}),
        };
    },
});

// ---------------------------------------------------------------------------
// account_balance_history
// ---------------------------------------------------------------------------

const accountBalanceHistory = defineTool({
    name: 'account_balance_history',
    title: 'Account balance history',
    description:
        'Month-end balances of one account (optionally including its sub-accounts) for the last N months, ' +
        'in the account\'s own commodity (currency for bank/card/loan accounts, shares for STOCK/MUTUAL). ' +
        SIGN_NOTE + ' Sub-accounts in a different commodity are listed in excludedAccounts instead of ' +
        'being summed.',
    inputSchema: z.object({
        account: z.string().min(1).describe('Account path (e.g. "Liabilities:Credit Card"), name, or guid.'),
        months: z.number().int().min(1).max(60).default(12).describe('Number of month-ends to return (≤ 60).'),
        includeSubaccounts: z.boolean().default(true).describe('Add the balances of sub-accounts.'),
    }),
    async run(args, ctx) {
        const book = await loadBookAccounts(ctx.bookGuid);
        const account = requireSingleAccount(book, args.account);
        const subtree = args.includeSubaccounts
            ? descendantsOf(book, account.guid).map((g) => book.byGuid.get(g)!)
            : [];
        const included = [account, ...subtree.filter((a) => a.commodityGuid === account.commodityGuid)];
        const excluded = subtree.filter((a) => a.commodityGuid !== account.commodityGuid);
        const guids = included.map((a) => a.guid);

        const now = new Date();
        const start = monthStartUtc(args.months - 1, now);
        const [opening, monthly] = await Promise.all([
            sumSplitsByAccount(guids, { lt: start }),
            sumSplitsByAccountAndMonth(guids, { gte: start, lte: now }),
        ]);

        let running = 0;
        for (const sums of opening.values()) running += sums.quantity;
        const changeByMonth = new Map<string, number>();
        for (const row of monthly) {
            changeByMonth.set(row.month, (changeByMonth.get(row.month) ?? 0) + row.quantity);
        }

        const points = monthKeysBetween(start, now).map((month) => {
            const change = changeByMonth.get(month) ?? 0;
            running += change;
            return {
                month,
                balance: round4(naturalSign(account.type, running)),
                change: round4(naturalSign(account.type, change)),
            };
        });

        return {
            account: account.path,
            guid: account.guid,
            type: account.type,
            commodity: account.commodity,
            signConvention: SIGN_NOTE,
            note: 'The last point is the balance so far in the current month.',
            includedAccounts: included.length,
            ...(excluded.length > 0
                ? { excludedAccounts: excluded.slice(0, 25).map((a) => ({ path: a.path, commodity: a.commodity })) }
                : {}),
            points,
        };
    },
});

// ---------------------------------------------------------------------------
// search_transactions
// ---------------------------------------------------------------------------

const MAX_TRANSACTIONS = 200;

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const searchTransactions = defineTool({
    name: 'search_transactions',
    title: 'Search transactions',
    description:
        'Find transactions, newest first. Filters combine with AND: text (matches description, number, ' +
        'or split memo), date range, account (path, name, or guid — its sub-accounts are included), and ' +
        'amount range (absolute split amount, in the transaction currency). Each transaction lists its ' +
        'splits with account path and amount in the account\'s commodity. Split amounts keep GnuCash ' +
        'double-entry signs: positive = debit (money into an asset account, or an expense), ' +
        'negative = credit (money out of an asset account, a credit-card charge, or income earned).',
    inputSchema: z.object({
        text: z.string().max(200).optional().describe('Case-insensitive text to look for.'),
        startDate: isoDate.optional().describe('Earliest post date (YYYY-MM-DD).'),
        endDate: isoDate.optional().describe('Latest post date (YYYY-MM-DD).'),
        account: z.string().min(1).optional().describe('Account path, name, or guid.'),
        minAmount: z.number().nonnegative().optional().describe('Smallest absolute split amount.'),
        maxAmount: z.number().nonnegative().optional().describe('Largest absolute split amount.'),
        limit: z.number().int().min(1).max(MAX_TRANSACTIONS).default(50).describe(`Max transactions (≤ ${MAX_TRANSACTIONS}).`),
    }).refine((a) => a.minAmount === undefined || a.maxAmount === undefined || a.minAmount <= a.maxAmount, {
        message: 'minAmount must not exceed maxAmount',
        path: ['minAmount'],
    }).refine((a) => !a.startDate || !a.endDate || a.startDate <= a.endDate, {
        message: 'startDate must not be after endDate',
        path: ['startDate'],
    }),
    async run(args, ctx) {
        const book = await loadBookAccounts(ctx.bookGuid);
        const scopeGuids = book.accounts.map((a) => a.guid);
        if (scopeGuids.length === 0) return { transactions: [], truncated: false };

        let accountGuids: string[] | null = null;
        if (args.account) {
            const matches = resolveAccountRef(book, args.account);
            const set = new Set<string>();
            for (const m of matches) {
                set.add(m.guid);
                for (const d of descendantsOf(book, m.guid)) set.add(d);
            }
            accountGuids = [...set];
        }

        const amountConds = (alias: string): Prisma.Sql => {
            const abs = Prisma.sql`ABS(${Prisma.raw(alias)}.value_num::numeric / NULLIF(${Prisma.raw(alias)}.value_denom, 0)::numeric)`;
            return Prisma.sql`
                ${args.minAmount !== undefined ? Prisma.sql`AND ${abs} >= ${args.minAmount}` : Prisma.empty}
                ${args.maxAmount !== undefined ? Prisma.sql`AND ${abs} <= ${args.maxAmount}` : Prisma.empty}
            `;
        };
        const hasAmount = args.minAmount !== undefined || args.maxAmount !== undefined;

        const conditions: Prisma.Sql[] = [
            Prisma.sql`EXISTS (SELECT 1 FROM splits sb WHERE sb.tx_guid = t.guid AND sb.account_guid = ANY(${scopeGuids}::text[]))`,
        ];
        if (args.startDate) conditions.push(Prisma.sql`t.post_date >= ${startOfDay(args.startDate)}`);
        if (args.endDate) conditions.push(Prisma.sql`t.post_date <= ${endOfDay(args.endDate)}`);
        if (args.text && args.text.trim()) {
            const pattern = `%${escapeLike(args.text.trim())}%`;
            conditions.push(Prisma.sql`(
                t.description ILIKE ${pattern}
                OR t.num ILIKE ${pattern}
                OR EXISTS (SELECT 1 FROM splits sm WHERE sm.tx_guid = t.guid AND sm.memo ILIKE ${pattern})
            )`);
        }
        if (accountGuids) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM splits sa
                WHERE sa.tx_guid = t.guid AND sa.account_guid = ANY(${accountGuids}::text[])
                ${amountConds('sa')}
            )`);
        } else if (hasAmount) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM splits sa
                WHERE sa.tx_guid = t.guid AND sa.account_guid = ANY(${scopeGuids}::text[])
                ${amountConds('sa')}
            )`);
        }

        const rows = await prisma.$queryRaw<Array<{
            guid: string;
            post_date: Date | null;
            num: string;
            description: string | null;
        }>>`
            SELECT t.guid, t.post_date, t.num, t.description
            FROM transactions t
            WHERE ${Prisma.join(conditions, ' AND ')}
            ORDER BY t.post_date DESC NULLS LAST, t.guid
            LIMIT ${args.limit + 1}
        `;
        const truncated = rows.length > args.limit;
        const page = rows.slice(0, args.limit);
        const txGuids = page.map((r) => r.guid);

        const splits = txGuids.length === 0 ? [] : await prisma.splits.findMany({
            where: { tx_guid: { in: txGuids }, account_guid: { in: scopeGuids } },
            select: {
                tx_guid: true,
                account_guid: true,
                memo: true,
                quantity_num: true,
                quantity_denom: true,
                reconcile_state: true,
            },
        });
        const splitsByTx = new Map<string, typeof splits>();
        for (const split of splits) {
            const list = splitsByTx.get(split.tx_guid) ?? [];
            list.push(split);
            splitsByTx.set(split.tx_guid, list);
        }

        return {
            signConvention:
                'Split amounts are raw double-entry signs: positive = debit, negative = credit.',
            truncated,
            transactions: page.map((tx) => ({
                guid: tx.guid,
                date: ymd(tx.post_date),
                ...(tx.num ? { num: tx.num } : {}),
                description: tx.description ?? '',
                splits: (splitsByTx.get(tx.guid) ?? []).map((s) => {
                    const account = book.byGuid.get(s.account_guid);
                    return {
                        account: account?.path ?? s.account_guid,
                        amount: round4(toDecimalNumber(s.quantity_num, s.quantity_denom)),
                        commodity: account?.commodity ?? null,
                        ...(s.memo ? { memo: s.memo } : {}),
                        reconciled: s.reconcile_state,
                    };
                }),
            })),
        };
    },
});

// ---------------------------------------------------------------------------
// spending_by_category
// ---------------------------------------------------------------------------

const spendingByCategory = defineTool({
    name: 'spending_by_category',
    title: 'Spending by category',
    description:
        'Total spending per expense category for a date range, largest first, converted to the book ' +
        'report currency. Expenses are positive amounts spent; refunds reduce them. Categories are ' +
        'expense account paths truncated to `depth` levels below "Expenses" (depth 1 = "Expenses:Food", ' +
        'depth 2 = "Expenses:Food:Groceries"). Defaults to the current month to date.',
    inputSchema: z.object({
        startDate: isoDate.optional().describe('Start date (YYYY-MM-DD). Default: first day of this month.'),
        endDate: isoDate.optional().describe('End date (YYYY-MM-DD). Default: today.'),
        depth: z.number().int().min(1).max(5).default(1).describe('Category depth below the top-level expense account.'),
        limit: z.number().int().min(1).max(100).default(25).describe('Max categories (≤ 100).'),
    }).refine((a) => !a.startDate || !a.endDate || a.startDate <= a.endDate, {
        message: 'startDate must not be after endDate',
        path: ['startDate'],
    }),
    async run(args, ctx) {
        const now = new Date();
        const start = args.startDate ? startOfDay(args.startDate) : monthStartUtc(0, now);
        const end = args.endDate ? endOfDay(args.endDate) : now;
        const [book, base] = await Promise.all([loadBookAccounts(ctx.bookGuid), requireBaseCurrency(ctx.bookGuid)]);
        const expenses = book.accounts.filter((a) => a.type === 'EXPENSE');
        const [sums, rates] = await Promise.all([
            sumSplitsByAccount(expenses.map((a) => a.guid), { gte: start, lte: end }),
            ratesIntoBase(expenses, base, end),
        ]);

        const byCategory = new Map<string, { amount: number; accounts: number }>();
        let total = 0;
        for (const account of expenses) {
            const quantity = sums.get(account.guid)?.quantity ?? 0;
            if (Math.abs(quantity) <= UNVALUED_QUANTITY_EPSILON) continue;
            const amount = quantity * (rates.get(account.guid) ?? 1);
            const category = account.path.split(':').slice(0, 1 + args.depth).join(':');
            const entry = byCategory.get(category) ?? { amount: 0, accounts: 0 };
            entry.amount += amount;
            entry.accounts += 1;
            byCategory.set(category, entry);
            total += amount;
        }

        const categories = [...byCategory.entries()]
            .map(([category, v]) => ({
                category,
                amount: money(v.amount),
                sharePct: total !== 0 ? round2((v.amount / total) * 100) : null,
                accounts: v.accounts,
            }))
            .sort((a, b) => b.amount - a.amount);

        return {
            period: { start: ymd(start), end: ymd(end) },
            currency: base.mnemonic,
            total: money(total),
            totalCategories: categories.length,
            truncated: categories.length > args.limit,
            categories: categories.slice(0, args.limit),
        };
    },
});

// ---------------------------------------------------------------------------
// income_vs_expense
// ---------------------------------------------------------------------------

const incomeVsExpense = defineTool({
    name: 'income_vs_expense',
    title: 'Income vs expense by month',
    description:
        'Monthly income, expenses, taxes (expense accounts whose path mentions "tax", included in ' +
        'expenses), and net (income − expenses) for the last N months, in the book report currency. ' +
        'Income is shown as a positive number (GnuCash stores it negative). Hidden accounts are excluded, ' +
        'matching the dashboard. The current month is partial.',
    inputSchema: z.object({
        months: z.number().int().min(1).max(36).default(12).describe('Number of months including the current one (≤ 36).'),
    }),
    async run(args, ctx) {
        const now = new Date();
        const start = monthStartUtc(args.months - 1, now);
        const [book, base] = await Promise.all([loadBookAccounts(ctx.bookGuid), requireBaseCurrency(ctx.bookGuid)]);
        const relevant = book.accounts.filter((a) => (a.type === 'INCOME' || a.type === 'EXPENSE') && !a.hidden);
        const incomeGuids = new Set(relevant.filter((a) => a.type === 'INCOME').map((a) => a.guid));
        const expenseGuids = new Set(relevant.filter((a) => a.type === 'EXPENSE').map((a) => a.guid));
        const taxExpenseGuids = new Set(
            relevant.filter((a) => a.type === 'EXPENSE' && a.path.toLowerCase().includes('tax')).map((a) => a.guid),
        );
        const [rows, ratesByAccount] = await Promise.all([
            sumSplitsByAccountAndMonth([...incomeGuids, ...expenseGuids], { gte: start, lte: now }),
            ratesIntoBase(relevant, base, now),
        ]);
        const monthly = buildMonthlySeries(rows, {
            incomeGuids,
            expenseGuids,
            taxExpenseGuids,
            ratesByAccount,
            startDate: start,
            endDate: now,
        });
        const totals = monthly.reduce(
            (acc, m) => ({ income: acc.income + m.income, expenses: acc.expenses + m.expenses }),
            { income: 0, expenses: 0 },
        );
        return {
            currency: base.mnemonic,
            months: monthly.map((m) => ({
                month: m.month,
                income: money(m.income),
                expenses: money(m.expenses),
                taxes: money(m.taxes),
                net: money(m.netProfit),
            })),
            totals: {
                income: money(totals.income),
                expenses: money(totals.expenses),
                net: money(totals.income - totals.expenses),
                savingsRatePct: totals.income > 0 ? round2(((totals.income - totals.expenses) / totals.income) * 100) : null,
            },
        };
    },
});

// ---------------------------------------------------------------------------
// net_worth
// ---------------------------------------------------------------------------

const netWorth = defineTool({
    name: 'net_worth',
    title: 'Net worth',
    description:
        'Current net worth (assets + investments at market price − liabilities) in the book report ' +
        'currency, plus month-end history for the last N months. Liabilities are shown as a positive ' +
        'amount owed. Hidden accounts are excluded. coverage lists holdings that could not be priced ' +
        '(they count as 0, so the total is partial when it is non-empty).',
    inputSchema: z.object({
        months: z.number().int().min(0).max(36).default(12).describe('Month-ends of history before today (0 = current only, ≤ 36).'),
    }),
    async run(args, ctx) {
        const now = new Date();
        const [guids, base] = await Promise.all([
            getAccountGuidsForBook(ctx.bookGuid),
            requireBaseCurrency(ctx.bookGuid),
        ]);

        // Month-end instants, oldest first, then "now".
        const points: Date[] = [];
        for (let back = args.months; back >= 1; back--) {
            points.push(new Date(monthStartUtc(back - 1, now).getTime() - 1000));
        }
        points.push(now);

        // computeNetWorthSummary values two dates per call; walk the points in pairs.
        const results = new Map<number, { netWorth: number; assets: number; liabilities: number; investments: number; gaps: number; warnings: string[] }>();
        for (let i = 0; i < points.length; i += 2) {
            const a = points[i];
            const b = points[Math.min(i + 1, points.length - 1)];
            const summary = await FinancialSummaryService.computeNetWorthSummary(guids, a, b, base);
            for (const [date, r] of [[a, summary.start], [b, summary.end]] as const) {
                results.set(date.getTime(), {
                    netWorth: r.netWorth,
                    assets: r.assets,
                    liabilities: -r.liabilities,
                    investments: r.investmentValue,
                    gaps: r.coverage.gaps.length,
                    warnings: r.coverage.gaps.map((gap) => gap.message),
                });
            }
        }

        const current = results.get(now.getTime())!;
        return {
            currency: base.mnemonic,
            asOf: ymd(now),
            current: {
                netWorth: money(current.netWorth),
                assets: money(current.assets),
                investments: money(current.investments),
                liabilities: money(current.liabilities),
            },
            coverage: current.gaps === 0
                ? { complete: true }
                : { complete: false, unpricedHoldings: current.gaps, warnings: current.warnings.slice(0, 10) },
            history: points.slice(0, -1).map((date) => {
                const r = results.get(date.getTime())!;
                return { date: ymd(date), netWorth: money(r.netWorth), ...(r.gaps > 0 ? { partial: true } : {}) };
            }),
        };
    },
});

// ---------------------------------------------------------------------------
// budget_status
// ---------------------------------------------------------------------------

const budgetStatus = defineTool({
    name: 'budget_status',
    title: 'Budget status',
    description:
        'Budgeted vs actual amounts for the current period of a budget (by default the budget covering ' +
        'today), with pacing (projected end-of-period spend) per account and for total expenses. ' +
        'Amounts are positive; for income lines "actual" is income received. remaining = budgeted − actual. ' +
        'Also lists the book\'s other budgets by name.',
    inputSchema: z.object({
        budget: z.string().min(1).optional().describe('Budget name or guid. Default: the budget covering today.'),
        asOf: isoDate.optional().describe('Evaluate as of this date (YYYY-MM-DD). Default: today.'),
        limit: z.number().int().min(1).max(200).default(50).describe('Max account lines (≤ 200), largest budget first.'),
    }),
    async run(args, ctx) {
        const budgets = (await BudgetService.list(ctx.bookGuid)) as unknown as Array<BudgetLike & { guid: string; name: string }>;
        if (budgets.length === 0) throw new McpToolError('This book has no budgets.');

        let chosen: (typeof budgets)[number] | null = null;
        if (args.budget) {
            const ref = args.budget.trim().toLowerCase();
            chosen = budgets.find((b) => b.guid.toLowerCase() === ref)
                ?? budgets.find((b) => b.name.toLowerCase() === ref)
                ?? null;
            if (!chosen) {
                throw new McpToolError(`No budget named "${args.budget}". Budgets: ${budgets.map((b) => b.name).join('; ')}`);
            }
        } else {
            chosen = pickCurrentBudget(budgets, args.asOf ? startOfDay(args.asOf) : new Date());
            if (!chosen) throw new McpToolError('No budget covers that date.');
        }

        const [actuals, book] = await Promise.all([
            loadBudgetActuals(ctx.bookGuid, chosen.guid, args.asOf ? { asOf: args.asOf } : {}),
            loadBookAccounts(ctx.bookGuid),
        ]);
        if (!actuals) throw new McpToolError('Budget not found in this book.');

        const period = actuals.currentPeriod;
        const lines = actuals.accounts
            .filter((a) => !a.nestedUnderBudgeted)
            .map((a) => {
                const p = period !== null ? a.periods.find((x) => x.periodNum === period) : undefined;
                return {
                    account: book.byGuid.get(a.guid)?.path ?? a.name,
                    type: a.type,
                    budgeted: money(p?.budgeted ?? a.total.budgeted),
                    actual: money(p?.actual ?? a.total.actual),
                    remaining: money(p?.remaining ?? a.total.remaining),
                    pctUsed: p?.pctUsed ?? a.total.pctUsed,
                    ...(a.pacing ? { pace: a.pacing.status, projected: money(a.pacing.projected) } : {}),
                };
            })
            .sort((x, y) => Math.abs(y.budgeted) - Math.abs(x.budgeted));

        return {
            budget: actuals.budgetName,
            currency: actuals.currency,
            asOf: actuals.asOf,
            period: period !== null ? actuals.periods.find((p) => p.periodNum === period) ?? null : null,
            scope: period !== null ? 'current period' : 'whole budget (as-of date is outside it)',
            expenseTotals: actuals.pacing
                ? {
                    budgeted: money(actuals.pacing.budgeted),
                    actual: money(actuals.pacing.actual),
                    pctUsed: actuals.pacing.pctUsed,
                    projected: money(actuals.pacing.projected),
                    pace: actuals.pacing.status,
                }
                : {
                    budgeted: money(actuals.totals.budgeted),
                    actual: money(actuals.totals.actual),
                    pctUsed: actuals.totals.pctUsed,
                },
            totalLines: lines.length,
            truncated: lines.length > args.limit,
            lines: lines.slice(0, args.limit),
            otherBudgets: budgets.filter((b) => b.guid !== chosen.guid).map((b) => b.name).slice(0, 25),
        };
    },
});

// ---------------------------------------------------------------------------
// recurring_charges
// ---------------------------------------------------------------------------

const recurringCharges = defineTool({
    name: 'recurring_charges',
    title: 'Recurring charges',
    description:
        'Subscriptions and other recurring charges detected from spending history (same merchant, ' +
        'regular cadence). Each series has cadence, current and typical amount, price change %, ' +
        'monthly-equivalent cost, last and next expected date, and status (active, new, stopped). ' +
        'Amounts are positive spend in the book currency.',
    inputSchema: z.object({
        months: z.number().int().min(3).max(36).default(12).describe('History window in months (3–36).'),
        includeStopped: z.boolean().default(false).describe('Include series that appear to have stopped.'),
        limit: z.number().int().min(1).max(100).default(50).describe('Max series (≤ 100), highest monthly cost first.'),
    }),
    async run(args, ctx) {
        const guids = await getAccountGuidsForBook(ctx.bookGuid);
        const result = await detectRecurringCharges(guids, { months: args.months });
        const series = result.series
            .filter((s) => args.includeStopped || s.status !== 'stopped')
            .sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
        return {
            totals: {
                activeCount: result.totals.activeCount,
                activeMonthlyTotal: money(result.totals.activeMonthlyTotal),
                activeAnnualTotal: money(result.totals.activeAnnualTotal),
                priceIncreaseCount: result.totals.priceIncreaseCount,
            },
            truncated: series.length > args.limit,
            series: series.slice(0, args.limit).map((s) => ({
                merchant: s.merchantLabel,
                cadence: s.cadence,
                status: s.status,
                currentAmount: money(s.currentAmount),
                typicalAmount: money(s.typicalAmount),
                amountChangePct: round2(s.amountChangePct),
                monthlyEquivalent: money(s.monthlyEquivalent),
                occurrences: s.occurrences,
                firstSeen: s.firstSeen,
                lastSeen: s.lastSeen,
                nextExpected: s.nextExpected,
                account: s.accountName,
            })),
        };
    },
});

// ---------------------------------------------------------------------------
// investment_holdings
// ---------------------------------------------------------------------------

const investmentHoldings = defineTool({
    name: 'investment_holdings',
    title: 'Investment holdings',
    description:
        'Current investment positions (STOCK/MUTUAL accounts): symbol, shares, latest price and its date, ' +
        'market value, cost basis, and unrealized gain, largest position first, plus portfolio totals in ' +
        'the book report currency. Cost basis is the sum of the account\'s own purchase values (no ' +
        'transfer tracing), so treat gains as approximate when shares moved between accounts.',
    inputSchema: z.object({
        includeZeroShares: z.boolean().default(false).describe('Include closed positions with zero shares.'),
        limit: z.number().int().min(1).max(200).default(100).describe('Max holdings (≤ 200).'),
    }),
    async run(args, ctx) {
        const book = await loadBookAccounts(ctx.bookGuid);
        const report = await generateInvestmentPortfolio(
            { startDate: null, endDate: null, bookAccountGuids: book.accounts.map((a) => a.guid) },
            args.includeZeroShares,
        );
        const holdings = [...report.holdings].sort((a, b) => b.marketValue - a.marketValue);
        return {
            asOf: ymd(new Date()),
            totals: {
                marketValue: money(report.totals.marketValue),
                costBasis: money(report.totals.costBasis),
                gain: money(report.totals.gain),
                gainPct: round2(report.totals.gainPercent),
            },
            totalHoldings: holdings.length,
            truncated: holdings.length > args.limit,
            holdings: holdings.slice(0, args.limit).map((h) => ({
                account: book.byGuid.get(h.guid)?.path ?? h.accountName,
                symbol: h.symbol,
                shares: round4(h.shares),
                price: h.latestPrice,
                priceDate: h.priceDate,
                marketValue: money(h.marketValue),
                costBasis: money(h.costBasis),
                gain: money(h.gain),
                gainPct: round2(h.gainPercent),
            })),
        };
    },
});

// ---------------------------------------------------------------------------
// upcoming_scheduled_transactions
// ---------------------------------------------------------------------------

const upcomingScheduledTransactions = defineTool({
    name: 'upcoming_scheduled_transactions',
    title: 'Upcoming scheduled transactions',
    description:
        'Occurrences of enabled scheduled (recurring) transactions due in the next N days, soonest first, ' +
        'with each split\'s account and amount. Split amounts keep GnuCash double-entry signs ' +
        '(positive = debit, negative = credit).',
    inputSchema: z.object({
        days: z.number().int().min(1).max(365).default(30).describe('Days ahead to look (1–365).'),
        limit: z.number().int().min(1).max(200).default(100).describe('Max occurrences (≤ 200).'),
    }),
    async run(args, ctx) {
        // Same scoping as GET /api/scheduled-transactions/upcoming: the query is
        // book-scoped through the template root, and every split must land in
        // the book (defense in depth).
        const scoped = new Set(await getAccountGuidsForBook(ctx.bookGuid));
        const schedules = (await fetchScheduledTransactions(true, ctx.bookGuid))
            .filter((st) => st.splits.length > 0 && st.splits.every((s) => scoped.has(s.accountGuid)));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const windowEnd = new Date(today);
        windowEnd.setDate(windowEnd.getDate() + args.days);

        const occurrences: Array<{ date: string; name: string; splits: Array<{ account: string; amount: number }> }> = [];
        for (const st of schedules) {
            if (!st.recurrence || st.remainingOccurrences === 0) continue;
            const patterns: RecurrencePattern[] = (st.recurrences?.length ? st.recurrences : [st.recurrence]).map((r) => ({
                periodType: r.periodType,
                mult: r.mult,
                periodStart: new Date(r.periodStart),
                weekendAdjust: r.weekendAdjust,
            }));
            const dates = computeNextOccurrencesForPatterns(
                patterns,
                st.lastOccur ? new Date(st.lastOccur) : null,
                st.endDate ? new Date(st.endDate) : null,
                st.remainingOccurrences > 0 ? st.remainingOccurrences : null,
                Math.min(args.days, 60),
                today,
            );
            for (const date of dates) {
                if (date > windowEnd) break;
                occurrences.push({
                    date: date.toISOString().slice(0, 10),
                    name: st.name,
                    splits: st.splits.map((s) => ({ account: s.accountName, amount: round4(s.amount) })),
                });
            }
        }
        occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
        return {
            window: { from: ymd(today), to: ymd(windowEnd) },
            totalOccurrences: occurrences.length,
            truncated: occurrences.length > args.limit,
            occurrences: occurrences.slice(0, args.limit),
        };
    },
});

// ---------------------------------------------------------------------------
// action_center_items
// ---------------------------------------------------------------------------

const actionCenterItems = defineTool({
    name: 'action_center_items',
    title: 'Action Center items',
    description:
        'Open items from the Financial Action Center: things to fix (data problems), decide ' +
        '(opportunities), or do (deadlines), most important first. Each item has lane, severity, title, ' +
        'summary, due date, and estimated impact range. Read-only: items cannot be resolved from here.',
    inputSchema: z.object({
        lane: z.enum(['fix', 'decide', 'do']).optional().describe('Only this lane.'),
        severity: z.enum(['info', 'warning', 'critical']).optional().describe('Only this severity.'),
        limit: z.number().int().min(1).max(100).default(30).describe('Max items (≤ 100).'),
    }),
    async run(args, ctx) {
        const bookAccountGuids = await getAccountGuidsForBook(ctx.bookGuid);
        const list = await listFinancialActions({
            userId: ctx.userId,
            bookGuid: ctx.bookGuid,
            bookAccountGuids,
            includeCompleted: false,
            refresh: false,
        });
        const items = list.actions
            .filter((a) => !args.lane || a.lane === args.lane)
            .filter((a) => !args.severity || a.severity === args.severity);
        return {
            summary: list.summary,
            verifiedThrough: list.verifiedThrough,
            totalItems: items.length,
            truncated: items.length > args.limit,
            items: items.slice(0, args.limit).map((a) => ({
                id: a.id,
                lane: a.lane,
                severity: a.severity,
                state: a.state,
                title: a.title,
                summary: a.summary,
                dueDate: a.dueDate ?? null,
                ...(a.impact ? { impact: { low: money(a.impact.low), high: money(a.impact.high), period: a.impact.period } } : {}),
                confidence: a.confidence,
            })),
        };
    },
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MCP_TOOLS: ReadonlyArray<McpTool> = [
    listAccounts,
    accountBalanceHistory,
    searchTransactions,
    spendingByCategory,
    incomeVsExpense,
    netWorth,
    budgetStatus,
    recurringCharges,
    investmentHoldings,
    upcomingScheduledTransactions,
    actionCenterItems,
] as unknown as ReadonlyArray<McpTool>;

export function findMcpTool(name: string): McpTool | undefined {
    return MCP_TOOLS.find((tool) => tool.name === name);
}
