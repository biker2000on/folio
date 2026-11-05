/**
 * Turns SimpleFin's raw sync-error text into something a person can act on.
 * Pure and client-safe.
 *
 * The stored error is `account: message` lines joined with newlines, where
 * `account` is usually the literal `all` and the bridge repeats a connection's
 * notice once per affected account (and per fetch chunk). Most of those lines
 * are the bridge saying one institution's login is being repaired on its side
 * ("Connection to X may need attention. We are upgrading this connection."),
 * which is not something Folio or the user can fix from here.
 */

export interface SimpleFinIssueSummary {
  /** Institutions the bridge reports a problem with, in first-seen order. */
  institutions: string[];
  /** Messages that are not per-institution bridge notices, deduplicated. */
  other: string[];
  /** Every distinct line, prefix stripped, for a collapsed raw view. */
  raw: string[];
}

const INSTITUTION_NOTICE = /^Connection to (.+?) may need attention\b/i;

export function summarizeSimpleFinIssues(text: string | null | undefined): SimpleFinIssueSummary {
  const raw: string[] = [];
  const institutions: string[] = [];
  const other: string[] = [];

  for (const line of (text ?? '').split('\n')) {
    const message = line.replace(/^\s*all:\s*/i, '').trim();
    if (!message || raw.includes(message)) continue;
    raw.push(message);
    const institution = INSTITUTION_NOTICE.exec(message)?.[1]?.trim();
    if (institution) {
      if (!institutions.includes(institution)) institutions.push(institution);
    } else {
      other.push(message);
    }
  }

  return { institutions, other, raw };
}

export type SimpleFinLinkState = 'linked' | 'stale' | 'unlinked' | 'ignored';

/**
 * - linked: mapped and returned by the latest refresh
 * - stale: mapped, but the bridge no longer returns it (closed, or re-keyed)
 * - unlinked: no book account and no decision yet
 * - ignored: deliberately not imported
 */
export function simpleFinLinkState(account: {
  isMapped: boolean;
  isLive: boolean;
  isIgnored?: boolean;
}): SimpleFinLinkState {
  if (account.isMapped) return account.isLive ? 'linked' : 'stale';
  return account.isIgnored ? 'ignored' : 'unlinked';
}
