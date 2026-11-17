/**
 * Formatting shared by the dashboard's time-series charts, so both charts
 * write money, dates and periods the same way. Pure and client-safe.
 */

const compact = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
});

const full = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const whole = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

/** Axis labels: "$1.45M", "-$5K", "$0". The sign always leads the symbol. */
export function axisMoney(value: number): string {
    if (Object.is(value, -0) || Math.abs(value) < 0.5) return '$0';
    return compact.format(value);
}

/** Tooltip and header figures: "$1,555,172.04". */
export function fullMoney(value: number): string {
    return full.format(value);
}

/** Header figures where cents are noise: "$1,555,172". */
export function wholeMoney(value: number): string {
    return whole.format(value);
}

/** A signed change: "+$12,300" / "-$4,100". */
export function signedMoney(value: number): string {
    const formatted = whole.format(Math.abs(value));
    if (Math.abs(value) < 0.5) return formatted;
    return `${value > 0 ? '+' : '-'}${formatted}`;
}

export function signedPercent(value: number): string {
    if (!Number.isFinite(value)) return '';
    return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1)}%`;
}

export type PeriodKind = 'month' | 'quarter' | 'year';

/** A period key from the cash-flow API: "2026-03", "2026-Q1" or "2026". */
export function periodKind(key: string): PeriodKind {
    if (/^\d{4}$/.test(key)) return 'year';
    if (/^\d{4}-Q\d$/.test(key)) return 'quarter';
    return 'month';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * An x-axis label. Months read "Mar", with the year on January and on the
 * first tick ("Jan '26"), so "Jan 26" is never mistaken for a day.
 */
export function axisPeriod(key: string, index = 1): string {
    const kind = periodKind(key);
    if (kind === 'year') return key;
    const year = key.slice(2, 4);
    if (kind === 'quarter') return `${key.slice(5)} '${year}`;
    const month = Number(key.slice(5, 7)) - 1;
    const name = MONTHS[month] ?? key;
    return month === 0 || index === 0 ? `${name} '${year}` : name;
}

/** A tooltip heading: "March 2026", "Q1 2026", "2026". */
export function longPeriod(key: string): string {
    const kind = periodKind(key);
    if (kind === 'year') return key;
    if (kind === 'quarter') return `${key.slice(5)} ${key.slice(0, 4)}`;
    return `${MONTHS_LONG[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;
}

/** The key of the period containing `today` (YYYY-MM-DD), in the same form as `sample`. */
export function currentPeriodKey(sample: string, today: string): string {
    const kind = periodKind(sample);
    const year = today.slice(0, 4);
    if (kind === 'year') return year;
    if (kind === 'quarter') return `${year}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;
    return today.slice(0, 7);
}

/**
 * Drop periods after the one containing today. A "This Year" range ends on
 * Dec 31; a future month is not a month with no money in it, it has not
 * happened. Keys of one kind sort chronologically as strings.
 */
export function clipFuturePeriods<T extends { month: string }>(rows: T[], today: string): T[] {
    if (rows.length === 0) return rows;
    const current = currentPeriodKey(rows[0].month, today);
    return rows.filter(row => row.month <= current);
}

/** Today in local time as YYYY-MM-DD. */
export function localToday(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
