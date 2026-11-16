'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TNUM } from '@/components/ui/form';
import { layoutLane } from '@/lib/financial-actions/rules';
import type {
    FinancialAction,
    FinancialActionLane,
    FinancialActionList,
    FinancialActionSeverity,
} from '@/lib/financial-actions/types';
import type { DashboardStatus } from '@/lib/dashboard-status';

/* ------------------------------------------------------------------ */
/* Shared fetch: one request per URL however many widgets ask for it   */
/* ------------------------------------------------------------------ */

const SHARED_TTL_MS = 15_000;
const sharedRequests = new Map<string, { at: number; promise: Promise<unknown> }>();

function sharedJson<T>(url: string, fresh: boolean): Promise<T> {
    const cached = sharedRequests.get(url);
    if (!fresh && cached && Date.now() - cached.at < SHARED_TTL_MS) return cached.promise as Promise<T>;
    const promise = fetch(url, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
    });
    sharedRequests.set(url, { at: Date.now(), promise });
    // A failed request must not be served to the next caller.
    promise.catch(() => {
        if (sharedRequests.get(url)?.promise === promise) sharedRequests.delete(url);
    });
    return promise;
}

/** Fetch JSON shared between widgets, with an explicit retry. */
export function useSharedFetch<T>(url: string): {
    data: T | null;
    loading: boolean;
    error: boolean;
    retry: () => void;
} {
    const [state, setState] = useState<{ data: T | null; loading: boolean; error: boolean }>({
        data: null,
        loading: true,
        error: false,
    });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        sharedJson<T>(url, attempt > 0)
            .then(data => {
                if (!cancelled) setState({ data, loading: false, error: false });
            })
            .catch(() => {
                if (!cancelled) setState({ data: null, loading: false, error: true });
            });
        return () => {
            cancelled = true;
        };
    }, [url, attempt]);

    const retry = useCallback(() => {
        setState(current => ({ ...current, loading: true, error: false }));
        setAttempt(current => current + 1);
    }, []);

    return { ...state, retry };
}

/* ------------------------------------------------------------------ */
/* Panel chrome                                                        */
/* ------------------------------------------------------------------ */

function money(value: number, digits = 0): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value);
}

function shortDay(iso: string): string {
    return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

/**
 * The card every overview widget uses: a ruled header with a link to the full
 * view, a flush body of ruled rows, and one way to say loading, failed (with a
 * retry) and empty.
 */
export function OverviewPanel({
    title,
    figure,
    href,
    hrefLabel,
    loading,
    error,
    onRetry,
    empty,
    emptyText,
    footer,
    children,
}: {
    title: string;
    /** Headline figure beside the title. */
    figure?: ReactNode;
    href: string;
    hrefLabel: string;
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    empty?: boolean;
    emptyText?: string;
    footer?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface">
            <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {figure && !loading && !error && (
                    <span className="font-mono text-sm font-semibold text-foreground" style={TNUM}>{figure}</span>
                )}
            </header>
            <div className="min-h-0 flex-1">
                {loading ? (
                    <div className="animate-pulse space-y-3 px-5 py-4" aria-busy="true">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="h-4 rounded bg-background-secondary" style={{ width: `${92 - index * 14}%` }} />
                        ))}
                    </div>
                ) : error ? (
                    <div className="px-5 py-6">
                        <p className="text-sm text-foreground">{title} could not be loaded.</p>
                        <p className="mt-1 text-xs text-foreground-muted">The rest of the dashboard is unaffected.</p>
                        <button
                            type="button"
                            onClick={onRetry}
                            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:border-border-hover hover:bg-surface-hover"
                        >
                            Try again
                        </button>
                    </div>
                ) : empty ? (
                    <p className="px-5 py-6 text-sm text-foreground-muted">{emptyText}</p>
                ) : (
                    children
                )}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs">
                <span className="min-w-0 truncate text-foreground-muted">{!loading && !error ? footer : null}</span>
                <Link
                    href={href}
                    className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground-secondary transition-colors duration-150 hover:text-primary"
                >
                    {hrefLabel}
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5 10.5 8 6 12.5" />
                    </svg>
                </Link>
            </footer>
        </section>
    );
}

