'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

// The form primitives are app-wide (see components/ui/form.tsx); they are
// re-exported here so the resilience pages keep a single import site.
export { INPUT, LABEL, TNUM, FieldGrid, RecordCard, Field } from '@/components/ui/form';
import { TNUM } from '@/components/ui/form';

export function Panel(props: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background-secondary/30">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
          {props.description && <p className="mt-1 text-xs text-foreground-muted">{props.description}</p>}
        </div>
        {props.action}
      </div>
      <div className="p-5">{props.children}</div>
    </section>
  );
}

/**
 * A headline figure. With `href` it is a KPI (DESIGN.md: every KPI is a way
 * in): the whole tile links to the view that explains it and names what opens.
 * `muted` is for figures that are zero or not yet computable, which must not
 * borrow a money colour.
 */
export function Metric(props: {
  label: string;
  value: ReactNode;
  tone?: 'positive' | 'negative' | 'warning' | 'muted';
  href?: string;
  opens?: string;
  hint?: ReactNode;
}) {
  const tone = props.tone === 'positive'
    ? 'text-positive'
    : props.tone === 'negative'
      ? 'text-negative'
      : props.tone === 'warning'
        ? 'text-warning'
        : props.tone === 'muted'
          ? 'text-foreground-muted'
          : 'text-foreground';
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">{props.label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold ${tone}`} style={TNUM}>{props.value}</p>
      {props.hint && <p className="mt-1 text-xs text-foreground-muted">{props.hint}</p>}
      {props.href && <p className="mt-2 text-xs text-primary">{props.opens ?? 'View details'} →</p>}
    </>
  );
  const frame = 'rounded-lg border border-border bg-background-secondary/30 p-4';
  return props.href
    ? <Link href={props.href} className={`${frame} block transition-colors hover:border-border-hover hover:bg-surface-hover`}>{body}</Link>
    : <div className={frame}>{body}</div>;
}

export function Tabs<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<{ value: T; label: string }>;
  label?: string;
}) {
  // Scrolls rather than wraps: a wrapped tab row strands the last tab on its
  // own line under a broken underline.
  return (
    <div role="tablist" aria-label={props.label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {props.tabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={props.value === tab.value}
          onClick={() => props.onChange(tab.value)}
          className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
            props.value === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-foreground-secondary hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function SaveBar(props: {
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  /** Optional: shown while dirty; reverts unsaved edits. */
  onDiscard?: () => void;
  message?: string | null;
}) {
  // Nothing to save, nothing to show: a permanent bar with a disabled primary
  // button reads as broken, and covers content for no reason.
  if (!props.dirty && !props.saving && !props.message) return null;
  return (
    <div role="status" className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3 shadow-lg">
      <p className="min-w-0 text-xs text-foreground-secondary">
        {props.message ?? (props.saving ? 'Saving…' : 'Unsaved changes')}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {props.onDiscard && props.dirty && (
          <button
            type="button"
            onClick={props.onDiscard}
            disabled={props.saving}
            className="whitespace-nowrap rounded-md border border-border px-3 py-2 text-sm text-foreground-secondary transition-colors hover:text-foreground disabled:opacity-50 sm:px-4"
          >
            Discard
          </button>
        )}
        <button
          type="button"
          onClick={props.onSave}
          disabled={props.saving || !props.dirty}
          className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50 sm:px-4"
        >
          {props.saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-foreground-muted">{props.children}</div>;
}

/**
 * A section that failed to load. Its edit buffer still holds the empty
 * defaults, so the page must not render editors over it: one Save would
 * replace the stored profile with nothing.
 */
export function LoadError(props: { what: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-6">
      <p className="text-sm font-semibold text-foreground">Couldn&apos;t load {props.what}</p>
      <p className="mt-1 text-sm text-foreground-secondary">
        {props.message}. Nothing is shown, so nothing can be saved over your existing records.
      </p>
      <button
        type="button"
        onClick={props.onRetry}
        className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
      >
        Try again
      </button>
    </div>
  );
}
