import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/lib/receipts', () => ({ linkReceipt: vi.fn(), updateExtractedData: vi.fn() }));

import {
  chooseAutoMatch,
  type AutoMatchCandidate,
  type AutoMatchReceipt,
} from '../receipt-auto-match';

function receipt(overrides: Partial<AutoMatchReceipt> = {}): AutoMatchReceipt {
  return {
    id: 1,
    amounts: [46.55],
    date: '2026-10-02',
    vendor: 'Caldwell County Utilities',
    utilityType: 'water',
    dismissedGuids: [],
    ...overrides,
  };
}

function candidate(
  guid: string,
  postDate: string,
  amount: number,
  description: string,
  accountPath = 'Expenses:Utilities:Water',
): AutoMatchCandidate {
  return {
    guid,
    description,
    postDate,
    amounts: [amount, amount],
    accounts: [{ guid: `acct-${accountPath}`, path: accountPath }],
  };
}

describe('chooseAutoMatch: utility bills', () => {
  it('links the one payment for the bill amount booked to a utility account', () => {
    const decision = chooseAutoMatch(receipt(), [
      candidate('pay', '2026-10-21', 46.55, 'CALDWELL COUNTY UTILITY~ Future Amount: 46.55 ~ Tran: ACHDW'),
      candidate('other', '2026-10-21', 82.1, 'DUKEENERGY BILL PAY', 'Expenses:Utilities:Electric'),
    ]);
    expect(decision).toEqual({ guid: 'pay', reason: 'utility-account' });
  });

  it('uses an account this utility type was paid from before, whatever it is called', () => {
    const decision = chooseAutoMatch(
      receipt({ utilityType: 'propane', vendor: 'Blossman Gas', amounts: [311.4] }),
      [candidate('pay', '2026-10-15', 311.4, 'ACH DEBIT 99812', 'Expenses:Home:Heat')],
      { knownUtilityAccounts: new Set(['acct-Expenses:Home:Heat']) },
    );
    expect(decision).toEqual({ guid: 'pay', reason: 'utility-account' });
  });

  it('falls back to the provider name when the account says nothing', () => {
    const decision = chooseAutoMatch(receipt({ vendor: 'Caldwell County' }), [
      candidate('pay', '2026-10-21', 46.55, 'Caldwell County Utility', 'Expenses:Household'),
      candidate('coincidence', '2026-10-09', 46.55, 'Food Lion', 'Expenses:Groceries'),
    ]);
    expect(decision).toEqual({ guid: 'pay', reason: 'utility-vendor' });
  });

  it('leaves two same-amount utility payments for a person to choose', () => {
    const decision = chooseAutoMatch(receipt(), [
      candidate('sept', '2026-09-28', 46.55, 'CALDWELL COUNTY UTILITY'),
      candidate('oct', '2026-10-21', 46.55, 'CALDWELL COUNTY UTILITY'),
    ]);
    expect(decision).toBeNull();
  });

  it('ignores payments outside the bill-to-payment window and off by a cent', () => {
    expect(chooseAutoMatch(receipt(), [
      candidate('early', '2026-09-20', 46.55, 'CALDWELL COUNTY UTILITY'),
      candidate('late', '2026-11-25', 46.55, 'CALDWELL COUNTY UTILITY'),
      candidate('near', '2026-10-21', 46.56, 'CALDWELL COUNTY UTILITY'),
    ])).toBeNull();
  });

  it('matches the bill total when the amount due differs', () => {
    const decision = chooseAutoMatch(receipt({ amounts: [40, 46.55] }), [
      candidate('pay', '2026-10-21', 46.55, 'CALDWELL COUNTY UTILITY'),
    ]);
    expect(decision?.guid).toBe('pay');
  });

  it('never proposes a transaction the user already rejected', () => {
    expect(chooseAutoMatch(receipt({ dismissedGuids: ['pay'] }), [
      candidate('pay', '2026-10-21', 46.55, 'CALDWELL COUNTY UTILITY'),
    ])).toBeNull();
  });
});

describe('chooseAutoMatch: ordinary receipts', () => {
  const store = receipt({ utilityType: null, vendor: 'Rural King', amounts: [266.59], date: '2026-07-21' });

  it('links on exact amount, vendor and a date within three days', () => {
    expect(chooseAutoMatch(store, [
      candidate('pay', '2026-07-22', 266.59, 'RURAL KING #88 LENOIR NC', 'Expenses:Farm:Supplies'),
    ])).toEqual({ guid: 'pay', reason: 'vendor-date' });
  });

  it('does not link on amount alone', () => {
    expect(chooseAutoMatch(store, [
      candidate('pay', '2026-07-22', 266.59, 'TRACTOR SUPPLY 4410', 'Expenses:Farm:Supplies'),
    ])).toBeNull();
  });

  it('does not use the long utility window', () => {
    expect(chooseAutoMatch(store, [
      candidate('pay', '2026-08-10', 266.59, 'RURAL KING #88 LENOIR NC', 'Expenses:Farm:Supplies'),
    ])).toBeNull();
  });

  it('needs a date and an amount', () => {
    expect(chooseAutoMatch({ ...store, date: null }, [
      candidate('pay', '2026-07-22', 266.59, 'RURAL KING', 'Expenses:Farm'),
    ])).toBeNull();
    expect(chooseAutoMatch({ ...store, amounts: [] }, [
      candidate('pay', '2026-07-22', 266.59, 'RURAL KING', 'Expenses:Farm'),
    ])).toBeNull();
  });
});
