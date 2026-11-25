import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {},
  generateGuid: vi.fn(() => '0'.repeat(32)),
}));

import {
  claimSetupToken,
  fetchAccounts,
  fetchAccountsChunked,
  SimpleFinAccessRevokedError,
  SimpleFinDisabledError,
} from '../simplefin.service';
import { isNonFatalSimpleFinWarning } from '../simplefin-sync.service';

describe('fetchAccounts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([401, 403])('throws access revoked for HTTP %s', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status,
      statusText: 'Unauthorized',
    } as Response);

    await expect(fetchAccounts('https://user:pass@example.com/access')).rejects.toBeInstanceOf(
      SimpleFinAccessRevokedError,
    );
  });
});

describe('SIMPLEFIN_DISABLED kill-switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never contacts the bridge for accounts, chunked syncs or token claims', async () => {
    vi.stubEnv('SIMPLEFIN_DISABLED', 'true');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(fetchAccounts('https://user:pass@example.com/access')).rejects.toBeInstanceOf(SimpleFinDisabledError);
    await expect(
      fetchAccountsChunked('https://user:pass@example.com/access', new Date('2026-01-01'), new Date('2026-01-20')),
    ).rejects.toBeInstanceOf(SimpleFinDisabledError);
    await expect(
      claimSetupToken(Buffer.from('https://example.com/claim').toString('base64')),
    ).rejects.toBeInstanceOf(SimpleFinDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes exactly one request for a sync window inside 60 days', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [], accounts: [] }),
    } as Response);
    const end = new Date('2026-11-25T12:00:00Z');
    const start = new Date(end.getTime() - 45 * 86_400_000);

    await fetchAccountsChunked('https://user:pass@example.com/access', start, end);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('isNonFatalSimpleFinWarning', () => {
  it('treats recommended date range messages as warnings', () => {
    expect(isNonFatalSimpleFinWarning(
      'Requested date range exceeds recommended range of 45 days. In the future, this may be capped.',
    )).toBe(true);
  });

  it('does not hide unrelated SimpleFin errors', () => {
    expect(isNonFatalSimpleFinWarning('Access has been revoked')).toBe(false);
  });
});
