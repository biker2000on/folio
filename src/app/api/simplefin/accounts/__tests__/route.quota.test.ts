/**
 * The Connections page's account list, at the ROUTE level.
 *
 * SimpleFin Bridge allows 24 requests per access token per day. GET used to
 * fetch the live account list on every Connections page view; it now reads the
 * rows the last sync or refresh recorded, and only POST ("Refresh from bank")
 * contacts the bridge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, requireRoleMock, fetchAccountsMock, recordMock, statusMock } = vi.hoisted(() => ({
  prismaMock: {
    gnucash_web_simplefin_connections: { findFirst: vi.fn() },
    gnucash_web_simplefin_account_map: { findMany: vi.fn() },
  },
  requireRoleMock: vi.fn(),
  fetchAccountsMock: vi.fn(),
  recordMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }));
vi.mock('@/lib/services/simplefin.service', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/services/simplefin.service')>()),
  decryptAccessUrl: vi.fn(() => 'https://user:pass@bridge.example/simplefin'),
  fetchAccounts: (...args: unknown[]) => fetchAccountsMock(...args),
}));
vi.mock('@/lib/services/simplefin-sync.service', () => ({
  isNonFatalSimpleFinWarning: () => false,
  recordSimpleFinFeedAccounts: (...args: unknown[]) => recordMock(...args),
  updateSimpleFinConnectionSyncStatus: (...args: unknown[]) => statusMock(...args),
}));

import { GET, POST } from '../route';

const FEED_AT = new Date('2026-11-25T10:00:00Z');

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    simplefin_account_id: id,
    simplefin_account_name: 'Checking',
    simplefin_institution: 'Bank',
    simplefin_last4: null,
    gnucash_account_guid: null,
    last_sync_at: FEED_AT,
    is_investment: false,
    last_balance: 100,
    last_balance_date: FEED_AT,
    is_ignored: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: 1 }, bookGuid: 'book', role: 'admin' });
  prismaMock.gnucash_web_simplefin_connections.findFirst.mockResolvedValue({ id: 7, access_url_encrypted: 'x' });
});

describe('GET /api/simplefin/accounts', () => {
  it('answers from stored rows without contacting SimpleFin', async () => {
    prismaMock.gnucash_web_simplefin_account_map.findMany.mockResolvedValue([row('ACT-1')]);
    const res = await GET();
    const body = await res.json();
    expect(fetchAccountsMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
    expect(body.accounts).toHaveLength(1);
    expect(body.live).toBe(true);
  });

  it('derives liveness and re-key pairs from the latest recorded fetch', async () => {
    prismaMock.gnucash_web_simplefin_account_map.findMany.mockResolvedValue([
      // Mapped, last returned a month ago: the bank re-keyed it…
      row('ACT-OLD', { gnucash_account_guid: 'g1', last_balance_date: new Date('2026-10-25T10:00:00Z') }),
      // …and the same account came back unmapped under a new id.
      row('ACT-NEW'),
    ]);
    const body = await (await GET()).json();
    const byId = Object.fromEntries(body.accounts.map((a: { id: string; isLive: boolean }) => [a.id, a.isLive]));
    expect(byId).toEqual({ 'ACT-OLD': false, 'ACT-NEW': true });
    expect(body.relinkPairs).toEqual([{ fromId: 'ACT-OLD', toId: 'ACT-NEW' }]);
  });

  it('marks nothing stale before any fetch has been recorded', async () => {
    prismaMock.gnucash_web_simplefin_account_map.findMany.mockResolvedValue([
      row('ACT-1', { last_balance: null, last_balance_date: null }),
    ]);
    const body = await (await GET()).json();
    expect(body.live).toBe(false);
    expect(body.relinkPairs).toEqual([]);
  });
});

describe('POST /api/simplefin/accounts (Refresh from bank)', () => {
  it('makes one bridge request and records it on the stored rows', async () => {
    const feed = [{ id: 'ACT-1', name: 'Checking', currency: 'USD', balance: '250.00', 'available-balance': '200.00', org: { name: 'Bank' } }];
    fetchAccountsMock.mockResolvedValue({ errors: [], accounts: feed });
    prismaMock.gnucash_web_simplefin_account_map.findMany.mockResolvedValue([row('ACT-1')]);

    const body = await (await POST()).json();
    expect(fetchAccountsMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(7, feed);
    expect(body.accounts[0]).toMatchObject({ id: 'ACT-1', balance: '250.00', currency: 'USD', isLive: true });
  });
});
