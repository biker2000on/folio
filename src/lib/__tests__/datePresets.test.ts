import { describe, it, expect, vi, afterEach } from 'vitest';
import { DATE_PRESETS, generatePeriods } from '@/lib/datePresets';

describe('generatePeriods', () => {
  it('generates monthly periods across a full year', () => {
    const start = new Date('2026-01-01T00:00:00');
    const end = new Date('2026-12-31T23:59:59');
    const periods = generatePeriods(start, end, 'month');
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({
      label: 'Jan 2026',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(periods[11]).toMatchObject({
      label: 'Dec 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
  });

  it('generates quarterly periods labeled Q1..Q4', () => {
    const start = new Date('2026-01-01T00:00:00');
    const end = new Date('2026-12-31T23:59:59');
    const periods = generatePeriods(start, end, 'quarter');
    expect(periods).toHaveLength(4);
    expect(periods.map(p => p.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    expect(periods[0]).toMatchObject({ startDate: '2026-01-01', endDate: '2026-03-31' });
    expect(periods[2]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-09-30' });
  });

  it('generates yearly periods spanning multiple calendar years', () => {
    const start = new Date('2024-06-15T00:00:00');
    const end = new Date('2026-04-15T23:59:59');
    const periods = generatePeriods(start, end, 'year');
    expect(periods.map(p => p.label)).toEqual(['2024', '2025', '2026']);
    // Should snap to calendar boundaries
    expect(periods[0].startDate).toBe('2024-01-01');
    expect(periods[0].endDate).toBe('2024-12-31');
    expect(periods[2].startDate).toBe('2026-01-01');
  });

  it('expands a mid-month start to the full starting month for monthly grouping', () => {
    const start = new Date('2026-04-10T00:00:00');
    const end = new Date('2026-06-20T23:59:59');
    const periods = generatePeriods(start, end, 'month');
    expect(periods.map(p => p.label)).toEqual(['Apr 2026', 'May 2026', 'Jun 2026']);
    expect(periods[0].startDate).toBe('2026-04-01');
  });
});

describe('DATE_PRESETS', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('offers trailing 2, 3 and 5 year windows ending today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00'));
    const byShort = new Map(DATE_PRESETS.map(p => [p.short, p]));
    expect(byShort.get('2Y')?.getValue()).toEqual({ startDate: '2024-11-03', endDate: '2026-11-02' });
    expect(byShort.get('3Y')?.getValue()).toEqual({ startDate: '2023-11-03', endDate: '2026-11-02' });
    expect(byShort.get('5Y')?.getValue()).toEqual({ startDate: '2021-11-03', endDate: '2026-11-02' });
    expect(byShort.get('5Y')?.label).toBe('Last 5 Years');
  });

  it('gives every preset a unique compact label', () => {
    const shorts = DATE_PRESETS.map(p => p.short);
    expect(new Set(shorts).size).toBe(shorts.length);
    expect(shorts.every(s => s.length > 0 && s.length <= 4)).toBe(true);
  });
});
