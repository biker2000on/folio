/**
 * SimpleFin request-quota rules: interval parsing and the server kill-switch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIMPLEFIN_INTERVAL_HOURS,
  SIMPLEFIN_INTERVAL_OPTIONS,
  isSimpleFinDisabled,
  parseSimpleFinIntervalHours,
} from '../simplefin-quota';

describe('parseSimpleFinIntervalHours', () => {
  it('defaults to every 6 hours', () => {
    expect(DEFAULT_SIMPLEFIN_INTERVAL_HOURS).toBe(6);
    expect(parseSimpleFinIntervalHours(undefined)).toBe(6);
    expect(parseSimpleFinIntervalHours('')).toBe(6);
    expect(parseSimpleFinIntervalHours('garbage')).toBe(6);
  });

  it('keeps every offered option', () => {
    for (const hours of SIMPLEFIN_INTERVAL_OPTIONS) {
      expect(parseSimpleFinIntervalHours(String(hours))).toBe(hours);
      expect(parseSimpleFinIntervalHours(hours)).toBe(hours);
    }
  });

  it('moves the retired 1h/2h choices to the default', () => {
    // 2-hourly alone was 12 of the bridge's 24 daily requests.
    expect(parseSimpleFinIntervalHours('1')).toBe(6);
    expect(parseSimpleFinIntervalHours('2')).toBe(6);
  });

  it('never schedules more than 6 syncs a day', () => {
    expect(Math.min(...SIMPLEFIN_INTERVAL_OPTIONS)).toBeGreaterThanOrEqual(4);
  });
});

describe('isSimpleFinDisabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off unless SIMPLEFIN_DISABLED is set', () => {
    vi.stubEnv('SIMPLEFIN_DISABLED', '');
    expect(isSimpleFinDisabled()).toBe(false);
    vi.stubEnv('SIMPLEFIN_DISABLED', 'false');
    expect(isSimpleFinDisabled()).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes', ' true '])('is on for %j', (value) => {
    vi.stubEnv('SIMPLEFIN_DISABLED', value);
    expect(isSimpleFinDisabled()).toBe(true);
  });
});
