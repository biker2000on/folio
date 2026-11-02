'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AccountLedger, { AccountTransaction } from '@/components/AccountLedger';
import { InvestmentKpis, InvestmentPriceChart, InvestmentSecurityLine, useAccountValuation } from '@/components/InvestmentAccount';
import { parseTransactionsResponse } from '@/components/ledger/investment-utils';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Tip } from '@/components/ui/Tooltip';
import { DATA_SURFACE_MAX_WIDTH } from '@/components/ui/layout-widths';
import { useDateFilter } from '@/hooks/useDateFilter';
import { formatCurrency, applyBalanceReversal, amountToneClass } from '@/lib/format';
import { DATE_PRESETS, toLocalDateString } from '@/lib/datePresets';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useBooks } from '@/contexts/BookContext';
import { useReviewStatus } from '@/lib/hooks/useReviewStatus';
import SimpleFinSyncIndicator from '@/components/SimpleFinSyncIndicator';

interface AccountData {
    name: string;
    fullname: string;
    depth: number;
    account_type?: string;
    commodity_namespace?: string;
    commodity_mnemonic?: string;
    commodity_guid?: string;
    commodity_scu?: number;
    child_count?: number;
    guid1?: string;
    guid2?: string;
    guid3?: string;
    guid4?: string;
    guid5?: string;
    guid6?: string;
    level1?: string;
    level2?: string;
    level3?: string;
    level4?: string;
    level5?: string;
    level6?: string;
}

const TNUM = { fontFeatureSettings: "'tnum'" } as const;

/** "This Year", "All Time", or the literal range when it is not a preset. */
function describeRange(startDate: string | null, endDate: string | null): string {
    if (!startDate && !endDate) return 'All Time';
    for (const preset of DATE_PRESETS) {
        const range = preset.getValue();
        if (range.startDate === startDate && range.endDate === endDate) return preset.label;
    }
    const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (startDate && endDate) return `${fmt(startDate)} – ${fmt(endDate)}`;
    return startDate ? `since ${fmt(startDate)}` : `through ${fmt(endDate!)}`;
}

/**
 * One account's ledger: header (path, name, balance as of the range end),
 * the investment summary when the account holds a security, and the
 * register. Rendered full-page at /accounts/[guid] and as the right-hand
 * pane of the Accounts split view.
 */
