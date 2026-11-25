import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  decryptAccessUrl,
  fetchAccounts,
  SimpleFinAccessRevokedError,
  SimpleFinDisabledError,
  type SimpleFinAccount,
} from '@/lib/services/simplefin.service';
import {
  isSimpleFinDateRangeWarning,
  recordSimpleFinFeedAccounts,
  updateSimpleFinConnectionSyncStatus,
} from '@/lib/services/simplefin-sync.service';
import { findRelinkPairs } from '@/lib/simplefin-relink';

/**
 * Rows written by the same bridge fetch share (within a sync's runtime) one
 * balance timestamp, so a row is "in the latest feed" when its balance date is
 * this close to the newest one on the connection.
 */
const FEED_SNAPSHOT_TOLERANCE_MS = 10 * 60 * 1000;

async function findConnection(userId: number, bookGuid: string) {
  return prisma.gnucash_web_simplefin_connections.findFirst({
    where: { user_id: userId, book_guid: bookGuid },
    select: { id: true, access_url_encrypted: true },
  });
}

/**
 * The connection's accounts as last recorded from the bridge — by a sync or an
 * explicit refresh. No request to SimpleFin: the bridge allows 24 per access
 * token per day, and this runs on every Connections page view.
 *
 * Liveness comes from the stored snapshot: a row is `isLive` when the latest
 * recorded fetch returned it. Mapped rows the feed has stopped returning are
 * what re-key pairing (and the page's "not returned since" note) work from.
 */
async function storedAccounts(
  connectionId: number,
  live?: Map<string, SimpleFinAccount>,
) {
  const mappings = await prisma.gnucash_web_simplefin_account_map.findMany({
    where: { connection_id: connectionId },
    select: {
      simplefin_account_id: true,
      simplefin_account_name: true,
      simplefin_institution: true,
      simplefin_last4: true,
      gnucash_account_guid: true,
      last_sync_at: true,
      is_investment: true,
      last_balance: true,
      last_balance_date: true,
      is_ignored: true,
    },
    orderBy: [
      { simplefin_institution: 'asc' },
      { simplefin_account_name: 'asc' },
      { simplefin_account_id: 'asc' },
    ],
  });

  const feedAt = mappings.reduce<Date | null>(
    (latest, m) => (m.last_balance_date && (!latest || m.last_balance_date > latest) ? m.last_balance_date : latest),
    null,
  );
  const inFeed = (date: Date | null) =>
    !!date && !!feedAt && feedAt.getTime() - date.getTime() <= FEED_SNAPSHOT_TOLERANCE_MS;

  const accounts = mappings.map(mapping => {
    const liveAccount = live?.get(mapping.simplefin_account_id);
    const isLive = live ? !!liveAccount : inFeed(mapping.last_balance_date);
    return {
      id: mapping.simplefin_account_id,
      name: mapping.simplefin_account_name || mapping.simplefin_account_id,
      institution: mapping.simplefin_institution,
      last4: mapping.simplefin_last4,
      currency: liveAccount?.currency ?? null,
      balance: liveAccount?.balance ?? (mapping.last_balance === null ? null : String(mapping.last_balance)),
      availableBalance: liveAccount?.['available-balance'] ?? null,
      lastBalanceDate: mapping.last_balance_date,
      gnucashAccountGuid: mapping.gnucash_account_guid,
      lastSyncAt: mapping.last_sync_at,
      isMapped: !!mapping.gnucash_account_guid,
      hasHoldings: Array.isArray(liveAccount?.holdings) && liveAccount.holdings.length > 0,
      isInvestment: mapping.is_investment,
      isIgnored: mapping.is_ignored,
      isLive,
      isStored: true,
      liveMissing: !isLive,
    };
  });

  return {
    accounts,
    feedAt,
    // Safe even when one institution is erroring: an outage hides accounts,
    // it never adds the unmapped same-named twin a pair needs.
    relinkPairs: feedAt || live ? findRelinkPairs(accounts) : [],
  };
}

// GET /api/simplefin/accounts -- stored SimpleFin accounts with mapping status
export async function GET() {
  try {
    const roleResult = await requireRole('readonly');
    if (roleResult instanceof NextResponse) return roleResult;

    const { user, bookGuid } = roleResult;
    const connection = await findConnection(user.id, bookGuid);
    if (!connection) {
      return NextResponse.json({ error: 'No SimpleFin connection found' }, { status: 404 });
    }

    const { accounts, feedAt, relinkPairs } = await storedAccounts(connection.id);
    return NextResponse.json({
      accounts,
      relinkPairs,
      // `live` means "liveness is known": a fetch has been recorded, so rows
      // it did not return can be marked as no longer returned.
      live: !!feedAt,
      feedAt,
      liveError: null,
    });
  } catch (error) {
    console.error('Error fetching SimpleFin accounts:', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

// POST /api/simplefin/accounts -- "Refresh from bank": one request to the
// bridge, recorded on the stored rows, then answered like GET.
export async function POST() {
  try {
    const roleResult = await requireRole('edit');
    if (roleResult instanceof NextResponse) return roleResult;

    const { user, bookGuid } = roleResult;
    const connection = await findConnection(user.id, bookGuid);
    if (!connection) {
      return NextResponse.json({ error: 'No SimpleFin connection found' }, { status: 404 });
    }

    try {
      const accessUrl = decryptAccessUrl(connection.access_url_encrypted);
      // No date range: accounts and balances only — one bridge request.
      const accountSet = await fetchAccounts(accessUrl);
      const simplefinWarnings = accountSet.errors.filter(isSimpleFinDateRangeWarning);
      // Institution notices stay in liveError: the page names the affected
      // banks from it. The bridge repeats a notice once per affected account.
      const simplefinErrors = [...new Set(accountSet.errors.filter(error => !isSimpleFinDateRangeWarning(error)))];

      await recordSimpleFinFeedAccounts(connection.id, accountSet.accounts);

      const live = new Map(accountSet.accounts.map(account => [account.id, account]));
      const { accounts, feedAt, relinkPairs } = await storedAccounts(connection.id, live);
      return NextResponse.json({
        accounts,
        relinkPairs,
        live: true,
        feedAt,
        liveError: simplefinErrors.length > 0 ? simplefinErrors.join('\n') : null,
        simplefinErrors,
        simplefinWarnings,
      });
    } catch (error) {
      const isRevoked = error instanceof SimpleFinAccessRevokedError;
      const message = error instanceof Error ? error.message : 'Failed to fetch accounts from SimpleFin';

      // A disabled server never reached the bridge — leave the (copied)
      // connection's status alone.
      if (!(error instanceof SimpleFinDisabledError)) {
        await updateSimpleFinConnectionSyncStatus(connection.id, isRevoked ? 'revoked' : 'failed', message);
      }

      const { accounts, feedAt, relinkPairs } = await storedAccounts(connection.id);
      return NextResponse.json({
        accounts,
        relinkPairs,
        live: false,
        feedAt,
        liveError: message,
        revoked: isRevoked,
      });
    }
  } catch (error) {
    console.error('Error refreshing SimpleFin accounts:', error);
    return NextResponse.json({ error: 'Failed to refresh accounts' }, { status: 500 });
  }
}
