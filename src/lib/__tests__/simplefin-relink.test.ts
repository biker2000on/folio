import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {},
  generateGuid: vi.fn(() => '0'.repeat(32)),
}));

import { findRelinkPairs, type RelinkAccountInput } from '../simplefin-relink';
import { staleSimpleFinIdColumn } from '../services/simplefin-sync.service';

function account(overrides: Partial<RelinkAccountInput> & { id: string }): RelinkAccountInput {
  return {
    name: 'Spending Account (5130)',
    institution: 'Ally Bank Justin',
    gnucashAccountGuid: null,
    isLive: true,
    ...overrides,
  };
}

describe('findRelinkPairs', () => {
  it('pairs a mapped account the feed dropped with its unmapped re-keyed twin', () => {
    const pairs = findRelinkPairs([
      account({ id: 'ACT-old', isLive: false, gnucashAccountGuid: 'a'.repeat(32) }),
      account({ id: 'ACT-new' }),
    ]);
    expect(pairs).toEqual([{ fromId: 'ACT-old', toId: 'ACT-new' }]);
  });

  it('matches institution and name case- and whitespace-insensitively', () => {
    const pairs = findRelinkPairs([
      account({ id: 'ACT-old', isLive: false, gnucashAccountGuid: 'a'.repeat(32), institution: ' ally bank justin ' }),
      account({ id: 'ACT-new', name: 'SPENDING ACCOUNT (5130)' }),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('never pairs across institutions, even with identical account names', () => {
    // Two Ally logins expose the same joint account under different labels.
    const pairs = findRelinkPairs([
      account({ id: 'ACT-old', isLive: false, gnucashAccountGuid: 'a'.repeat(32), institution: 'Ally Bank Justin' }),
      account({ id: 'ACT-new', institution: 'Ally Bank Cara' }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('leaves ambiguous keys for the user to map by hand', () => {
    const pairs = findRelinkPairs([
      account({ id: 'ACT-old', isLive: false, gnucashAccountGuid: 'a'.repeat(32), name: 'Savings' }),
      account({ id: 'ACT-new-1', name: 'Savings' }),
      account({ id: 'ACT-new-2', name: 'Savings' }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('ignores live mapped accounts, unmapped orphans and rows without a name', () => {
    const pairs = findRelinkPairs([
      account({ id: 'ACT-live-mapped', gnucashAccountGuid: 'a'.repeat(32) }),
      account({ id: 'ACT-orphan-unmapped', isLive: false, name: 'Joint (1178)' }),
      account({ id: 'ACT-new', name: 'Joint (1178)' }),
      account({ id: 'ACT-nameless-old', isLive: false, gnucashAccountGuid: 'b'.repeat(32), name: null }),
      account({ id: 'ACT-nameless-new', name: null }),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe('staleSimpleFinIdColumn', () => {
  const live = new Set(['TRN-live']);

  it('re-keys the primary id when the bridge no longer returns it', () => {
    expect(staleSimpleFinIdColumn(
      { simplefin_transaction_id: 'TRN-old', simplefin_transaction_id_2: null },
      live,
    )).toBe('simplefin_transaction_id');
  });

  it("leaves the other side's live id alone on a two-legged transfer", () => {
    expect(staleSimpleFinIdColumn(
      { simplefin_transaction_id: 'TRN-live', simplefin_transaction_id_2: 'TRN-old' },
      live,
    )).toBe('simplefin_transaction_id_2');
  });

  it('is not a candidate when every id is still live', () => {
    expect(staleSimpleFinIdColumn(
      { simplefin_transaction_id: 'TRN-live', simplefin_transaction_id_2: null },
      live,
    )).toBeNull();
  });
});
