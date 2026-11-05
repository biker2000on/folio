'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useJobProgress, type JobProgressEventPayload } from '@/contexts/JobProgressContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { AccountSelector } from '@/components/ui/AccountSelector';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/investments/ui';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useBookGating } from '@/lib/hooks/useBookGating';
import { PaymentConnectionCard } from '@/components/business/PaymentConnectionCard';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { formatAccountPath } from '@/lib/account-utils';
import { formatDateForDisplay } from '@/lib/date-format';
import { amountToneClass, formatCurrency } from '@/lib/format';
import type { RelinkPair } from '@/lib/simplefin-relink';
import { simpleFinLinkState, summarizeSimpleFinIssues, type SimpleFinLinkState } from '@/lib/simplefin-notices';

const SIMPLEFIN_BRIDGE_URL = 'https://beta-bridge.simplefin.org';

interface SimpleFinAccount {
  id: string;
  name: string;
  institution: string | null;
  last4?: string | null;
  currency: string | null;
  balance: string | null;
  availableBalance: string | null;
  lastBalanceDate?: string | null;
  gnucashAccountGuid: string | null;
  lastSyncAt: string | null;
  isMapped: boolean;
  hasHoldings: boolean;
  isInvestment: boolean;
  isIgnored?: boolean;
  isLive: boolean;
  isStored: boolean;
  liveMissing: boolean;
}

interface SyncResult {
  success: boolean;
  accountsProcessed: number;
  transactionsImported: number;
  transactionsSkipped: number;
  transactionsMatched?: {
    manualReconciliation: number;
    transferDedup: number;
    relinked?: number;
  };
  errors: { account: string; error: string }[];
  warnings?: { account: string; warning: string }[];
}

type LinkFilter = 'attention' | 'linked' | 'ignored' | 'all';

/** Book account types a brokerage feed can land in; cards and loans never route by symbol. */
const INVESTMENT_ROUTABLE_TYPES = new Set(['ASSET', 'STOCK', 'MUTUAL']);

const SECONDARY_BUTTON = 'px-3 py-1.5 text-xs border border-border rounded-md text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors';
const PRIMARY_BUTTON = 'px-4 py-1.5 text-xs bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors font-medium';
const ROW_ACTION = 'py-1 text-xs text-foreground-secondary hover:text-foreground underline-offset-2 hover:underline';

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Notice({ tone, title, children }: { tone: 'warning' | 'error'; title: ReactNode; children?: ReactNode }) {
  const toneClass = tone === 'error' ? 'border-error/30 bg-error/10' : 'border-warning/30 bg-warning/10';
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={`border rounded-md p-4 ${toneClass}`}>
      <p className={`text-sm font-medium ${tone === 'error' ? 'text-error' : 'text-foreground'}`}>{title}</p>
      {children && <div className="mt-1 text-xs text-foreground-secondary space-y-2">{children}</div>}
    </div>
  );
}

