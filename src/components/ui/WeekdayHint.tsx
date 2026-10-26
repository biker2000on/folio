'use client';

import { formatWeekday } from '@/lib/date-format';

interface WeekdayHintProps {
    /** ISO date (YYYY-MM-DD). Anything else renders nothing. */
    isoDate: string | null | undefined;
    /** Smaller type and tighter inset for the ledger's compact inputs. */
    compact?: boolean;
}

/**
 * The weekday of a date field's value, pinned inside the field's right edge
 * so it is visible while the date is being typed — a check that the "15th"
 * really is the Friday the receipt says. The host wraps its input in a
 * `relative` container and reserves the space with right padding (`pr-11`,
 * or `pr-8` for `compact`). Renders nothing until the typed text parses as
 * a date, so a half-typed field never shows a stale weekday.
 */
export function WeekdayHint({ isoDate, compact = false }: WeekdayHintProps) {
    const weekday = formatWeekday(isoDate);
    if (!weekday) return null;
    return (
        <span
            data-testid="weekday-hint"
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 font-mono uppercase tracking-wider text-foreground-muted ${
                compact ? 'right-2 text-[10px]' : 'right-3 text-[11px]'
            }`}
        >
            {weekday}
        </span>
    );
}
