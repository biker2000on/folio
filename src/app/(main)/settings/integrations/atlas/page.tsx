'use client';

/**
 * Settings → Atlas: the Atlas (formerly beez-trackz) hive-management sync.
 *
 * Atlas talks to Folio over /api/integrations/beez/* with an API token for
 * this book. This page answers "is it connected and working?" (linked
 * transactions, last activity, deletions waiting for Atlas, the tokens it can
 * use) and walks through setup; the endpoint reference lives in API docs.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { PageHeader } from '@/components/ui/PageHeader';
import { feedbackAge } from '@/lib/feedback';
import type { AtlasStatus } from '@/lib/integrations/atlas-status';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl text-foreground" style={{ fontFeatureSettings: "'tnum'" }}>{value}</p>
      {hint && <p className="mt-1 text-xs text-foreground-secondary">{hint}</p>}
    </div>
  );
}

function when(iso: string | null): string {
  return iso ? feedbackAge(iso) : 'Never';
}

export default function AtlasSettingsPage() {
  const [status, setStatus] = useState<AtlasStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/atlas/status');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Failed to load Atlas status');
        return;
      }
      setError(null);
      setStatus(data as AtlasStatus);
    } catch {
      setError('Failed to load Atlas status');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/integrations/atlas/status')
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) setStatus(data as AtlasStatus);
        else setError(data?.error ?? 'Failed to load Atlas status');
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load Atlas status');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const writeTokens = status?.tokens.filter((t) => t.role === 'edit') ?? [];
  const connected = Boolean(status && (status.linkedTransactions > 0 || status.lastActivityAt));
  const state = !status
    ? null
    : connected
      ? { label: 'Connected', className: 'border-success/40 bg-success/10 text-success' }
      : status.tokens.length
        ? { label: 'Token ready, no data yet', className: 'border-warning/40 bg-warning/10 text-warning' }
        : { label: 'Not set up', className: 'border-border bg-background-tertiary text-foreground-secondary' };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Atlas"
        subtitle="Two-way sync with your Atlas hive-management install (formerly beez-trackz)"
        actions={
          state && (
            <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${state.className}`}>{state.label}</span>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      <section aria-label="Sync status" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Linked transactions"
          value={status ? status.linkedTransactions.toLocaleString() : '—'}
          hint="Ledger entries Atlas created and keeps in step"
        />
        <Stat
          label="Last sync activity"
          value={status ? when(status.lastActivityAt) : '—'}
          hint={status ? `Token last used ${when(status.lastTokenUseAt).toLowerCase()}` : undefined}
        />
        <Stat
          label="Deletions pending"
          value={status ? status.pendingDeletions.toLocaleString() : '—'}
          hint="Deleted here; Atlas removes them on its next sync"
        />
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">What it does</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground-secondary">
          <li>Atlas pushes each of its money records (jar sales, frame purchases, …) into this book as a balanced transaction.</li>
          <li>Edits you make here — a corrected date, a recategorized expense, a deletion — flow back to Atlas on its next sync.</li>
          <li>It only ever touches the one book its token was created in.</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">API tokens for this book</h2>
        {!status ? (
          <p className="mt-2 text-sm text-foreground-muted">Loading…</p>
        ) : status.tokens.length === 0 ? (
          <p className="mt-2 text-sm text-foreground-secondary">
            You have no tokens for this book yet. Atlas needs one to connect.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted">
                  <th className="py-2 pr-4 font-semibold">Name</th>
                  <th className="py-2 pr-4 font-semibold">Access</th>
                  <th className="py-2 pr-4 font-semibold">Last used</th>
                  <th className="py-2 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {status.tokens.map((token) => (
                  <tr key={token.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-foreground">
                      {token.name} <span className="font-mono text-xs text-foreground-muted">{token.prefix}…</span>
                    </td>
                    <td className="py-2 pr-4 text-foreground-secondary">
                      {token.role === 'edit' ? 'Read & write' : 'Read only'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-foreground-secondary">{when(token.lastUsedAt)}</td>
                    <td className="py-2 font-mono text-foreground-secondary">
                      {new Date(token.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {status && status.tokens.length > 0 && writeTokens.length === 0 && (
          <p className="mt-2 text-xs text-warning">
            None of these can write. Atlas needs a read &amp; write token to post transactions.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Connect Atlas</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-foreground-secondary">
          <li>
            Create a <strong className="text-foreground">read &amp; write</strong> token in{' '}
            <Link href="/settings" className="text-primary hover:underline">
              Settings → API Tokens
            </Link>{' '}
            while this book is active. The secret is shown once.
          </li>
          <li>
            In Atlas, set the Folio address to{' '}
            <code className="rounded-sm bg-background-tertiary px-1.5 py-0.5 font-mono text-xs text-foreground">
              {origin || 'https://your-folio'}
            </code>{' '}
            and paste the token.
          </li>
          <li>Map Atlas categories to accounts in this book (Atlas lists them from Folio), then run a sync.</li>
          <li>Come back here: linked transactions and last sync activity confirm it is working.</li>
        </ol>
        <p className="mt-3 text-xs text-foreground-muted">
          Building against it yourself? The endpoints are in the{' '}
          <Link href="/settings/api-docs#atlas-sync" className="text-primary hover:underline">
            API reference
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
