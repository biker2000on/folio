/**
 * SimpleFin request-quota rules — the scheduled-sync interval and the server
 * kill-switch, shared by the worker, the API routes and the settings UI.
 * Dependency-free and client-safe.
 *
 * SimpleFin Bridge allows 24 requests per access token per day, and it pulls
 * from the banks roughly once a day, so syncing more often than every few
 * hours spends the quota without bringing in anything new. Every request
 * counts: the scheduled syncs, the Sync button, "Run now" and the Connections
 * page's "Refresh from bank" all draw on the same 24.
 */

/** Hours between scheduled syncs, offered in the settings select. */
export const SIMPLEFIN_INTERVAL_OPTIONS = [4, 6, 12, 24] as const;

export const DEFAULT_SIMPLEFIN_INTERVAL_HOURS = 6;

/**
 * Parse the stored `simplefin_sync_interval_hours` preference. Anything that is
 * not one of the offered options — including the old 1h/2h choices, which
 * alone spent 12–24 of the day's 24 requests — falls back to the default.
 */
export function parseSimpleFinIntervalHours(raw: string | number | null | undefined): number {
  const hours = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  return (SIMPLEFIN_INTERVAL_OPTIONS as readonly number[]).includes(hours)
    ? hours
    : DEFAULT_SIMPLEFIN_INTERVAL_HOURS;
}

/**
 * Server kill-switch: `SIMPLEFIN_DISABLED=true` stops every request to the
 * bridge (no scheduled timers, no syncs, no account refreshes, no token
 * claims). Set it on any server running on a copy of the production database —
 * the copied access URL is the same credential, so a dev server's requests
 * count against production's 24-a-day quota.
 */
export function isSimpleFinDisabled(): boolean {
  const raw = process.env.SIMPLEFIN_DISABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}
