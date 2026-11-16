import { describe, expect, it } from 'vitest';
import {
    balanceRange,
    dayBefore,
    displaySignFor,
    isAccountGuid,
    periodRange,
    previousPeriodRange,
} from '../drill-ranges';

describe('drill ranges', () => {
    it('describes a period with both ends inclusive', () => {
        expect(periodRange('2026-01-01', '2026-11-16')).toEqual({
            mode: 'period',
            startDate: '2026-01-01',
            endDate: '2026-11-16',
            label: 'Jan 1, 2026 to Nov 16, 2026',
        });
    });

    it('lists a balance from the report start when given one', () => {
        expect(balanceRange('2026-11-16', '2026-01-01')).toMatchObject({
            mode: 'balance',
            startDate: '2026-01-01',
            endDate: '2026-11-16',
            label: 'Balance at Nov 16, 2026',
        });
    });

    it('lists a balance from Jan 1 of its year when there is no usable start', () => {
        expect(balanceRange('2025-12-31').startDate).toBe('2025-01-01');
        // A start after the as-of date is ignored rather than producing an empty range.
        expect(balanceRange('2026-03-31', '2026-06-01').startDate).toBe('2026-01-01');
    });

    it('steps back one day across a year boundary', () => {
        expect(dayBefore('2026-01-01')).toBe('2025-12-31');
        expect(dayBefore('2024-03-01')).toBe('2024-02-29');
    });

    it('matches the income statement comparison period', () => {
        // generateIncomeStatement: previous start = start - (end - start), previous end = start - 1ms.
        expect(previousPeriodRange('2026-01-01', '2026-12-31')).toMatchObject({
            startDate: '2025-01-01',
            endDate: '2025-12-31',
        });
        expect(previousPeriodRange('2026-07-01', '2026-07-31')).toMatchObject({
            startDate: '2026-05-31',
            endDate: '2026-06-30',
        });
    });

    it('recognises real account guids and rejects synthetic rows', () => {
        expect(isAccountGuid('29b4d6e7c3fd789d5522559671e936a7')).toBe(true);
        expect(isAccountGuid('synthetic-retained-earnings')).toBe(false);
        expect(isAccountGuid('net-income')).toBe(false);
    });
});

describe('displaySignFor', () => {
    it('flips rows when the report shows the figure negated', () => {
        // A credit card owing $1,200 is -1200 in the ledger and 1200 on the balance sheet.
        expect(displaySignFor(-1200, 1200)).toBe(-1);
        expect(displaySignFor(-1199.5, 1200)).toBe(-1);
    });

    it('leaves rows alone when the signs already agree', () => {
        expect(displaySignFor(500, 500)).toBe(1);
        expect(displaySignFor(-80, -75)).toBe(1);
    });

    it('does not flip when the sizes differ, so a real mismatch stays visible', () => {
        expect(displaySignFor(-300, 1200)).toBe(1);
    });

    it('leaves rows alone without a figure to match', () => {
        expect(displaySignFor(-300, undefined)).toBe(1);
        expect(displaySignFor(0, 100)).toBe(1);
        expect(displaySignFor(100, 0)).toBe(1);
    });
});
