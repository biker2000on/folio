export type DateFormat = 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'MM-DD-YYYY';

export function formatDateForDisplay(isoDate: string, format: DateFormat): string {
    if (!isoDate || !isoDate.includes('-')) return isoDate;
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    const [y, m, d] = parts;
    switch (format) {
        case 'MM/DD/YYYY': return `${m}/${d}/${y}`;
        case 'MM-DD-YYYY': return `${m}-${d}-${y}`;
        case 'YYYY-MM-DD': return isoDate;
    }
}

/**
 * How far back the sliding year-completion window starts, in months.
 * GnuCash desktop's default (`date-backmonths` in its gschema): a date typed
 * without a year lands in the 12-month window from 6 months ago to 5 months
 * ahead, so "12/31" typed in January is last December, not next.
 */
export const DATE_COMPLETION_BACK_MONTHS = 6;

/**
 * The year for a month typed without one — GnuCash desktop's sliding
 * completion (`qof_scan_date_internal` in libgnucash/engine/gnc-date.cpp):
 *
 *     year = now_year - floor((month - now_month + backMonths) / 12)
 *
 * With the default 6 back months: in January, months 7–12 are last year
 * and 1–6 this year; in October, months 4–12 are this year and 1–3 next.
 */
export function completeYear(month: number, now: Date, backMonths = DATE_COMPLETION_BACK_MONTHS): number {
    const nowMonth = now.getMonth() + 1;
    return now.getFullYear() - Math.floor((month - nowMonth + backMonths) / 12);
}

/**
 * Parse what a user typed into a date field into ISO YYYY-MM-DD, or null.
 *
 * Full forms: YYYY-MM-DD, M/D/YYYY, M-D-YYYY (two-digit years are 20xx).
 * Short forms, as GnuCash desktop's register accepts them: "10/5" (or
 * "10-5", "10.5") is October 5 with the year completed by the sliding
 * window above, and a bare day "5" is the 5th of the current month.
 * `now` is the reference date, injectable for tests; it defaults to today
 * in local time.
 */
export function parseDateInput(input: string, now: Date = new Date()): string | null {
    if (!input || !input.trim()) return null;
    const s = input.trim();

    // Short forms first: "10/5" → month/day, year from the sliding window;
    // "5" → this month.
    const monthDay = s.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
    if (monthDay) {
        const [, m] = monthDay;
        const month = parseInt(m);
        if (month < 1 || month > 12) return null;
        return validateAndBuild(completeYear(month, now), month, parseInt(monthDay[2]));
    }
    const dayOnly = s.match(/^(\d{1,2})$/);
    if (dayOnly) {
        return validateAndBuild(now.getFullYear(), now.getMonth() + 1, parseInt(dayOnly[1]));
    }

    // Try YYYY-MM-DD (ISO)
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const [, y, m, d] = isoMatch;
        return validateAndBuild(parseInt(y), parseInt(m), parseInt(d));
    }

    // Try MM/DD/YYYY or M/D/YYYY
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
        const [, m, d, y] = slashMatch;
        const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
        return validateAndBuild(year, parseInt(m), parseInt(d));
    }

    // Try MM-DD-YYYY or M-D-YYYY
    const dashMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if (dashMatch) {
        const [, m, d, y] = dashMatch;
        const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
        return validateAndBuild(year, parseInt(m), parseInt(d));
    }

    return null;
}

function validateAndBuild(year: number, month: number, day: number): string | null {
    if (month < 1 || month > 12) return null;
    if (day < 1) return null;
    // Validate day against actual days in month
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) return null;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const yyyy = String(year).padStart(4, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Short weekday ("Sat") for an ISO date, or '' when the text is not a full
 * YYYY-MM-DD. Built from the calendar parts at local noon so the day never
 * shifts across a timezone boundary the way `new Date('YYYY-MM-DD')` (UTC
 * midnight) can.
 */
export function formatWeekday(isoDate: string | null | undefined): string {
    if (!isoDate) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!m) return '';
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { weekday: 'short' });
}
