import { describe, expect, it } from 'vitest';
import {
    axisMoney,
    axisPeriod,
    clipFuturePeriods,
    currentPeriodKey,
    longPeriod,
    periodKind,
    signedMoney,
    signedPercent,
} from '../chart-format';

describe('axisMoney', () => {
    it('leads with the sign and never rounds a step into a different number', () => {
        expect(axisMoney(-5000)).toBe('-$5K');
        expect(axisMoney(10000)).toBe('$10K');
        expect(axisMoney(1450000)).toBe('$1.45M');
        expect(axisMoney(999500)).toBe('$999.5K');
        expect(axisMoney(0)).toBe('$0');
        expect(axisMoney(-0.4)).toBe('$0');
    });
});

describe('signed figures', () => {
    it('writes a signed change with the sign first', () => {
        expect(signedMoney(12300.4)).toBe('+$12,300');
        expect(signedMoney(-4100)).toBe('-$4,100');
        expect(signedMoney(0.2)).toBe('$0');
        expect(signedPercent(10.86)).toBe('+10.9%');
        expect(signedPercent(-3)).toBe('-3.0%');
        expect(signedPercent(Number.NaN)).toBe('');
    });
});

describe('periods', () => {
    it('recognises the three period keys', () => {
        expect(periodKind('2026-03')).toBe('month');
        expect(periodKind('2026-Q1')).toBe('quarter');
        expect(periodKind('2026')).toBe('year');
    });

    it('puts the year on January and on the first tick only', () => {
        expect(axisPeriod('2026-01', 3)).toBe("Jan '26");
        expect(axisPeriod('2026-03', 0)).toBe("Mar '26");
        expect(axisPeriod('2026-03', 2)).toBe('Mar');
        expect(axisPeriod('2026-Q2')).toBe("Q2 '26");
        expect(axisPeriod('2026')).toBe('2026');
    });

    it('writes tooltip headings in full', () => {
        expect(longPeriod('2026-03')).toBe('March 2026');
        expect(longPeriod('2026-Q1')).toBe('Q1 2026');
        expect(longPeriod('2026')).toBe('2026');
    });

    it('finds the current period in the same form as the data', () => {
        expect(currentPeriodKey('2026-01', '2026-11-17')).toBe('2026-11');
        expect(currentPeriodKey('2026-Q1', '2026-11-17')).toBe('2026-Q4');
        expect(currentPeriodKey('2025', '2026-11-17')).toBe('2026');
    });

    it('drops periods that have not happened yet', () => {
        const rows = ['2026-10', '2026-11', '2026-12'].map(month => ({ month }));
        expect(clipFuturePeriods(rows, '2026-11-17').map(row => row.month)).toEqual(['2026-10', '2026-11']);
        const quarters = ['2026-Q3', '2026-Q4', '2027-Q1'].map(month => ({ month }));
        expect(clipFuturePeriods(quarters, '2026-11-17').map(row => row.month)).toEqual(['2026-Q3', '2026-Q4']);
        expect(clipFuturePeriods([], '2026-11-17')).toEqual([]);
    });
});
