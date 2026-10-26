import { describe, expect, it } from 'vitest';
import { completeYear, parseDateInput } from '../date-format';

// A fixed "today" so the short forms are deterministic: Sunday 2026-10-25.
const TODAY = new Date(2026, 9, 25, 12);

describe('parseDateInput — full forms', () => {
    it('accepts ISO, slash and dash forms with 4- or 2-digit years', () => {
        expect(parseDateInput('2026-10-05')).toBe('2026-10-05');
        expect(parseDateInput('10/5/2026')).toBe('2026-10-05');
        expect(parseDateInput('10/5/26')).toBe('2026-10-05');
        expect(parseDateInput('10-5-2026')).toBe('2026-10-05');
        expect(parseDateInput(' 10/05/2026 ')).toBe('2026-10-05');
    });

    it('rejects impossible dates', () => {
        expect(parseDateInput('13/1/2026')).toBeNull();
        expect(parseDateInput('2/30/2026')).toBeNull();
        expect(parseDateInput('2/29/2024')).toBe('2024-02-29');
        expect(parseDateInput('2/29/2025')).toBeNull();
    });
});

describe('parseDateInput — GnuCash short forms', () => {
    it('"10/5" is October 5, with the year from the sliding window', () => {
        expect(parseDateInput('10/5', TODAY)).toBe('2026-10-05');
        expect(parseDateInput('12/31', TODAY)).toBe('2026-12-31');
        // Late October: January through March are nearer ahead than behind.
        expect(parseDateInput('1/1', TODAY)).toBe('2027-01-01');
        expect(parseDateInput('3/15', TODAY)).toBe('2027-03-15');
        expect(parseDateInput('4/15', TODAY)).toBe('2026-04-15');
    });

    it('"12/31" typed in January is last December (GnuCash sliding completion)', () => {
        const january = new Date(2027, 0, 10);
        expect(parseDateInput('12/31', january)).toBe('2026-12-31');
        expect(parseDateInput('7/4', january)).toBe('2026-07-04');
        expect(parseDateInput('6/30', january)).toBe('2027-06-30');
        expect(parseDateInput('1/5', january)).toBe('2027-01-05');
    });

    it('completeYear matches qof_scan_date_internal with 6 back months', () => {
        // year = now_year - floor((month - now_month + 6) / 12)
        const june = new Date(2026, 5, 15);
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => completeYear(m, june)))
            .toEqual([2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2025]);
        const january = new Date(2027, 0, 1);
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => completeYear(m, january)))
            .toEqual([2027, 2027, 2027, 2027, 2027, 2027, 2026, 2026, 2026, 2026, 2026, 2026]);
        // A different window: 0 back months means "this year or ahead".
        expect(completeYear(12, january, 0)).toBe(2027);
        expect(completeYear(12, january, 11)).toBe(2026);
    });

    it('also takes dash and dot separators', () => {
        expect(parseDateInput('10-5', TODAY)).toBe('2026-10-05');
        expect(parseDateInput('10.5', TODAY)).toBe('2026-10-05');
    });

    it('a bare day is that day of the current month', () => {
        expect(parseDateInput('5', TODAY)).toBe('2026-10-05');
        expect(parseDateInput('31', TODAY)).toBe('2026-10-31');
        expect(parseDateInput('05', TODAY)).toBe('2026-10-05');
    });

    it('validates the short forms against the inferred month and year', () => {
        expect(parseDateInput('2/30', TODAY)).toBeNull();
        expect(parseDateInput('2/29', new Date(2028, 9, 1))).toBeNull(); // completes to 2029, not a leap year
        expect(parseDateInput('2/29', new Date(2027, 9, 1))).toBe('2028-02-29');
        expect(parseDateInput('0/5', TODAY)).toBeNull();
        expect(parseDateInput('10/0', TODAY)).toBeNull();
        expect(parseDateInput('32', TODAY)).toBeNull();
        expect(parseDateInput('31', new Date(2026, 8, 15))).toBeNull(); // September has 30 days
        expect(parseDateInput('0', TODAY)).toBeNull();
    });

    it('defaults the reference date to today', () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        expect(parseDateInput('3/4')).toBe(`${completeYear(3, now)}-03-04`);
        expect(parseDateInput('1')).toBe(`${y}-${m}-01`);
    });

    it('still rejects junk', () => {
        expect(parseDateInput('')).toBeNull();
        expect(parseDateInput('abc')).toBeNull();
        expect(parseDateInput('10/5/')).toBeNull();
        expect(parseDateInput('10/5/2026/1')).toBeNull();
        expect(parseDateInput('123')).toBeNull();
    });
});