export default function ConnectionsPage() {
  const { data: bookAccounts = [] } = useAccounts({ flat: true });
  const accountsByGuid = useMemo(() => new Map(bookAccounts.map((a) => [a.guid, a])), [bookAccounts]);
  const pathFor = (guid: string | null) => {
    const account = guid ? accountsByGuid.get(guid) : undefined;
    return account ? formatAccountPath(account.fullname, account.name) : null;
  };
  const { success, error: showError } = useToast();
  const { trackJob, connect: connectJobStream } = useJobProgress();
  const { dateFormat } = useUserPreferences();
  const { features } = useBookGating();
  const isMobile = useIsMobile();

  const formatWhen = (value: string | null | undefined, withTime = true) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const day = formatDateForDisplay(date.toLocaleDateString('en-CA'), dateFormat);
    return withTime
      ? `${day} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : day;
  };

  const [simplefinConnected, setSimplefinConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const [sfAccounts, setSfAccounts] = useState<SimpleFinAccount[]>([]);
  const [sfSetupToken, setSfSetupToken] = useState('');
  const [sfConnecting, setSfConnecting] = useState(false);
  const [sfSyncing, setSfSyncing] = useState(false);
  const [sfDisconnectOpen, setSfDisconnectOpen] = useState(false);
  const [sfDisconnecting, setSfDisconnecting] = useState(false);
  const [sfSyncResult, setSfSyncResult] = useState<SyncResult | null>(null);
  const [sfLiveProgress, setSfLiveProgress] = useState<string | null>(null);
  const [sfLastSyncAt, setSfLastSyncAt] = useState<string | null>(null);
  const [sfLastSuccessfulSyncAt, setSfLastSuccessfulSyncAt] = useState<string | null>(null);
  const [sfSyncStatus, setSfSyncStatus] = useState<string | null>(null);
  const [sfLastSyncError, setSfLastSyncError] = useState<string | null>(null);
  const [sfRevoked, setSfRevoked] = useState(false);
  const [sfSchedule, setSfSchedule] = useState<{ enabled: boolean; hours: number } | null>(null);
  const [sfLiveLoading, setSfLiveLoading] = useState(false);
  // Whether the last refresh reached the bridge. Until it has, "not returned"
  // cannot be told apart from "not fetched yet", so no row is called stale.
  const [sfLiveReady, setSfLiveReady] = useState(false);
  const [sfLiveError, setSfLiveError] = useState<string | null>(null);
  const [sfRelinkPairs, setSfRelinkPairs] = useState<RelinkPair[]>([]);
  const [sfRelinkSkip, setSfRelinkSkip] = useState<Set<string>>(new Set());
  const [sfRelinking, setSfRelinking] = useState(false);
  const [linkFilter, setLinkFilter] = useState<LinkFilter | null>(null);
  const [institutionFilter, setInstitutionFilter] = useState<string | null>(null);

  const fetchSimplefinStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/simplefin/status');
      if (res.ok) {
        const data = await res.json();
        setSimplefinConnected(data.connected);
        setSfLastSyncAt(data.lastSyncAt ?? null);
        setSfLastSuccessfulSyncAt(data.lastSuccessfulSyncAt ?? null);
        setSfSyncStatus(data.syncStatus ?? null);
        setSfLastSyncError(data.lastSyncError ?? null);
        setSfRevoked(data.revoked ?? false);
        if (data.connected) {
          setSfSchedule({ enabled: !!data.syncEnabled, hours: data.syncIntervalHours ?? 2 });
        }
        if (Array.isArray(data.accounts)) {
          // Stored rows only; the live refresh below replaces them once the
          // bridge answers, so keep any live data already on screen.
          setSfAccounts(prev => (prev.some(a => a.isLive) ? prev : data.accounts));
        }
      }
    } catch {
      // The page still renders its connect form; the live refresh reports errors.
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSimplefinAccounts = useCallback(async () => {
    setSfLiveLoading(true);
    setSfLiveError(null);
    try {
      const res = await fetch('/api/simplefin/accounts');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to refresh SimpleFin accounts');
      }
      const accounts = (data.accounts || []).map((a: SimpleFinAccount) => ({
        ...a,
        isInvestment: a.isInvestment || (a.hasHoldings && !a.isMapped),
      }));
      setSfAccounts(accounts);
      setSfRelinkPairs(Array.isArray(data.relinkPairs) ? data.relinkPairs : []);
      setSfLiveReady(data.live === true);
      setSfLiveError(data.liveError ?? null);
      setSfRevoked(data.revoked ?? false);
    } catch (err) {
      setSfLiveReady(false);
      setSfLiveError(err instanceof Error ? err.message : 'Failed to refresh SimpleFin accounts');
    } finally {
      setSfLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSimplefinStatus();
  }, [fetchSimplefinStatus]);

  useEffect(() => {
    if (simplefinConnected) {
      fetchSimplefinAccounts();
    }
  }, [simplefinConnected, fetchSimplefinAccounts]);

  const handleSfConnect = async () => {
    if (!sfSetupToken.trim()) {
      showError('Please enter a setup token');
      return;
    }
    setSfConnecting(true);
    try {
      const res = await fetch('/api/simplefin/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: sfSetupToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Failed to connect');
        return;
      }
      success('SimpleFin connected');
      setSfSetupToken('');
      await fetchSimplefinStatus();
    } catch {
      showError('Failed to connect to SimpleFin');
    } finally {
      setSfConnecting(false);
    }
  };

  const saveMapping = async (sfAccount: SimpleFinAccount, changes: Partial<Pick<SimpleFinAccount, 'gnucashAccountGuid' | 'isInvestment' | 'isIgnored'>>) => {
    const next = { ...sfAccount, ...changes };
    try {
      const res = await fetch('/api/simplefin/accounts/map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mappings: [{
            simpleFinAccountId: sfAccount.id,
            simpleFinAccountName: sfAccount.name,
            simpleFinInstitution: sfAccount.institution,
            gnucashAccountGuid: next.gnucashAccountGuid || null,
            isInvestment: next.isInvestment,
            ...(changes.isIgnored !== undefined ? { isIgnored: changes.isIgnored } : {}),
          }],
        }),
      });
      if (!res.ok) {
        showError('Failed to update the account link');
        return;
      }
      setSfAccounts(prev => prev.map(a => {
        if (a.id !== sfAccount.id) return a;
        const isMapped = !!next.gnucashAccountGuid;
        return { ...a, ...changes, isMapped, isIgnored: isMapped ? false : next.isIgnored };
      }));
    } catch {
      showError('Failed to update the account link');
    }
  };

  const selectedRelinkPairs = sfRelinkPairs.filter(pair => !sfRelinkSkip.has(pair.toId));

  const handleSfRelink = async () => {
    if (selectedRelinkPairs.length === 0) return;
    setSfRelinking(true);
    try {
      const res = await fetch('/api/simplefin/accounts/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: selectedRelinkPairs }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Failed to carry over links');
        return;
      }
      success(`Carried over ${plural(data.relinked, 'account link')}. The next sync matches what was already imported.`);
      setSfRelinkSkip(new Set());
      await fetchSimplefinAccounts();
    } catch {
      showError('Failed to carry over links');
    } finally {
      setSfRelinking(false);
    }
  };

  const handleSfSync = async () => {
    setSfSyncing(true);
    setSfSyncResult(null);
    try {
      const res = await fetch('/api/simplefin/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Sync failed');
        return;
      }
      if (data.direct) {
        setSfSyncResult(data);
        setSfSyncStatus(data.status ?? null);
        setSfRevoked(data.revoked ?? false);
        setSfLastSyncError(data.errors?.length ? data.errors.map((err: { account: string; error: string }) => `${err.account}: ${err.error}`).join('\n') : null);
        const matched = (data.transactionsMatched?.manualReconciliation || 0)
          + (data.transactionsMatched?.transferDedup || 0)
          + (data.transactionsMatched?.relinked || 0);
        const matchedMsg = matched > 0 ? `, matched ${matched} existing` : '';
        if (data.errors?.length) {
          showError(data.errors[0].error || 'Sync finished with errors');
        } else {
          success(`Imported ${data.transactionsImported} transactions, skipped ${data.transactionsSkipped} already imported${matchedMsg}`);
        }
      } else {
        // Queued: follow the job on the progress bus — the completion event
        // populates the results panel (see the job-progress listener below).
        if (data.jobId) trackJob(String(data.jobId), 'SimpleFin sync');
        setSfLiveProgress('Sync queued…');
        setSfSyncStatus('queued');
      }
      await fetchSimplefinStatus();
    } catch {
      showError('Failed to sync');
    } finally {
      setSfSyncing(false);
    }
  };

  // Live SimpleFin sync progress from the job bus (manual AND scheduled runs
  // show here while the page is open; toasts for manual runs come from the
  // global JobProgressToasts).
  useEffect(() => {
    // The shell no longer holds the jobs stream open, and a scheduled sync is
    // never trackJob()'d — this page must open it itself to see those events.
    connectJobStream();

    const onProgress = (e: Event) => {
      const event = (e as CustomEvent<JobProgressEventPayload>).detail;
      if (!event || event.kind !== 'sync-simplefin') return;
      if (event.status === 'running' || event.status === 'progress') {
        setSfLiveProgress(event.message ?? 'Syncing…');
      } else if (event.status === 'completed') {
        setSfLiveProgress(null);
        const s = event.summary ?? {};
        const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : 0);
        setSfSyncResult({
          success: true,
          accountsProcessed: num('accountsProcessed'),
          transactionsImported: num('transactionsImported'),
          transactionsSkipped: num('transactionsSkipped'),
          transactionsMatched: {
            manualReconciliation: num('manualReconciliation'),
            transferDedup: num('transferDedup'),
            relinked: num('relinked'),
          },
          errors: [],
          warnings: [],
        });
        void fetchSimplefinStatus();
      } else if (event.status === 'failed') {
        setSfLiveProgress(null);
        void fetchSimplefinStatus();
      }
    };
    window.addEventListener('job-progress', onProgress);
    return () => window.removeEventListener('job-progress', onProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSfDisconnect = async () => {
    setSfDisconnecting(true);
    try {
      const res = await fetch('/api/simplefin/disconnect', { method: 'DELETE' });
      if (res.ok) {
        success('SimpleFin disconnected');
        setSimplefinConnected(false);
        setSfAccounts([]);
        setSfSyncResult(null);
        setSfRelinkPairs([]);
      } else {
        showError('Failed to disconnect');
      }
    } catch {
      showError('Failed to disconnect');
    } finally {
      setSfDisconnecting(false);
      setSfDisconnectOpen(false);
    }
  };

  // --- Derived view state ---------------------------------------------------

  const stateOf = (account: SimpleFinAccount): SimpleFinLinkState =>
    simpleFinLinkState({ ...account, isLive: account.isLive || !sfLiveReady });

  const counts = sfAccounts.reduce(
    (acc, a) => {
      acc[stateOf(a)]++;
      return acc;
    },
    { linked: 0, stale: 0, unlinked: 0, ignored: 0 } as Record<SimpleFinLinkState, number>,
  );
  const attentionCount = counts.stale + counts.unlinked;
  const activeFilter: LinkFilter = linkFilter ?? (attentionCount > 0 ? 'attention' : 'all');

  const visibleAccounts = sfAccounts.filter(account => {
    if (institutionFilter && account.institution !== institutionFilter) return false;
    const state = stateOf(account);
    switch (activeFilter) {
      case 'attention': return state === 'stale' || state === 'unlinked';
      case 'linked': return state === 'linked';
      case 'ignored': return state === 'ignored';
      default: return true;
    }
  });

  const groups = useMemo(() => {
    const byInstitution = new Map<string, SimpleFinAccount[]>();
    for (const account of visibleAccounts) {
      const key = account.institution || 'Other';
      byInstitution.set(key, [...(byInstitution.get(key) ?? []), account]);
    }
    return [...byInstitution.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([institution, accounts]) => ({
        institution,
        accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [visibleAccounts]);

  const institutionTotals = useMemo(() => {
    const totals = new Map<string, { linked: number; total: number }>();
    for (const account of sfAccounts) {
      const key = account.institution || 'Other';
      const entry = totals.get(key) ?? { linked: 0, total: 0 };
      entry.total++;
      if (account.isMapped) entry.linked++;
      totals.set(key, entry);
    }
    return totals;
  }, [sfAccounts]);

  // Bank-side notices describe the bridge right now, so a successful refresh
  // supersedes the ones stored by the last sync; a failed sync's own errors
  // stand until the next sync.
  const liveIssues = summarizeSimpleFinIssues(sfLiveError);
  const syncIssues = summarizeSimpleFinIssues(sfSyncStatus === 'failed' ? sfLastSyncError : null);
  const issues = {
    institutions: sfLiveReady ? liveIssues.institutions : syncIssues.institutions,
    other: [...new Set([...liveIssues.other, ...syncIssues.other])],
    raw: [...new Set([...liveIssues.raw, ...syncIssues.raw])],
  };
  const statusDot = sfRevoked || issues.other.length > 0
    ? 'bg-error'
    : issues.institutions.length > 0 || sfSyncStatus === 'queued' || sfSyncStatus === 'running'
      ? 'bg-warning'
      : 'bg-success';
  const statusLabel = sfRevoked
    ? 'Reconnect required'
    : sfSyncStatus === 'queued'
      ? 'Sync queued'
      : sfSyncStatus === 'running'
        ? 'Sync running'
        : issues.other.length > 0
          ? 'Last sync failed'
          : issues.institutions.length > 0
            ? `Connected · ${plural(issues.institutions.length, 'bank')} ${issues.institutions.length === 1 ? 'needs' : 'need'} attention at SimpleFin`
            : 'Connected';

  const filterOptions: { value: LinkFilter; label: string }[] = [
    { value: 'attention', label: `To decide ${attentionCount}` },
    { value: 'linked', label: `Linked ${counts.linked}` },
    { value: 'ignored', label: `Ignored ${counts.ignored}` },
    { value: 'all', label: `All ${sfAccounts.length}` },
  ];

  const showInvestmentToggle = (account: SimpleFinAccount) => {
    if (!account.isMapped) return false;
    if (account.hasHoldings || account.isInvestment) return true;
    const type = accountsByGuid.get(account.gnucashAccountGuid ?? '')?.account_type;
    return !!type && INVESTMENT_ROUTABLE_TYPES.has(type);
  };

  const describeRow = (account: SimpleFinAccount): string | null => {
    if (stateOf(account) === 'ignored') return 'Ignored · not imported';
    if (account.isLive || !sfLiveReady) return null;
    const lastSeen = formatWhen(account.lastBalanceDate ?? account.lastSyncAt, false);
    return lastSeen ? `Not returned by SimpleFin since ${lastSeen}` : 'Not returned by SimpleFin';
  };

  const renderBalance = (account: SimpleFinAccount) => {
    const value = account.balance === null ? NaN : Number(account.balance);
    if (!Number.isFinite(value)) return <span className="text-foreground-muted">—</span>;
    const stale = !account.isLive && sfLiveReady;
    return (
      <span className={`font-mono tabular-nums ${stale ? 'text-foreground-muted' : amountToneClass(value)}`}>
        {formatCurrency(value, account.currency || 'USD')}
      </span>
    );
  };

  const renderRowAction = (account: SimpleFinAccount) => {
    switch (stateOf(account)) {
      case 'unlinked':
        return <button type="button" className={ROW_ACTION} onClick={() => saveMapping(account, { isIgnored: true })}>Ignore</button>;
      case 'ignored':
        return <button type="button" className={ROW_ACTION} onClick={() => saveMapping(account, { isIgnored: false })}>Stop ignoring</button>;
      case 'stale':
        return <button type="button" className={ROW_ACTION} onClick={() => saveMapping(account, { gnucashAccountGuid: null })}>Unlink</button>;
      default:
        return null;
    }
  };

  const renderBookAccount = (account: SimpleFinAccount) => (
    <>
      <AccountSelector
        value={account.gnucashAccountGuid || ''}
        onChange={(guid) => saveMapping(account, { gnucashAccountGuid: guid || null })}
        placeholder={stateOf(account) === 'ignored' ? 'Ignored' : 'Link a book account…'}
        ariaLabel={`Book account for ${account.institution ?? ''} ${account.name}`.trim()}
        commitOnTab={false}
        className="w-full"
      />
      {isMobile && account.gnucashAccountGuid && (
        <p className="mt-1 break-words text-xs text-foreground-secondary">
          <span className="text-foreground-muted">→ </span>
          {pathFor(account.gnucashAccountGuid)}
        </p>
      )}
      {showInvestmentToggle(account) && (
        <label className="mt-1.5 inline-flex items-center gap-2 cursor-pointer text-xs text-foreground-secondary">
          <input
            type="checkbox"
            checked={account.isInvestment}
            onChange={(e) => saveMapping(account, { isInvestment: e.target.checked })}
            className="w-4 h-4 accent-[var(--primary)]"
          />
          Investment account: route trades to child accounts by symbol
        </label>
      )}
    </>
  );

  // --- Render -----------------------------------------------------------------

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Connections"
        subtitle="Bank feeds from SimpleFin Bridge, plus Stripe invoice payments on books that invoice."
      />

      <section aria-labelledby="bank-feed-heading" className="bg-surface rounded-lg border border-border p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 id="bank-feed-heading" className="text-lg font-semibold text-foreground">Bank feed</h2>
            {loading ? (
              <div className="mt-2 h-4 w-64 max-w-full rounded-sm bg-background-tertiary animate-pulse" aria-hidden />
            ) : simplefinConnected ? (
              <div className="mt-1 space-y-0.5">
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} aria-hidden />
                  {statusLabel}
                </p>
                <p className="text-xs text-foreground-secondary">
                  {sfLastSuccessfulSyncAt ? (
                    <>Last successful sync <span className="font-mono tabular-nums">{formatWhen(sfLastSuccessfulSyncAt)}</span></>
                  ) : sfLastSyncAt ? (
                    <>Last attempt <span className="font-mono tabular-nums">{formatWhen(sfLastSyncAt)}</span></>
                  ) : 'Never synced'}
                  {sfSchedule && (
                    <span className="text-foreground-muted">
                      {' · '}{sfSchedule.enabled ? `syncs every ${plural(sfSchedule.hours, 'hour')}` : 'scheduled sync off'}
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-foreground-secondary">
                Import transactions automatically through{' '}
                <a href={SIMPLEFIN_BRIDGE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover underline-offset-2 hover:underline">SimpleFin Bridge</a>.
              </p>
            )}
          </div>
          {simplefinConnected && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleSfSync} disabled={sfSyncing} className={`${PRIMARY_BUTTON} flex items-center gap-2`}>
                {sfSyncing && <span className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" aria-hidden />}
                {sfSyncing ? 'Syncing…' : 'Sync now'}
              </button>
              <a href={SIMPLEFIN_BRIDGE_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                Manage on SimpleFin
              </a>
              <button onClick={() => setSfDisconnectOpen(true)} className="px-3 py-1.5 text-xs rounded-md text-error hover:bg-error/10 transition-colors">
                Disconnect
              </button>
            </div>
          )}
        </div>

        {!loading && !simplefinConnected && (
          <div className="space-y-4">
            <ol className="list-decimal list-inside space-y-1 text-sm text-foreground-secondary">
              <li>Create an account on <a href={SIMPLEFIN_BRIDGE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover underline-offset-2 hover:underline">SimpleFin Bridge</a> (a paid subscription)</li>
              <li>Connect your banks through its portal</li>
              <li>Generate a setup token and paste it below</li>
            </ol>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={sfSetupToken}
                onChange={(e) => setSfSetupToken(e.target.value)}
                aria-label="SimpleFin setup token"
                placeholder="Paste your SimpleFin setup token"
                className="flex-1 bg-input-bg border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
              <button
                onClick={handleSfConnect}
                disabled={sfConnecting || !sfSetupToken.trim()}
                className="px-6 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors font-medium"
              >
                {sfConnecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {simplefinConnected && (
          <>
            {sfLiveProgress && (
              <p role="status" className="flex items-center gap-2 text-sm text-foreground-secondary">
                <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" aria-hidden />
                {sfLiveProgress}
              </p>
            )}

            {/* Re-keyed accounts come first: carrying them over is usually the
                fix for the feed problems listed below them. */}
            {sfRelinkPairs.length > 0 && (
              <Notice tone="warning" title={`${plural(sfRelinkPairs.length, 'bank account')} came back from SimpleFin with new IDs`}>
                <p>
                  Reconnecting a bank on SimpleFin Bridge issues new account and transaction IDs, so these no longer match
                  their links. Carrying a link over keeps its book account, and the next sync matches the transactions it
                  already imported instead of importing them again.
                </p>
                <ul className="space-y-1.5">
                  {sfRelinkPairs.map(pair => {
                    const from = sfAccounts.find(a => a.id === pair.fromId);
                    const to = sfAccounts.find(a => a.id === pair.toId);
                    const label = [to?.institution ?? from?.institution, to?.name ?? from?.name].filter(Boolean).join(' · ');
                    return (
                      <li key={pair.toId}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!sfRelinkSkip.has(pair.toId)}
                            onChange={(e) => setSfRelinkSkip(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(pair.toId); else next.add(pair.toId);
                              return next;
                            })}
                            className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--primary)]"
                          />
                          <span className="min-w-0">
                            <span className="text-foreground">{label || pair.toId}</span>
                            <span className="text-foreground-muted"> → </span>
                            <span>{pathFor(from?.gnucashAccountGuid ?? null) ?? 'its linked book account'}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button onClick={handleSfRelink} disabled={sfRelinking || selectedRelinkPairs.length === 0} className={PRIMARY_BUTTON}>
                  {sfRelinking ? 'Carrying over…' : `Carry over ${plural(selectedRelinkPairs.length, 'link')}`}
                </button>
              </Notice>
            )}

            {sfRevoked && (
              <Notice tone="error" title="SimpleFin access was revoked">
                <p>Disconnect, then connect again with a new setup token from SimpleFin Bridge. Your account links are removed on disconnect.</p>
              </Notice>
            )}

            {!sfRevoked && issues.other.length > 0 && (
              <Notice tone="error" title="The last sync did not finish">
                <ul className="space-y-1">
                  {issues.other.map(message => <li key={message}>{message}</li>)}
                </ul>
                <p>Sync now to retry. Accounts that synced before the failure keep what they imported.</p>
              </Notice>
            )}

            {!sfRevoked && issues.institutions.length > 0 && (
              <Notice tone="warning" title={`SimpleFin reports a problem with ${plural(issues.institutions.length, 'bank connection')}`}>
                <p>
                  Their accounts may be missing or out of date until SimpleFin finishes repairing the connection on its
                  side. Other banks keep syncing. If it lasts more than a day, re-link the bank on SimpleFin Bridge.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {issues.institutions.map(institution => (
                    <button
                      key={institution}
                      type="button"
                      onClick={() => { setInstitutionFilter(institution); setLinkFilter('all'); }}
                      className="px-2 py-0.5 rounded-sm border border-border bg-surface text-foreground hover:border-border-hover"
                    >
                      {institution}
                    </button>
                  ))}
                </div>
                <details>
                  <summary className="cursor-pointer text-foreground-muted hover:text-foreground-secondary">Message from SimpleFin</summary>
                  <ul className="mt-1 space-y-1">
                    {issues.raw.map(line => <li key={line}>{line}</li>)}
                  </ul>
                </details>
              </Notice>
            )}

            {sfSyncResult && (
              <div role="status" className="border border-border rounded-md p-4 text-sm">
                <p className={`font-medium ${sfSyncResult.errors.length > 0 ? 'text-foreground' : 'text-success'}`}>
                  Imported {plural(sfSyncResult.transactionsImported, 'transaction')}, skipped {sfSyncResult.transactionsSkipped} already imported
                  <span className="font-normal text-foreground-secondary"> · {plural(sfSyncResult.accountsProcessed, 'account')} processed</span>
                </p>
                {(() => {
                  const m = sfSyncResult.transactionsMatched;
                  const parts = [
                    m?.relinked ? `${m.relinked} moved to their new SimpleFin IDs` : null,
                    m?.manualReconciliation ? `${m.manualReconciliation} matched to transactions you entered` : null,
                    m?.transferDedup ? `${m.transferDedup} transfers matched across accounts` : null,
                  ].filter(Boolean);
                  return parts.length > 0 ? <p className="mt-1 text-foreground-secondary">{parts.join(' · ')}</p> : null;
                })()}
                {sfSyncResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-error cursor-pointer">{plural(sfSyncResult.errors.length, 'error')}</summary>
                    <ul className="mt-1 text-xs text-foreground-secondary space-y-1">
                      {sfSyncResult.errors.map((err, i) => <li key={i}>{err.account}: {err.error}</li>)}
                    </ul>
                  </details>
                )}
                {sfSyncResult.warnings && sfSyncResult.warnings.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-foreground-muted cursor-pointer">{plural(sfSyncResult.warnings.length, 'warning')}</summary>
                    <ul className="mt-1 text-xs text-foreground-secondary space-y-1">
                      {sfSyncResult.warnings.map((warning, i) => <li key={i}>{warning.account}: {warning.warning}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {simplefinConnected && (
        <section aria-labelledby="account-links-heading" className="bg-surface rounded-lg border border-border">
          <div className="p-6 pb-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
              <h2 id="account-links-heading" className="text-lg font-semibold text-foreground">Account links</h2>
              <p className="text-xs text-foreground-secondary">
                {counts.linked} linked · {counts.ignored} ignored
                {attentionCount > 0 && <> · <span className="text-foreground">{attentionCount} need a decision</span></>}
                {sfLiveLoading && <span className="text-foreground-muted"> · refreshing from SimpleFin…</span>}
              </p>
            </div>
            <p className="text-xs text-foreground-secondary">
              Each bank account imports into the book account it is linked to. Ignore accounts you never want imported, such as
              a joint account another login already brings in.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={filterOptions} value={activeFilter} onChange={setLinkFilter} ariaLabel="Show accounts" />
              {institutionFilter && (
                <button type="button" onClick={() => setInstitutionFilter(null)} className={SECONDARY_BUTTON}>
                  {institutionFilter} · show all banks
                </button>
              )}
            </div>
          </div>

          {sfAccounts.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-foreground-secondary">
              {sfLiveLoading
                ? 'Loading accounts from SimpleFin…'
                : sfLiveError
                  ? 'SimpleFin could not be reached and no accounts are stored yet. Try Sync now in a few minutes.'
                  : <>No bank accounts yet. Connect banks on <a href={SIMPLEFIN_BRIDGE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover underline-offset-2 hover:underline">SimpleFin Bridge</a>, then refresh this page.</>}
            </p>
          ) : groups.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-foreground-secondary">
              {activeFilter === 'attention' ? 'Every account is linked or ignored.' : 'No accounts match this filter.'}
            </p>
          ) : isMobile ? (
            <div className="border-t border-border">
              {groups.map(group => (
                <div key={group.institution}>
                  <h3 className="px-4 py-2 bg-background-tertiary text-xs font-medium text-foreground-secondary flex justify-between">
                    <span>{group.institution}</span>
                    <span className="font-mono tabular-nums text-foreground-muted">
                      {institutionTotals.get(group.institution)?.linked ?? 0}/{institutionTotals.get(group.institution)?.total ?? 0} linked
                    </span>
                  </h3>
                  <ul className="divide-y divide-border">
                    {group.accounts.map(account => (
                      <li key={account.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground break-words">{account.name}</p>
                            {describeRow(account) && <p className="text-xs text-foreground-muted">{describeRow(account)}</p>}
                          </div>
                          <div className="text-sm text-right shrink-0">{renderBalance(account)}</div>
                        </div>
                        {renderBookAccount(account)}
                        {renderRowAction(account) && <div>{renderRowAction(account)}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full table-fixed text-left">
              <thead>
                <tr className="border-t border-border text-xs text-foreground-muted">
                  <th scope="col" className="px-6 py-2 font-medium w-[34%]">Bank account</th>
                  <th scope="col" className="px-4 py-2 font-medium w-36 text-right">Balance</th>
                  <th scope="col" className="px-4 py-2 font-medium">Book account</th>
                  <th scope="col" className="px-6 py-2 w-32"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              {groups.map(group => (
                <tbody key={group.institution} className="divide-y divide-border/60">
                  <tr className="bg-background-tertiary">
                    <th scope="colgroup" colSpan={4} className="px-6 py-1.5 text-xs font-medium text-foreground-secondary">
                      <span className="flex justify-between">
                        <span>{group.institution}</span>
                        <span className="font-mono tabular-nums font-normal text-foreground-muted">
                          {institutionTotals.get(group.institution)?.linked ?? 0} of {institutionTotals.get(group.institution)?.total ?? 0} linked
                        </span>
                      </span>
                    </th>
                  </tr>
                  {group.accounts.map(account => (
                    <tr key={account.id} className="hover:bg-surface-hover align-top">
                      <td className="px-6 py-2.5">
                        <div className="break-words text-sm text-foreground">{account.name}</div>
                        {describeRow(account) && <div className="text-xs text-foreground-muted mt-0.5">{describeRow(account)}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right">{renderBalance(account)}</td>
                      <td className="px-4 py-2">{renderBookAccount(account)}</td>
                      <td className="px-6 py-2.5 text-right">{renderRowAction(account)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </section>
      )}

      {features?.invoicing && <PaymentConnectionCard />}

      <ConfirmationDialog
        isOpen={sfDisconnectOpen}
        onConfirm={handleSfDisconnect}
        onCancel={() => setSfDisconnectOpen(false)}
        title="Disconnect SimpleFin"
        message="This removes the SimpleFin connection and every account link. Transactions already imported stay in your books."
        confirmLabel="Disconnect"
        confirmVariant="danger"
        isLoading={sfDisconnecting}
      />
    </div>
  );
}
