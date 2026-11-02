'use client';

import { Suspense, useCallback, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AccountHierarchy from '@/components/AccountHierarchy';
import { AccountLedgerView } from '@/components/AccountLedgerView';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Tip } from '@/components/ui/Tooltip';
import { DATA_SURFACE_MAX_WIDTH } from '@/components/ui/layout-widths';
import { useDateFilter } from '@/hooks/useDateFilter';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { AccountWithChildren } from '@/lib/types';

const SPLIT_VIEW_KEY = 'accounts.splitView';
/** The split view needs room for a tree and a register side by side. */
const SPLIT_VIEW_QUERY = '(min-width: 1920px)';

function useSplitViewFits(): boolean {
    return useSyncExternalStore(
        (onStoreChange) => {
            const mql = window.matchMedia(SPLIT_VIEW_QUERY);
            mql.addEventListener('change', onStoreChange);
            return () => mql.removeEventListener('change', onStoreChange);
        },
        () => window.matchMedia(SPLIT_VIEW_QUERY).matches,
        () => false
    );
}

function AccountsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { startDate, endDate, setDateFilter, isInitialized } = useDateFilter();

    // Use React Query hook with date filtering
    const { data, isLoading, error } = useAccounts({
        flat: false,
        startDate: isInitialized ? startDate : undefined,
        endDate: isInitialized ? endDate : undefined,
    });

    // Type assertion since we know flat=false returns AccountWithChildren[]
    const accounts = (data || []) as AccountWithChildren[];

    // Optional split view (tree left, ledger right), offered from 1920px up.
    const splitFits = useSplitViewFits();
    // Only ever rendered after splitFits turns true on the client, so the
    // storage read cannot cause a hydration mismatch.
    const [splitPref, setSplitPref] = useState(() => {
        if (typeof window === 'undefined') return false;
        try { return localStorage.getItem(SPLIT_VIEW_KEY) === '1'; } catch { return false; }
    });
    const toggleSplit = () => {
        setSplitPref((prev) => {
            const next = !prev;
            try { localStorage.setItem(SPLIT_VIEW_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };
    const split = splitFits && splitPref;
    const selectedGuid = split ? searchParams.get('account') : null;

    const setSelected = useCallback((guid: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (guid) params.set('account', guid);
        else params.delete('account');
        const query = params.toString();
        router.replace(query ? `/accounts?${query}` : '/accounts', { scroll: false });
    }, [router, searchParams]);
    const closePane = useCallback(() => setSelected(null), [setSelected]);

    const headerActions = (
        <>
            {splitFits && (
                <Tip content={splitPref ? 'Open ledgers as their own page' : 'Open ledgers beside the tree'} describedBy={false}>
                    <button
                        type="button"
                        onClick={toggleSplit}
                        aria-pressed={splitPref}
                        aria-label="Split view"
                        className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                            splitPref
                                ? 'border-primary/40 bg-primary-light text-primary'
                                : 'border-border text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
                        }`}
                    >
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
                            <path d="M6.25 2.75v10.5" />
                        </svg>
                        Split view
                    </button>
                </Tip>
            )}
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={setDateFilter} />
        </>
    );

    const tree = isLoading ? (
        <div className="space-y-4">
            <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
            <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface p-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                <span className="text-sm text-foreground-secondary">Loading accounts…</span>
            </div>
        </div>
    ) : error ? (
        <div className="space-y-4">
            <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
            <div className="rounded-lg border border-error/50 bg-surface p-8 text-center text-sm text-error" role="alert">
                {error instanceof Error ? error.message : 'An error occurred'}
            </div>
        </div>
    ) : (
        <AccountHierarchy
            accounts={accounts}
            headerActions={headerActions}
            compact={split}
            onOpenAccount={split ? setSelected : undefined}
            selectedGuid={selectedGuid}
        />
    );

    if (!split) {
        return <div className={`mx-auto w-full ${DATA_SURFACE_MAX_WIDTH}`}>{tree}</div>;
    }

    return (
        <div className="grid grid-cols-[minmax(460px,560px)_minmax(0,1fr)] items-start gap-6">
            <div className="sticky top-0 max-h-[calc(100dvh-4rem)] overflow-y-auto">{tree}</div>
            <div className="min-w-0">
                {selectedGuid ? (
                    <AccountLedgerView
                        key={selectedGuid}
                        guid={selectedGuid}
                        variant="pane"
                        onClose={closePane}
                        onOpenAccount={setSelected}
                    />
                ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
                        <p className="text-sm font-medium text-foreground">Pick an account to open its ledger here</p>
                        <p className="mt-1 text-sm text-foreground-secondary">Click a name in the tree, or use ↑ ↓ and Enter.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AccountsPage() {
    return (
        <Suspense fallback={
            <div className={`mx-auto w-full ${DATA_SURFACE_MAX_WIDTH} space-y-4`}>
                <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
                <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface p-12">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <span className="text-sm text-foreground-secondary">Loading…</span>
                </div>
            </div>
        }>
            <AccountsContent />
        </Suspense>
    );
}
