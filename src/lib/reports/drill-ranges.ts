/**
 * What a clicked report figure covers, so the drill-down lists the
 * transactions behind exactly that number. Pure and client-safe.
 *
 *  - `period`  a figure that is activity over a range (an income-statement
 *              line, a cash-flow line): the transactions in the range.
 *  - `balance` a figure that is a balance at a date (a balance-sheet line):
 *              the opening balance before the range plus the activity in it.
 */

export type DrillMode = 'period' | 'balance';

export interface DrillRange {
    mode: DrillMode;
    /** YYYY-MM-DD, inclusive. */
    startDate: string;
    /** YYYY-MM-DD, inclusive. */
    endDate: string;
    /** Shown under the account name in the popup. */
    label: string;
    /** List only the account itself, not its sub-accounts. */
    accountOnly?: boolean;
}

const DAY_MS = 86_400_000;

function toDay(iso: string): number {
    return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function fromDay(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** "Jan 1, 2026" */
export function formatDrillDate(iso: string): string {
    return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

export function periodRange(startDate: string, endDate: string): DrillRange {
    return {
        mode: 'period',
        startDate,
        endDate,
        label: `${formatDrillDate(startDate)} to ${formatDrillDate(endDate)}`,
    };
}

/**
 * A balance at `asOf`, listed as an opening balance plus the activity from
 * `windowStart`. Without a window the activity starts on Jan 1 of the as-of
 * year, so a balance never means listing an account's whole history.
 */
export function balanceRange(asOf: string, windowStart?: string): DrillRange {
    const start = windowStart && windowStart <= asOf ? windowStart : `${asOf.slice(0, 4)}-01-01`;
    return {
        mode: 'balance',
        startDate: start,
        endDate: asOf,
        label: `Balance at ${formatDrillDate(asOf)}`,
    };
}

/** The day before `iso`. */
export function dayBefore(iso: string): string {
    return fromDay(toDay(iso) - DAY_MS);
}

/**
 * The comparison period the income statement uses: the same length,
 * immediately before. Mirrors generateIncomeStatement, which measures the
 * length from the start of `startDate` to the end of `endDate`.
 */
export function previousPeriodRange(startDate: string, endDate: string): DrillRange {
    const start = toDay(startDate);
    const end = toDay(endDate) + DAY_MS - 1;
    const previousStart = start - (end - start);
    return periodRange(fromDay(previousStart), fromDay(start - 1));
}

const ACCOUNT_GUID = /^[0-9a-f]{32}$/i;

/** Real accounts have 32-hex GnuCash guids; synthetic rows (totals, net income) do not. */
export function isAccountGuid(guid: string): boolean {
    return ACCOUNT_GUID.test(guid);
}

/**
 * The sign the popup should show its rows in so they read like the report.
 *
 * Reports present some balances negated (liabilities, equity, cash-flow
 * lines) while the ledger stores them the other way. When the listed total
 * has the opposite sign to the figure that was clicked and roughly the same
 * size, show the rows flipped; otherwise leave them as stored.
 */
export function displaySignFor(listedTotal: number, reportFigure: number | undefined): 1 | -1 {
    if (reportFigure === undefined || reportFigure === 0 || listedTotal === 0) return 1;
    if (Math.sign(listedTotal) === Math.sign(reportFigure)) return 1;
    const larger = Math.max(Math.abs(listedTotal), Math.abs(reportFigure));
    return Math.abs(Math.abs(listedTotal) - Math.abs(reportFigure)) <= larger * 0.01 ? -1 : 1;
}