const ROW = 'flex items-baseline gap-3 border-b border-border px-5 py-2 text-sm last:border-b-0';

/* ------------------------------------------------------------------ */
/* Needs attention                                                     */
/* ------------------------------------------------------------------ */

const LANES: Array<{ id: FinancialActionLane; label: string }> = [
    { id: 'fix', label: 'Fix' },
    { id: 'decide', label: 'Decide' },
    { id: 'do', label: 'Do' },
];

const SEVERITY_DOT: Record<FinancialActionSeverity, string> = {
    critical: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-foreground-muted',
};

const SEVERITY_RANK: Record<FinancialActionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** The Action Center in three numbers and its three most pressing entries. */
export function AttentionWidget() {
    const { data, loading, error, retry } = useSharedFetch<FinancialActionList>(
        '/api/actions?includeCompleted=false&refresh=false&scope=book',
    );

    const lanes = useMemo(() => LANES.map(lane => ({
        ...lane,
        entries: layoutLane(data?.actions ?? [], lane.id),
    })), [data]);

    const top = useMemo(() => lanes
        .flatMap(lane => lane.entries.map(entry => {
            const lead: FinancialAction = entry.kind === 'card' ? entry.action : entry.group.actions[0];
            return {
                key: entry.kind === 'card' ? entry.action.id : `group:${lane.id}:${entry.group.rule.id}`,
                title: entry.kind === 'card' ? entry.action.title : entry.group.rule.label,
                count: entry.kind === 'card' ? 1 : entry.group.actions.length,
                severity: lead.severity,
                dueDate: entry.kind === 'card' ? entry.action.dueDate ?? null : null,
                lane: lane.label,
            };
        }))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
            || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
        .slice(0, 4), [lanes]);

    const total = lanes.reduce((sum, lane) => sum + lane.entries.length, 0);
    const overdue = data?.summary.overdue ?? 0;

    return (
        <OverviewPanel
            title="Needs attention"
            href="/actions"
            hrefLabel="Action Center"
            loading={loading}
            error={error}
            onRetry={retry}
            empty={total === 0}
            emptyText="Nothing needs fixing, deciding or doing right now."
            footer={overdue > 0 ? <span className="text-error">{overdue} overdue</span> : 'Nothing overdue'}
        >
            <dl className="grid grid-cols-3 gap-px border-b border-border bg-border">
                {lanes.map(lane => (
                    <div key={lane.id} className="bg-surface px-5 py-3">
                        <dt className="text-xs text-foreground-muted">{lane.label}</dt>
                        <dd className="mt-0.5 font-mono text-xl font-semibold text-foreground" style={TNUM}>
                            {lane.entries.length}
                        </dd>
                    </div>
                ))}
            </dl>
            <ul>
                {top.map(item => (
                    <li key={item.key} className={ROW}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${SEVERITY_DOT[item.severity]}`} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
                        {item.count > 1 && (
                            <span className="shrink-0 font-mono text-xs text-foreground-muted" style={TNUM}>{item.count}</span>
                        )}
                        <span className="w-12 shrink-0 text-right text-xs text-foreground-muted">{item.lane}</span>
                    </li>
                ))}
            </ul>
        </OverviewPanel>
    );
}

/* ------------------------------------------------------------------ */
/* Upcoming                                                            */
/* ------------------------------------------------------------------ */

interface UpcomingResponse {
    occurrences?: Array<{
        date: string;
        scheduledTransactionGuid: string;
        scheduledTransactionName: string;
        splits: Array<{ accountGuid: string; accountName: string; amount: number }>;
    }>;
}

const UPCOMING_DAYS = 30;

/**
 * The next 30 days: scheduled transactions and dated deadlines in one list,
 * with what the scheduled ones take out of cash set against the cash on hand.
 */
export function UpcomingWidget() {
    const scheduled = useSharedFetch<UpcomingResponse | UpcomingResponse['occurrences']>(
        `/api/scheduled-transactions/upcoming?days=${UPCOMING_DAYS}`,
    );
    const status = useSharedFetch<DashboardStatus>('/api/dashboard/status');
    const actions = useSharedFetch<FinancialActionList>(
        '/api/actions?includeCompleted=false&refresh=false&scope=book',
    );

    // The moment the widget mounted: the window is measured from here.
    const [loadedAt] = useState(() => Date.now());

    const liquid = useMemo(() => new Set([
        ...(status.data?.accounts.cash ?? []),
        ...(status.data?.accounts.credit ?? []),
    ].map(account => account.guid)), [status.data]);

    const rows = useMemo(() => {
        const occurrences = Array.isArray(scheduled.data) ? scheduled.data : scheduled.data?.occurrences ?? [];
        const horizon = new Date(loadedAt + UPCOMING_DAYS * 86_400_000).toISOString().slice(0, 10);
        const today = new Date(loadedAt).toISOString().slice(0, 10);
        const scheduledRows = occurrences.map(occurrence => {
            // Effect on cash and cards: negative is money going out.
            const touchesLiquid = occurrence.splits.filter(split => liquid.has(split.accountGuid));
            const cashEffect = touchesLiquid.reduce((sum, split) => sum + split.amount, 0);
            const largest = Math.max(0, ...occurrence.splits.map(split => Math.abs(split.amount)));
            return {
                key: `st:${occurrence.scheduledTransactionGuid}:${occurrence.date}`,
                date: occurrence.date.slice(0, 10),
                title: occurrence.scheduledTransactionName,
                amount: touchesLiquid.length > 0 ? cashEffect : -largest,
                kind: 'scheduled' as const,
                overdue: false,
            };
        });
        const deadlineRows = (actions.data?.actions ?? [])
            .filter(action => action.dueDate && action.dueDate <= horizon
                && (action.origin === 'compliance' || action.origin === 'business_close' || action.origin === 'vendor_1099'))
            .map(action => ({
                key: `action:${action.id}`,
                date: action.dueDate!,
                title: action.title,
                amount: null as number | null,
                kind: 'deadline' as const,
                overdue: action.dueDate! < today,
            }));
        return [...deadlineRows, ...scheduledRows].sort((a, b) => a.date.localeCompare(b.date));
    }, [scheduled.data, actions.data, liquid, loadedAt]);

    const out = rows.reduce((sum, row) => sum + (row.amount !== null && row.amount < 0 ? -row.amount : 0), 0);
    const cash = status.data?.accounts.cashTotal ?? null;
    const shown = rows.slice(0, 6);

    return (
        <OverviewPanel
            title={`Next ${UPCOMING_DAYS} days`}
            figure={out > 0 ? `${money(out)} out` : undefined}
            href="/scheduled-transactions"
            hrefLabel="Scheduled"
            loading={scheduled.loading}
            error={scheduled.error}
            onRetry={() => { scheduled.retry(); status.retry(); actions.retry(); }}
            empty={rows.length === 0}
            emptyText="No scheduled transactions or deadlines in the next 30 days."
            footer={cash !== null && out > 0
                ? <>Cash on hand <span className="font-mono text-foreground-secondary" style={TNUM}>{money(cash)}</span>{cash < out ? <span className="text-warning"> · short by {money(out - cash)}</span> : null}</>
                : rows.length > shown.length ? `${rows.length - shown.length} more` : null}
        >
            <ul>
                {shown.map(row => (
                    <li key={row.key} className={ROW}>
                        <span className={`w-14 shrink-0 font-mono text-xs ${row.overdue ? 'text-error' : 'text-foreground-muted'}`} style={TNUM}>
                            {shortDay(row.date)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
                        {row.amount !== null ? (
                            <span
                                className={`shrink-0 font-mono ${row.amount > 0 ? 'text-positive' : 'text-foreground'}`}
                                style={TNUM}
                            >
                                {row.amount > 0 ? '+' : ''}{money(row.amount)}
                            </span>
                        ) : (
                            <span className={`shrink-0 text-xs ${row.overdue ? 'text-error' : 'text-foreground-muted'}`}>
                                {row.overdue ? 'Overdue' : 'Deadline'}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </OverviewPanel>
    );
}

/* ------------------------------------------------------------------ */
/* Accounts at a glance                                                */
/* ------------------------------------------------------------------ */

/**
 * Where the money is: cash, what is owed on cards, investments, and
 * everything else that makes up net worth.
 */
export function AccountsWidget({ netWorth, investments }: { netWorth: number | null; investments: number | null }) {
    const { data, loading, error, retry } = useSharedFetch<DashboardStatus>('/api/dashboard/status');
    const accounts = data?.accounts;
    const other = accounts && netWorth !== null && investments !== null
        ? netWorth - accounts.cashTotal - investments + accounts.creditOwed
        : null;

    const groups = accounts ? [
        { label: 'Cash', value: accounts.cashTotal, detail: accounts.cash.slice(0, 3), tone: '' },
        { label: 'Owed on cards', value: -accounts.creditOwed, detail: accounts.credit.slice(0, 2), tone: accounts.creditOwed > 0 ? 'text-negative' : '' },
    ] : [];

    return (
        <OverviewPanel
            title="Accounts"
            figure={netWorth !== null ? money(netWorth) : undefined}
            href="/accounts"
            hrefLabel="All accounts"
            loading={loading}
            error={error}
            onRetry={retry}
            footer={accounts && accounts.otherCurrencyCount > 0
                ? `${accounts.otherCurrencyCount} foreign-currency account${accounts.otherCurrencyCount === 1 ? '' : 's'} not listed`
                : 'Net worth, by where it sits'}
        >
            <ul>
                {groups.map(group => (
                    <li key={group.label} className="border-b border-border px-5 py-2">
                        <div className="flex items-baseline gap-3 text-sm">
                            <span className="min-w-0 flex-1 font-medium text-foreground">{group.label}</span>
                            <span className={`shrink-0 font-mono font-semibold ${group.tone || 'text-foreground'}`} style={TNUM}>
                                {money(group.value)}
                            </span>
                        </div>
                        {group.detail.map(account => (
                            <div key={account.guid} className="mt-1 flex items-baseline gap-3 text-xs">
                                <Link
                                    href={`/accounts/${account.guid}`}
                                    className="min-w-0 flex-1 truncate text-foreground-secondary transition-colors duration-150 hover:text-primary"
                                >
                                    {account.name}
                                </Link>
                                <span className="shrink-0 font-mono text-foreground-muted" style={TNUM}>{money(account.balance)}</span>
                            </div>
                        ))}
                    </li>
                ))}
                {investments !== null && (
                    <li className={ROW}>
                        <Link href="/investments" className="min-w-0 flex-1 font-medium text-foreground transition-colors duration-150 hover:text-primary">
                            Investments
                        </Link>
                        <span className="shrink-0 font-mono font-semibold text-foreground" style={TNUM}>{money(investments)}</span>
                    </li>
                )}
                {other !== null && Math.abs(other) >= 1 && (
                    <li className={ROW}>
                        <span className="min-w-0 flex-1 font-medium text-foreground">Other assets less other debts</span>
                        <span className={`shrink-0 font-mono font-semibold ${other < 0 ? 'text-negative' : 'text-foreground'}`} style={TNUM}>
                            {money(other)}
                        </span>
                    </li>
                )}
            </ul>
        </OverviewPanel>
    );
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                     */
/* ------------------------------------------------------------------ */

/** The latest ledger entries, and how many imported ones still need a look. */
export function RecentActivityWidget() {
    const { data, loading, error, retry } = useSharedFetch<DashboardStatus>('/api/dashboard/status');
    const recent = data?.recent;

    return (
        <OverviewPanel
            title="Recent activity"
            href="/ledger"
            hrefLabel="Ledger"
            loading={loading}
            error={error}
            onRetry={retry}
            empty={(recent?.transactions.length ?? 0) === 0}
            emptyText="No transactions yet."
            footer={recent && recent.unreviewedCount > 0
                ? <Link href="/actions" className="text-warning hover:underline">{recent.unreviewedCount} imported to review</Link>
                : 'All imports reviewed'}
        >
            <ul>
                {recent?.transactions.map(transaction => (
                    <li key={transaction.guid} className={ROW}>
                        <span className="w-14 shrink-0 font-mono text-xs text-foreground-muted" style={TNUM}>
                            {shortDay(transaction.date)}
                        </span>
                        <Link
                            href={`/ledger?transaction=${transaction.guid}`}
                            className="min-w-0 flex-1 truncate text-foreground transition-colors duration-150 hover:text-primary"
                        >
                            {transaction.description}
                        </Link>
                        {transaction.account && (
                            <span className="hidden w-32 shrink-0 truncate text-right text-xs text-foreground-muted sm:block">
                                {transaction.account}
                            </span>
                        )}
                        <span className="w-20 shrink-0 text-right font-mono text-foreground" style={TNUM}>
                            {money(transaction.amount, 2)}
                        </span>
                        <span
                            aria-hidden={transaction.reviewed}
                            className={`w-12 shrink-0 text-right text-xs ${transaction.reviewed ? 'text-transparent' : 'text-warning'}`}
                        >
                            {transaction.reviewed ? '' : 'Review'}
                        </span>
                    </li>
                ))}
            </ul>
        </OverviewPanel>
    );
}

/* ------------------------------------------------------------------ */
/* Freshness line                                                      */
/* ------------------------------------------------------------------ */

function ago(iso: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
}

/** One quiet line saying how current the data behind the page is. */
export function FreshnessLine() {
    const { data } = useSharedFetch<DashboardStatus>('/api/dashboard/status');
    const freshness = data?.freshness;
    if (!freshness) return null;
    const items = [
        freshness.latestPriceDate && { label: 'Prices as of', value: shortDay(freshness.latestPriceDate), href: '/investments' },
        freshness.lastBankSyncAt && { label: 'Bank sync', value: ago(freshness.lastBankSyncAt), href: '/settings/connections' },
        { label: 'Reconciled through', value: freshness.reconciledThrough ? shortDay(freshness.reconciledThrough) : 'not all accounts', href: '/reports/reconciliation' },
    ].filter((item): item is { label: string; value: string; href: string } => Boolean(item));

    return (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
            {items.map(item => (
                <Link key={item.label} href={item.href} className="transition-colors duration-150 hover:text-primary">
                    {item.label}{' '}
                    <span className={`text-foreground-secondary ${/\d/.test(item.value) ? 'font-mono' : ''}`} style={TNUM}>{item.value}</span>
                </Link>
            ))}
        </p>
    );
}

/** A chart-sized card for a dashboard request that failed, with a retry. */
export function LoadFailed({ title, onRetry }: { title: string; onRetry: () => void }) {
    return (
        <div className="rounded-lg border border-border bg-surface p-6" role="group" aria-label={`${title} failed to load`}>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-2 text-sm text-foreground-secondary">
                This could not be loaded. The figures are not zero; the request failed.
            </p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:border-border-hover hover:bg-surface-hover"
            >
                Try again
            </button>
        </div>
    );
}
