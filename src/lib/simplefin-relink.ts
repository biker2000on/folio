/**
 * SimpleFin re-key detection.
 *
 * When an institution is removed and re-added on SimpleFin Bridge (to fix a
 * broken login, or after the bridge "upgrades" a connection), every account
 * under it comes back with a NEW `ACT-…` id, and its transactions come back
 * with new `TRN-…` ids. The stored mapping is keyed on the old id, so the
 * accounts show up as unmapped twins of rows that are still mapped but no
 * longer returned.
 *
 * This module pairs each orphaned mapped row with its re-keyed twin. Pure and
 * client-safe: the accounts route attaches the pairs to its response and the
 * relink route re-derives them before writing, so a client can never relink
 * a pair the server would not have proposed.
 */

export interface RelinkAccountInput {
  id: string;
  name: string | null;
  institution: string | null;
  gnucashAccountGuid: string | null;
  /** Returned by the latest live SimpleFin fetch. */
  isLive: boolean;
}

export interface RelinkPair {
  fromId: string;
  toId: string;
}

function relinkKey(account: RelinkAccountInput): string | null {
  const name = account.name?.trim().toLowerCase();
  const institution = account.institution?.trim().toLowerCase();
  if (!name || !institution) return null;
  return `${institution}\u0000${name}`;
}

/**
 * Pairs a mapped account that the live feed no longer returns with an
 * unmapped live account of the same institution and name.
 *
 * Only one-to-one keys pair: two orphans or two new accounts under the same
 * institution + name (e.g. two "Savings Account" rows without a last-4 suffix)
 * are ambiguous, and a wrong guess would route one bank's transactions into
 * another book account, so those are left for the user to map by hand.
 */
export function findRelinkPairs(accounts: RelinkAccountInput[]): RelinkPair[] {
  const orphans = new Map<string, RelinkAccountInput[]>();
  const fresh = new Map<string, RelinkAccountInput[]>();

  for (const account of accounts) {
    const key = relinkKey(account);
    if (!key) continue;
    if (!account.isLive && account.gnucashAccountGuid) {
      orphans.set(key, [...(orphans.get(key) ?? []), account]);
    } else if (account.isLive && !account.gnucashAccountGuid) {
      fresh.set(key, [...(fresh.get(key) ?? []), account]);
    }
  }

  const pairs: RelinkPair[] = [];
  for (const [key, from] of orphans) {
    const to = fresh.get(key);
    if (from.length === 1 && to?.length === 1) {
      pairs.push({ fromId: from[0].id, toId: to[0].id });
    }
  }
  return pairs;
}
