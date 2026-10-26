'use client';

/**
 * Data-change client bus.
 *
 * One EventSource to /api/data-events/stream per app instance relays
 * server-side data-change events for the active book (published by mutating
 * API routes via src/lib/data-events.ts). On each event burst it:
 *   (a) invalidates the matching React Query caches, and
 *   (b) re-dispatches a `gnucash:data-change` window CustomEvent so
 *       non-React-Query pages (AccountLedger, TransactionJournal, budgets,
 *       scheduled transactions) can refetch, matching the repo's CustomEvent
 *       bus convention (see JobProgressContext).
 *
 * Bursts are coalesced per entity (500ms) so a bulk operation emitting many
 * events triggers one refetch. Reconnects with exponential backoff when the
 * stream drops (same shape as JobProgressContext's SSE consumer).
 *
 * Perf gating:
 *   - Hidden tabs never refetch: while `document.visibilityState !== 'visible'`
 *     incoming events only accumulate in the pending set; when the tab becomes
 *     visible again the union is flushed once.
 *   - Self-echo suppression: pages that mutate data and refetch themselves call
 *     `suppressNextDataEvent(entity)` on mutation success, which drops this
 *     tab's own relayed event for a short window (other tabs still refetch).
 *
 * Mounted inside the authenticated shell (Layout.tsx) — renders nothing.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

export type DataChangeEntity =
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'schedules'
  | 'reconciliation'
  | 'prices'
  | 'business'
  | 'payslips'
  | 'book';

export interface DataChangeEventPayload {
  entity: DataChangeEntity;
  bookGuid: string;
  guid?: string;
  action?: 'create' | 'update' | 'delete' | 'bulk';
  ts: string;
}

/** Window event name pages subscribe to (detail: DataChangeEventPayload). */
export const DATA_CHANGE_EVENT = 'gnucash:data-change';

const DEBOUNCE_MS = 500;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

/** How long (ms) a page's own mutation suppresses this tab's echo per entity. */
export const SUPPRESS_ECHO_MS = 1_500;

// Per-tab echo suppression: entity -> epoch ms until which incoming
// data-change events for that entity are treated as this tab's own echo and
// dropped. Module-level so pages can mark it without a React context.
const suppressedUntil = new Map<DataChangeEntity, number>();

/**
 * Call from a mutation success handler right before (or after) the page's own
 * refetch. The data-change event the server publishes for that mutation will
 * be relayed back to this tab too; suppressing it avoids a duplicate refetch.
 * Only affects this tab — other tabs/sessions still receive the event.
 */
export function suppressNextDataEvent(entity: DataChangeEntity): void {
  suppressedUntil.set(entity, Date.now() + SUPPRESS_ECHO_MS);
}

/** Clear all pending echo-suppression windows (used by tests / book switch). */
export function clearEchoSuppression(): void {
  suppressedUntil.clear();
}

function isEchoSuppressed(entity: DataChangeEntity): boolean {
  const until = suppressedUntil.get(entity);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    suppressedUntil.delete(entity);
    return false;
  }
  return true;
}

/**
 * Query keys a 'book' event (import/overwrite/book delete) invalidates.
 * Deliberately a scoped known-key list instead of an unfiltered
 * `invalidateQueries()` so a book-level event doesn't refetch every cached
 * query in the app.
 */
const BOOK_SCOPED_QUERY_KEYS: readonly (readonly string[])[] = [
  ['accounts', 'hierarchy'],
  ['accounts', 'balances'],
  ['accounts', 'reconcile-summary'],
  ['accounts', 'review-status'],
  ['tags'],
];

export function DataEventsProvider() {
  const queryClient = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN_MS);
  // Latest payload per entity, flushed together after the debounce window.
  const pendingRef = useRef(new Map<DataChangeEntity, DataChangeEventPayload>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React Query invalidation for the query keys each entity affects.
  const invalidateForEntity = useCallback((entity: DataChangeEntity) => {
    if (entity === 'book') {
      // Import/overwrite/book delete: refresh the scoped known-key list.
      for (const queryKey of BOOK_SCOPED_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    } else if (entity === 'accounts') {
      // Account create/rename/move/delete: hierarchy shape and rolled-up
      // balances change; reconcile/review rollups do not.
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'hierarchy'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'balances'] });
    } else if (entity === 'transactions' || entity === 'reconciliation') {
      // Ledger writes move balances and reconcile/review rollups.
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'balances'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'reconcile-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'review-status'] });
    }
    // budgets / schedules / prices / business have no React Query caches
    // today — pages consume the window event instead.
  }, [queryClient]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;

    // Hidden tabs never refetch: keep accumulating until the tab is visible
    // again, then the visibilitychange handler flushes the union once.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }

    const pending = pendingRef.current;
    pendingRef.current = new Map();

    for (const [entity, payload] of pending) {
      // React Query invalidation runs for every event, echo or not: the page
      // that wrote only refetches its own list (the ledger), while the shared
      // caches other pages read (account balances, reconcile rollups) still
      // hold pre-write numbers for their whole staleTime. Dropping the echo
      // here used to leave the account hierarchy showing stale balances for
      // minutes after a ledger entry.
      invalidateForEntity(entity);

      // Late echo check: the SSE frame can arrive before the mutating fetch on
      // this tab resolves and marks suppression, so re-check at flush time.
      // Only the window fan-out is the echo — that is what would trigger the
      // writing page's duplicate refetch.
      if (isEchoSuppressed(entity)) continue;

      window.dispatchEvent(new CustomEvent(DATA_CHANGE_EVENT, { detail: payload }));
    }
  }, [invalidateForEntity]);
  const flushRef = useRef(flush);
  const invalidateRef = useRef(invalidateForEntity);
  useEffect(() => {
    flushRef.current = flush;
    invalidateRef.current = invalidateForEntity;
  }, [flush, invalidateForEntity]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let disposed = false;
    // Set once the stream has dropped (server restart, network blip). Any
    // event published while it was down is gone, so the next 'connected'
    // refreshes the book-scoped caches instead of trusting them.
    let dropped = false;

    const connect = () => {
      if (disposed || sourceRef.current) return;
      const source = new EventSource('/api/data-events/stream');
      sourceRef.current = source;

      source.addEventListener('connected', () => {
        // Healthy stream — reset the backoff.
        reconnectDelayRef.current = RECONNECT_MIN_MS;
        if (dropped) {
          dropped = false;
          invalidateRef.current('book');
        }
      });

      source.addEventListener('data-change', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as DataChangeEventPayload;
          if (!payload?.entity) return;
          // This tab's own echo still goes through flush so the shared React
          // Query caches are invalidated; only the window fan-out is dropped
          // there (the writing page already refetched its own list).
          pendingRef.current.set(payload.entity, payload);
          // Only schedule the debounce flush while visible; hidden tabs just
          // accumulate and flush once on visibilitychange -> visible.
          if (document.visibilityState === 'visible' && !flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS);
          }
        } catch {
          // Malformed frame — ignore.
        }
      });

      source.onerror = () => {
        source.close();
        sourceRef.current = null;
        if (disposed) return;
        dropped = true;
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        reconnectRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    // When a hidden tab becomes visible, flush the accumulated union once.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingRef.current.size === 0) return;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sourceRef.current?.close();
      sourceRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  return null;
}
