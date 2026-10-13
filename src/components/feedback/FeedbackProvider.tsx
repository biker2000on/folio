'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { Tip } from '@/components/ui/Tooltip';
import { useBooks } from '@/contexts/BookContext';
import { useKeyboardShortcut } from '@/lib/hooks/useKeyboardShortcut';
import {
  FEEDBACK_STATUS_LABELS,
  OPEN_FEEDBACK_EVENT,
  unseenResolved,
  type FeedbackItem,
  type FeedbackKind,
} from '@/lib/feedback';

interface FeedbackState {
  openFeedback: (kind?: FeedbackKind) => void;
  /** The person at the keyboard triages feedback (FEEDBACK_ADMIN_USERS). */
  isAdmin: boolean;
  /** Untriaged submissions, for the operator's badge. */
  newCount: number;
  refreshAdmin: () => void;
}

const FeedbackCtx = createContext<FeedbackState | null>(null);

/** Null outside the app shell. */
export function useFeedback(): FeedbackState | null {
  return useContext(FeedbackCtx);
}

function CommentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

/** One-time "your report was resolved" notice, dismissed per batch. */
function ResolvedNotice({ items, onDismiss }: { items: FeedbackItem[]; onDismiss: () => void }) {
  const item = items[0];
  if (!item) return null;
  const excerpt = item.body.length > 90 ? `${item.body.slice(0, 90)}…` : item.body;
  return (
    <div
      role="status"
      data-feedback-ignore
      className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-success/40 bg-surface-elevated p-3.5 shadow-lg"
    >
      <div className="flex items-start gap-2.5">
        <CommentIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {item.status === 'done' ? 'Your feedback was addressed' : 'Your feedback was reviewed'}
            <span className="ml-1.5 text-[11px] font-medium text-foreground-muted">
              ({FEEDBACK_STATUS_LABELS[item.status]})
            </span>
          </p>
          <p className="text-xs text-foreground-secondary">&ldquo;{excerpt}&rdquo;</p>
          {item.admin_note && (
            <p className="border-l-2 border-success/50 pl-2 text-xs text-foreground">{item.admin_note}</p>
          )}
          {items.length > 1 && (
            <p className="text-[11px] text-foreground-muted">+{items.length - 1} more resolved</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-foreground-secondary hover:text-foreground"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { activeBookGuid } = useBooks();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [resolved, setResolved] = useState<FeedbackItem[]>([]);
  const [admin, setAdmin] = useState({ isAdmin: false, newCount: 0 });

  const openFeedback = useCallback((next: FeedbackKind = 'bug') => {
    setKind(next);
    setOpen(true);
  }, []);

  const refreshAdmin = useCallback(() => {
    fetch('/api/admin/status')
      .then((res) => (res.ok ? res.json() : { admin: false }))
      .then((status: { admin?: boolean; feedback_new?: number }) =>
        setAdmin({ isAdmin: Boolean(status.admin), newCount: status.feedback_new ?? 0 }),
      )
      .catch(() => setAdmin({ isAdmin: false, newCount: 0 }));
  }, []);

  useEffect(refreshAdmin, [refreshAdmin]);

  // Close-the-loop notices for reports an operator has resolved.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/feedback')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items?: FeedbackItem[] }) => {
        if (!cancelled) setResolved(unseenResolved(data.items ?? []));
      })
      .catch(() => {
        /* offline: no notice */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissResolved = useCallback(() => {
    const ids = resolved.map((item) => item.id);
    setResolved([]);
    void fetch('/api/feedback/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => {
      /* shown again next load; harmless */
    });
  }, [resolved]);

  // The command palette and other surfaces open the dialog by event.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: FeedbackKind } | undefined>).detail;
      openFeedback(detail?.kind);
    };
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpen);
  }, [openFeedback]);

  useKeyboardShortcut('send-feedback', 'Shift+F', 'Send feedback', () => openFeedback(), 'global', !open);

  const value = useMemo(
    () => ({ openFeedback, isAdmin: admin.isAdmin, newCount: admin.newCount, refreshAdmin }),
    [openFeedback, admin, refreshAdmin],
  );

  return (
    <FeedbackCtx.Provider value={value}>
      {children}
      <FeedbackDialog
        open={open}
        initialKind={kind}
        activeBookGuid={activeBookGuid}
        onClose={() => setOpen(false)}
      />
      {!open && <ResolvedNotice items={resolved} onDismiss={dismissResolved} />}
    </FeedbackCtx.Provider>
  );
}

/** Top-bar "Send feedback" button. */
export function FeedbackButton() {
  const feedback = useFeedback();
  if (!feedback) return null;
  return (
    <Tip content="Send feedback (Shift F)" describedBy={false}>
      <button
        type="button"
        onClick={() => feedback.openFeedback()}
        aria-label="Send feedback"
        className="rounded-lg p-2 text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <CommentIcon className="h-5 w-5" />
      </button>
    </Tip>
  );
}

export { CommentIcon as FeedbackIcon };
