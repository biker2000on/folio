'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorLiveRegion } from '@/components/a11y/LiveRegion';
import { useFeedback } from '@/components/feedback/FeedbackProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { TEXTAREA } from '@/components/ui/form';
import {
  feedbackAge,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from '@/lib/feedback';

type Filter = FeedbackStatus | 'all';

const KIND_CLASS: Record<FeedbackKind, string> = {
  bug: 'border-error/40 bg-error/10 text-error',
  data: 'border-warning/40 bg-warning/10 text-warning',
  idea: 'border-primary/40 bg-primary-light text-primary',
  other: 'border-border bg-background-tertiary text-foreground-secondary',
};
const STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: 'border-primary/40 bg-primary-light text-primary',
  triaged: 'border-warning/40 bg-warning/10 text-warning',
  done: 'border-success/40 bg-success/10 text-success',
  wontfix: 'border-border bg-background-tertiary text-foreground-muted',
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function ContextTable({ item }: { item: FeedbackItem }) {
  const entries = Object.entries(item.context ?? {}).filter(([, v]) => v !== null && v !== '');
  if (item.app_version) entries.unshift(['app_version', item.app_version]);
  if (!entries.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none text-foreground-muted hover:text-foreground-secondary">Context</summary>
      <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 rounded-md bg-background-tertiary p-2 font-mono text-[11px]">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-foreground-muted">{key}</dt>
            <dd className="break-all text-foreground-secondary">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function FeedbackRow({
  item,
  highlighted,
  onChanged,
}: {
  item: FeedbackItem;
  highlighted: boolean;
  onChanged: (item: FeedbackItem) => void;
}) {
  const [note, setNote] = useState(item.admin_note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNote(item.admin_note), [item.admin_note]);

  const save = async (patch: { status?: FeedbackStatus; admin_note?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Update failed');
        return;
      }
      onChanged(data as FeedbackItem);
    } catch {
      setError('Update failed');
    } finally {
      setBusy(false);
    }
  };

  const screenshotUrl = `/api/feedback/${item.id}/screenshot`;

  return (
    <li
      id={String(item.id)}
      className={`scroll-mt-20 rounded-lg border bg-surface p-4 ${highlighted ? 'border-primary/60' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className={KIND_CLASS[item.kind]}>{FEEDBACK_KIND_LABELS[item.kind]}</Badge>
        <Badge className={STATUS_CLASS[item.status]}>{FEEDBACK_STATUS_LABELS[item.status]}</Badge>
        <span className="font-medium text-foreground">{item.user_name || 'Unknown'}</span>
        {item.user_email && <span className="text-foreground-muted">{item.user_email}</span>}
        <span className="ml-auto font-mono text-foreground-muted">
          #{item.id} · {feedbackAge(item.created_at)}
        </span>
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-sm text-foreground">{item.body}</p>

      {item.route && (
        <div className="mt-2 text-xs">
          <Link href={item.route} className="font-mono text-primary hover:underline">
            {item.route}
          </Link>
        </div>
      )}

      {item.has_screenshot && (
        <a href={screenshotUrl} target="_blank" rel="noreferrer" className="mt-2.5 block">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
          <img
            src={screenshotUrl}
            alt={`Screenshot for feedback ${item.id}`}
            loading="lazy"
            className="max-h-56 rounded-md border border-border object-cover object-top"
          />
        </a>
      )}

      <div className="mt-2.5">
        <ContextTable item={item} />
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FEEDBACK_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy || status === item.status}
              onClick={() => void save({ status, admin_note: note })}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
                status === item.status
                  ? 'border-primary/50 bg-primary-light text-primary'
                  : 'border-border bg-background-tertiary text-foreground-secondary hover:text-foreground disabled:opacity-50'
              }`}
            >
              {FEEDBACK_STATUS_LABELS[status]}
            </button>
          ))}
          {item.resolved_at && (
            <span className="text-[11px] text-foreground-muted">
              {item.resolution_seen_at ? 'Submitter has seen the resolution' : 'Submitter will be notified'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Note to the submitter (shown when you mark it Done or Won't fix)"
            aria-label={`Note for feedback ${item.id}`}
            className={`min-w-0 flex-1 ${TEXTAREA}`}
          />
          <button
            type="button"
            disabled={busy || note === item.admin_note}
            onClick={() => void save({ admin_note: note })}
            className="self-start rounded-md border border-border bg-background-tertiary px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground disabled:opacity-50"
          >
            Save note
          </button>
        </div>
        <ErrorLiveRegion message={error} />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    </li>
  );
}

export default function AdminFeedbackPage() {
  const feedback = useFeedback();
  const [filter, setFilter] = useState<Filter>('new');
  const [hash, setHash] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<Record<FeedbackStatus, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Only the latest request may land: a deep link flips the filter to "all"
  // while the initial "new" request is still in flight.
  const requestSeq = useRef(0);

  const load = useCallback(async (which: Filter) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback${which === 'all' ? '' : `?status=${which}`}`);
      if (seq !== requestSeq.current) return;
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json().catch(() => null);
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setError(data?.error ?? 'Failed to load feedback');
        return;
      }
      setItems(data.items ?? []);
      setCounts(data.counts ?? null);
    } catch {
      if (seq === requestSeq.current) setError('Failed to load feedback');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // A notification links to /admin/feedback#<id>: show everything so the
  // item is on the page, then scroll to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) {
      setHash(id);
      setFilter('all');
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    if (hash && items.length) document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [hash, items]);

  const onChanged = (updated: FeedbackItem) => {
    setItems((current) =>
      current.map((item) =>
        item.id === updated.id ? { ...item, ...updated, user_name: item.user_name, user_email: item.user_email } : item,
      ),
    );
    setCounts((current) => {
      if (!current) return current;
      const previous = items.find((item) => item.id === updated.id)?.status;
      if (!previous || previous === updated.status) return current;
      return { ...current, [previous]: current[previous] - 1, [updated.status]: current[updated.status] + 1 };
    });
    feedback?.refreshAdmin();
  };

  const options: { value: Filter; label: string }[] = [
    ...FEEDBACK_STATUSES.map((status) => ({
      value: status as Filter,
      label: `${FEEDBACK_STATUS_LABELS[status]}${counts ? ` ${counts[status]}` : ''}`,
    })),
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback Inbox"
        subtitle="Everything people send from the in-app feedback dialog"
        toolbar={
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter by status">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                  filter === option.value
                    ? 'border-primary/50 bg-primary-light text-primary'
                    : 'border-border bg-background-tertiary text-foreground-secondary hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="max-w-4xl space-y-3">
        {forbidden ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-foreground-secondary">
            Only operators listed in <code className="font-mono text-foreground">FEEDBACK_ADMIN_USERS</code> (or the
            instance owner, when it is unset) can see the feedback inbox.
          </div>
        ) : error ? (
          <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
            {error}{' '}
            <button type="button" onClick={() => void load(filter)} className="underline">
              Retry
            </button>
          </div>
        ) : loading && !items.length ? (
          <div className="space-y-3">
            <div className="h-32 animate-pulse rounded-lg bg-background-tertiary" />
            <div className="h-32 animate-pulse rounded-lg bg-background-tertiary" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-foreground-muted">
            {filter === 'new' ? 'No new feedback.' : 'Nothing here.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <FeedbackRow key={item.id} item={item} highlighted={hash === String(item.id)} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
