import { describe, expect, it } from 'vitest';
import { formatWeekday } from '../date-format';

describe('formatWeekday', () => {
    it('names the weekday of a full ISO date', () => {
        expect(formatWeekday('2026-10-25')).toBe('Sun');
        expect(formatWeekday('2026-10-26')).toBe('Mon');
        expect(formatWeekday('2024-02-29')).toBe('Thu');
    });

    it('is empty for anything that is not a complete YYYY-MM-DD', () => {
        expect(formatWeekday('')).toBe('');
        expect(formatWeekday(null)).toBe('');
        expect(formatWeekday(undefined)).toBe('');
        expect(formatWeekday('10/25/2026')).toBe('');
        expect(formatWeekday('2026-10')).toBe('');
        expect(formatWeekday('2026-1-5')).toBe('');
    });

    it('does not shift the day across the timezone boundary', () => {
        // new Date('2026-10-25') is UTC midnight, which is still the 24th in
        // the Americas; the weekday must come from the calendar parts.
        expect(formatWeekday('2026-10-25')).toBe('Sun');
        expect(formatWeekday('2026-01-01')).toBe('Thu');
    });
});
