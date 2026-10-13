/**
 * What the Settings → Atlas page shows about the Atlas sync (formerly
 * beez-trackz; the wire contract and its `beez-trackz` link source are
 * unchanged — see src/lib/integrations/beez.ts).
 *
 * Read-only and session-scoped: the active book's linked-transaction count,
 * the last time Atlas created or changed a link, deletions Atlas has not yet
 * acknowledged, and the caller's API tokens for this book (Atlas
 * authenticates with one of them).
 */
import prisma from '@/lib/prisma';
import { listTokens } from '@/lib/api-tokens';
import { BEEZ_SOURCE } from '@/lib/integrations/beez';

export interface AtlasToken {
  id: number;
  name: string;
  prefix: string;
  role: 'readonly' | 'edit';
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface AtlasStatus {
  /** Transactions in this book currently linked to an Atlas record. */
  linkedTransactions: number;
  /** Links whose transaction was deleted in Folio and Atlas has not yet acknowledged. */
  pendingDeletions: number;
  /** Last time a link was created or rewritten (ISO), null when never. */
  lastActivityAt: string | null;
  /** Most recent use of any of this book's tokens by anything (ISO). */
  lastTokenUseAt: string | null;
  tokens: AtlasToken[];
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

export async function getAtlasStatus(userId: number, bookGuid: string): Promise<AtlasStatus> {
  const [links, tokens] = await Promise.all([
    prisma.$queryRaw<Array<{ linked: bigint; pending: bigint; last_activity: Date | null }>>`
      SELECT
        count(*) FILTER (WHERE t.guid IS NOT NULL) AS linked,
        count(*) FILTER (WHERE t.guid IS NULL) AS pending,
        max(l.updated_at) AS last_activity
      FROM gnucash_web_external_links l
      LEFT JOIN transactions t ON t.guid = l.entity_guid
      WHERE l.book_guid = ${bookGuid}
        AND l.source = ${BEEZ_SOURCE}
        AND l.entity_type = 'transaction'
    `.catch(() => [] as Array<{ linked: bigint; pending: bigint; last_activity: Date | null }>),
    listTokens(userId),
  ]);

  const bookTokens = tokens
    .filter((token) => token.bookGuid === bookGuid)
    .map<AtlasToken>((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      role: token.role,
      lastUsedAt: iso(token.lastUsedAt),
      createdAt: iso(token.createdAt)!,
      expiresAt: iso(token.expiresAt),
    }));

  const lastTokenUse = bookTokens
    .map((token) => token.lastUsedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .pop() ?? null;

  const row = links[0];
  return {
    linkedTransactions: Number(row?.linked ?? 0),
    pendingDeletions: Number(row?.pending ?? 0),
    lastActivityAt: iso(row?.last_activity),
    lastTokenUseAt: lastTokenUse,
    tokens: bookTokens,
  };
}