export function AccountLedgerView({
    guid,
    variant = 'page',
    onClose,
    onOpenAccount,
}: {
    guid: string;
    variant?: 'page' | 'pane';
    /** Pane only: close the pane (Escape in the ledger also calls this). */
    onClose?: () => void;
    /** Pane only: open another account (breadcrumb) in the pane. */
    onOpenAccount?: (guid: string) => void;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialShowSubaccounts = searchParams.get('subaccounts') === '1';
    const requestLotsView = searchParams.get('view') === 'lots';
    const { startDate, endDate, setDateFilter, isInitialized } = useDateFilter();
    const { balanceReversal } = useUserPreferences();
    const { activeBookGuid } = useBooks();
    const queryClient = useQueryClient();
    const { data: reviewStatus } = useReviewStatus();
    const simpleFinStatus = reviewStatus?.[guid];
    const isPane = variant === 'pane';

    const [account, setAccount] = useState<AccountData | null>(null);
    const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isInitialized || !guid) return;

        const controller = new AbortController();

        async function fetchData() {
            setLoading(true);
            setError(null);
            try {
                // Fetch account metadata
                const accountRes = await fetch(`/api/accounts/${guid}/info`, { signal: controller.signal });
                if (!accountRes.ok) {
                    // Account doesn't belong to the active book
                    if (isPane) {
                        setError('This account is not in the active book.');
                    } else {
                        router.push('/accounts');
                    }
                    return;
                }
                const accountData = await accountRes.json();
                if (controller.signal.aborted) return;
                setAccount(accountData);

                // Fetch transactions with date filter
                const txParams = new URLSearchParams();
                txParams.set('limit', '100');
                txParams.set('offset', '0');
                if (startDate) txParams.set('startDate', startDate);
                if (endDate) txParams.set('endDate', endDate);

                const txRes = await fetch(
                    `/api/accounts/${guid}/transactions?${txParams.toString()}`,
                    { signal: controller.signal },
                );
                if (!txRes.ok) throw new Error('Failed to fetch transactions');
                const txData = await txRes.json();
                if (controller.signal.aborted) return;
                setTransactions(parseTransactionsResponse(txData));
            } catch (err) {
                // A superseded request must not overwrite the current account's data.
                if ((err as Error).name === 'AbortError') return;
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        fetchData();
        return () => controller.abort();
    }, [guid, startDate, endDate, isInitialized, activeBookGuid, router, isPane]);

    // The header balance is the account's balance at the END of the selected
    // range (or today, if the range runs past today) — not the running balance
    // of whichever row happens to be loaded, which is $0.00 when the range has
    // no activity.
    const today = toLocalDateString(new Date());
    const asOf = endDate && endDate < today ? endDate : today;
    const asOfLabel = asOf === today
        ? 'Today'
        : new Date(`${asOf}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const balanceQueryKey = ['accounts', 'balances', guid, 'as-of', asOf] as const;
    const { data: balanceData, isError: balanceFailed } = useQuery<{ total_balance: string }>({
        queryKey: balanceQueryKey,
        queryFn: async () => {
            const res = await fetch(`/api/accounts/${guid}/balance?asOfDate=${asOf}`);
            if (!res.ok) throw new Error('Failed to fetch balance');
            return res.json();
        },
        enabled: Boolean(guid),
        staleTime: 1000 * 30,
    });

    const isInvestmentAccount = Boolean(account?.commodity_namespace && account.commodity_namespace !== 'CURRENCY');
    const { data: valuation } = useAccountValuation(guid, isInvestmentAccount);

    const accountType = account?.account_type || 'ASSET';
    const rawBalance = balanceData ? parseFloat(balanceData.total_balance) : null;
    const balance = rawBalance === null || !Number.isFinite(rawBalance)
        ? null
        : applyBalanceReversal(rawBalance, accountType, balanceReversal);

    // Ancestors only; the account itself is the h1.
    const ancestors: { name: string; guid: string }[] = [];
    if (account) {
        for (let i = 1; i < (account.depth || 0); i++) {
            const levelName = account[`level${i}` as keyof AccountData];
            const levelGuid = account[`guid${i}` as keyof AccountData];
            if (levelName && levelGuid) ancestors.push({ name: String(levelName), guid: String(levelGuid) });
        }
    }
    const parent = ancestors[ancestors.length - 1];

    const crumbProps = (targetGuid: string) => ({
        href: `/accounts/${targetGuid}`,
        onClick: onOpenAccount
            ? (event: React.MouseEvent) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                onOpenAccount(targetGuid);
            }
            : undefined,
    });

    // Stable identities: AccountLedger keys its refetch callbacks on these.
    const handleEscape = useCallback(() => {
        if (onClose) onClose();
        else router.push(`/accounts?focus=${guid}`);
    }, [onClose, router, guid]);
    const handleBalanceChange = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['accounts', 'balances', guid] });
    }, [queryClient, guid]);
    const hasRange = Boolean(startDate || endDate);
    const handleShowAllDates = useCallback(() => setDateFilter({ startDate: null, endDate: null }), [setDateFilter]);

    const rangeLabel = describeRange(startDate, endDate);
    const datePicker = <DateRangePicker startDate={startDate} endDate={endDate} onChange={setDateFilter} />;

    const balanceBlock = (
        // On phones an investment's KPI cards, right below, already show the
        // holding and its value; the header copy would only repeat them.
        <div className={`shrink-0 sm:block sm:text-right ${isInvestmentAccount ? 'hidden' : ''}`}>
            <p className="text-xs text-foreground-secondary">
                {isInvestmentAccount ? 'Holding' : 'Balance'} · {asOfLabel}
            </p>
            {isInvestmentAccount ? (
                <>
                    <p className="font-mono text-2xl font-semibold text-foreground" style={TNUM}>
                        {balance === null ? '—' : `${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
                        <span className="ml-1.5 text-sm font-normal text-foreground-secondary">{account?.commodity_mnemonic ?? 'sh'}</span>
                    </p>
                    {asOf === today && valuation?.holdings && (
                        <p className="font-mono text-sm text-foreground-secondary" style={TNUM}>
                            ≈ <span className={amountToneClass(valuation.holdings.marketValue)}>{formatCurrency(valuation.holdings.marketValue, 'USD')}</span>
                        </p>
                    )}
                </>
            ) : (
                <p className={`font-mono text-2xl font-semibold ${balance === null ? 'text-foreground-muted' : amountToneClass(balance)}`} style={TNUM}>
                    {balance === null
                        ? (balanceFailed ? <Tip content="The balance could not be loaded"><span>—</span></Tip> : '—')
                        : formatCurrency(balance, account?.commodity_mnemonic || 'USD')}
                </p>
            )}
        </div>
    );

    return (
        <div className={isPane ? 'space-y-4' : `mx-auto w-full ${DATA_SURFACE_MAX_WIDTH} space-y-4`}>
            <header className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                    <nav aria-label="Account path" className="min-w-0 text-xs text-foreground-secondary">
                        {/* Phones: one step up. Wider: the whole path. */}
                        <Link
                            {...(parent ? crumbProps(parent.guid) : { href: '/accounts' })}
                            className="inline-flex items-center gap-1 hover:text-primary sm:hidden"
                        >
                            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 3.5 5.5 8 10 12.5" />
                            </svg>
                            {parent?.name ?? 'Accounts'}
                        </Link>
                        <ol className="hidden flex-wrap items-center gap-x-1.5 sm:flex">
                            {!isPane && (
                                <li className="flex items-center gap-1.5">
                                    <Link href="/accounts" className="hover:text-primary">Accounts</Link>
                                </li>
                            )}
                            {ancestors.map((segment, index) => (
                                <li key={segment.guid} className="flex items-center gap-1.5">
                                    {(index > 0 || !isPane) && <span aria-hidden="true" className="text-foreground-muted">/</span>}
                                    <Link {...crumbProps(segment.guid)} className="hover:text-primary">{segment.name}</Link>
                                </li>
                            ))}
                        </ol>
                    </nav>
                    {isPane && (
                        <div className="flex shrink-0 items-center gap-1">
                            <Tip content="Open as a full page" describedBy={false}>
                                <Link
                                    href={`/accounts/${guid}`}
                                    aria-label="Open as a full page"
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary hover:bg-surface-hover hover:text-foreground"
                                >
                                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
                                    </svg>
                                </Link>
                            </Tip>
                            <Tip content="Close (Esc)" describedBy={false}>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close ledger pane"
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary hover:bg-surface-hover hover:text-foreground"
                                >
                                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" d="m4 4 8 8M12 4l-8 8" />
                                    </svg>
                                </button>
                            </Tip>
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                        <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold text-foreground">
                            <span className="truncate">{account?.name ?? <span className="text-foreground-muted">Loading…</span>}</span>
                            {simpleFinStatus?.hasSimpleFin && (
                                <SimpleFinSyncIndicator
                                    status={simpleFinStatus.simpleFinSyncStatus}
                                    error={simpleFinStatus.simpleFinSyncError}
                                />
                            )}
                        </h1>
                        {isInvestmentAccount && <div className="mt-1"><InvestmentSecurityLine accountGuid={guid} /></div>}
                    </div>
                    {account && balanceBlock}
                </div>
            </header>

            {isInvestmentAccount && <InvestmentKpis accountGuid={guid} />}

            {loading ? (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface p-12">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <span className="text-sm text-foreground-secondary">Loading transactions…</span>
                </div>
            ) : error ? (
                <div className="rounded-lg border border-error/50 bg-surface p-8 text-center text-sm text-error" role="alert">
                    {error}
                </div>
            ) : (
                <AccountLedger
                    key={guid}
                    accountGuid={guid}
                    initialTransactions={transactions}
                    startDate={startDate}
                    endDate={endDate}
                    accountType={account?.account_type}
                    commodityNamespace={account?.commodity_namespace}
                    accountCommodityGuid={account?.commodity_guid}
                    commodityScu={account?.commodity_scu}
                    hasChildren={(account?.child_count ?? 0) > 0}
                    initialShowSubaccounts={initialShowSubaccounts}
                    requestLotsView={requestLotsView}
                    toolbarLeading={datePicker}
                    rangeLabel={rangeLabel}
                    onShowAllDates={hasRange ? handleShowAllDates : undefined}
                    onEscape={handleEscape}
                    onCurrentBalanceChange={handleBalanceChange}
                />
            )}

            {isInvestmentAccount && <InvestmentPriceChart accountGuid={guid} startDate={startDate} endDate={endDate} />}
        </div>
    );
}
