import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { SYNC_OVERLAP_DAYS } from '@/lib/services/simplefin-sync.service';

class RelinkRejected extends Error {}

interface RelinkRequestPair {
  fromId?: unknown;
  toId?: unknown;
}

function sameAccountIdentity(
  a: { simplefin_account_name: string | null; simplefin_institution: string | null },
  b: { simplefin_account_name: string | null; simplefin_institution: string | null },
): boolean {
  const norm = (v: string | null) => v?.trim().toLowerCase() || null;
  return !!norm(a.simplefin_account_name)
    && norm(a.simplefin_account_name) === norm(b.simplefin_account_name)
    && !!norm(a.simplefin_institution)
    && norm(a.simplefin_institution) === norm(b.simplefin_institution);
}

// POST /api/simplefin/accounts/relink -- move mappings from re-keyed accounts
//
// The new row inherits the old row's book account, investment flag and sync
// cursor, and records which id it replaced (see runSimpleFinSync's re-key
// pass). The old row is deleted: its id will never be returned again, and a
// mapped row the feed no longer returns would pin the fetch window forever.
export async function POST(request: NextRequest) {
  try {
    const roleResult = await requireRole('admin');
    if (roleResult instanceof NextResponse) return roleResult;

    const { user, bookGuid } = roleResult;
    const { pairs } = await request.json() as { pairs?: RelinkRequestPair[] };

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return NextResponse.json({ error: 'pairs must be a non-empty array' }, { status: 400 });
    }

    const connection = await prisma.gnucash_web_simplefin_connections.findFirst({
      where: { user_id: user.id, book_guid: bookGuid },
      select: { id: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'No SimpleFin connection found' }, { status: 404 });
    }

    const ids = pairs.flatMap(p => [p.fromId, p.toId]).filter((v): v is string => typeof v === 'string');
    if (ids.length !== pairs.length * 2 || new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'Each pair needs a distinct fromId and toId' }, { status: 400 });
    }

    const relinked = await prisma.$transaction(async (tx) => {
      const rows = await tx.gnucash_web_simplefin_account_map.findMany({
        where: { connection_id: connection.id, simplefin_account_id: { in: ids } },
      });
      const byId = new Map(rows.map(row => [row.simplefin_account_id, row]));
      const now = new Date();

      for (const pair of pairs as Array<{ fromId: string; toId: string }>) {
        const from = byId.get(pair.fromId);
        const to = byId.get(pair.toId);
        if (!from || !to) {
          throw new RelinkRejected(`Unknown SimpleFin account in pair ${pair.fromId} → ${pair.toId}`);
        }
        if (!from.gnucash_account_guid) {
          throw new RelinkRejected(`${from.simplefin_account_name ?? pair.fromId} has no book account to carry over`);
        }
        if (to.gnucash_account_guid) {
          throw new RelinkRejected(`${to.simplefin_account_name ?? pair.toId} is already mapped`);
        }
        if (!sameAccountIdentity(from, to)) {
          throw new RelinkRejected(`${pair.fromId} and ${pair.toId} are not the same bank account`);
        }

        await tx.gnucash_web_simplefin_account_map.update({
          where: { id: to.id },
          data: {
            gnucash_account_guid: from.gnucash_account_guid,
            is_investment: from.is_investment,
            simplefin_last4: to.simplefin_last4 ?? from.simplefin_last4,
            last_sync_at: from.last_sync_at,
            relinked_from: from.simplefin_account_id,
            relinked_at: now,
            relink_floor: new Date(
              (from.last_sync_at ?? now).getTime() - SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000,
            ),
          },
        });
        await tx.gnucash_web_simplefin_account_map.delete({ where: { id: from.id } });
      }
      return pairs.length;
    });

    return NextResponse.json({ success: true, relinked });
  } catch (error) {
    if (error instanceof RelinkRejected) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error relinking SimpleFin accounts:', error);
    return NextResponse.json({ error: 'Failed to relink accounts' }, { status: 500 });
  }
}
