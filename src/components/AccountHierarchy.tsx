"use client";

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    ColumnDef,
    ExpandedState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getExpandedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { AccountWithChildren } from '@/lib/types';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { formatCurrency, applyBalanceReversal, amountToneClass, BalanceReversal } from '@/lib/format';
import { formatDateForDisplay } from '@/lib/date-format';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useInvalidateAccounts } from '@/lib/hooks/useAccounts';
import { useToast } from '@/contexts/ToastContext';
import { useReviewStatus } from '@/lib/hooks/useReviewStatus';
import { useHouseholdNames } from '@/lib/hooks/useHouseholdNames';
import type { ReviewStatusMap } from '@/app/api/accounts/review-status/route';
import { Modal } from './ui/Modal';
import { inputClass, TNUM } from './ui/form';
import { CheckboxBox } from './ui/CheckboxChip';
import { Segmented } from './investments/ui';
import { AccountForm } from './AccountForm';
import SimpleFinSyncIndicator from './SimpleFinSyncIndicator';
import { TransactionContextMenu, type TransactionContextMenuItem } from '@/components/ledger/TransactionContextMenu';
import TagChip from './tags/TagChip';
import type { Tag } from '@/lib/tags';
import { useCurrentUser, READONLY_TOOLTIP } from '@/hooks/useCurrentUser';
import { extractErrorMessage } from '@/lib/api-error';
import { Tip } from '@/components/ui/Tooltip';

interface TagWithAccounts extends Tag {
    account_guids?: string[];
}

type SortKey = 'name' | 'total_balance' | 'period_balance';
type SortDir = 'asc' | 'desc';

/** Column header → sort key, for the columns that sort on click. */
const SORT_KEY_BY_COLUMN: Partial<Record<string, SortKey>> = {
    accountName: 'name',
    periodBalance: 'period_balance',
    totalBalanceUsd: 'total_balance',
};

/** Names read A→Z first; balances read largest first. */
function defaultSortDir(key: SortKey): SortDir {
    return key === 'name' ? 'asc' : 'desc';
}

type ColumnId =
    | 'accountName'
    | 'periodBalance'
    | 'totalBalanceUsd'
    | 'totalBalanceCommodity'
    | 'lastReconcileDate'
    | 'reconciledUsd'
    | 'owner'
    | 'placeholderBadge';

interface ReconcileSummaryRow {
    guid: string;
    last_reconcile_date: string | null;
    reconciled_usd: string;
}

interface DerivedAccount extends AccountWithChildren {
    children: DerivedAccount[];
    ownCommodityBalance: number;
    ownCommodityBalanceLabel: string;
    periodBalanceUsd: number;
    totalBalanceUsd: number;
    reconciledUsd: number;
    aggregatedUnreviewed: number;
    hasSimpleFin: boolean;
    simpleFinSyncStatus: string | null;
    simpleFinSyncError: string | null;
    lastReconcileDate: string | null;
}

const COLUMN_VISIBILITY_KEY = 'account_hierarchy.column_visibility';
const COLUMN_ORDER_KEY = 'account_hierarchy.column_order';
const ALWAYS_VISIBLE_COLUMNS: ColumnId[] = ['accountName'];
const DEFAULT_COLUMN_ORDER: ColumnId[] = [
    'accountName',
    'periodBalance',
    'totalBalanceUsd',
    'totalBalanceCommodity',
    'lastReconcileDate',
    'reconciledUsd',
    'owner',
    'placeholderBadge',
];
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
    accountName: true,
    periodBalance: true,
    totalBalanceUsd: true,
    totalBalanceCommodity: false,
    lastReconcileDate: false,
    reconciledUsd: false,
    owner: false,
    placeholderBadge: false,
};
const MOBILE_DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
    accountName: true,
    periodBalance: false,
    totalBalanceUsd: false,
    totalBalanceCommodity: false,
    lastReconcileDate: false,
    reconciledUsd: false,
    owner: false,
    placeholderBadge: false,
};
// Condensed phone view: account name + total balance only, regardless of the
// user's (desktop-oriented) saved column preferences.
const MOBILE_CONDENSED_COLUMN_VISIBILITY: VisibilityState = {
    accountName: true,
    periodBalance: false,
    totalBalanceUsd: true,
    totalBalanceCommodity: false,
    lastReconcileDate: false,
    reconciledUsd: false,
    owner: false,
    placeholderBadge: false,
};

const OWNER_BADGE_LABELS: Record<string, string> = {
    self: 'Self',
    spouse: 'Spouse',
    joint: 'Joint',
};

function aggregateUnreviewed(account: AccountWithChildren, statusMap: ReviewStatusMap): number {
    let count = statusMap[account.guid]?.unreviewedCount || 0;
    for (const child of account.children || []) {
        count += aggregateUnreviewed(child, statusMap);
    }
    return count;
}

function getSortValue(account: AccountWithChildren, sortKey: SortKey): number | string {
    if (sortKey === 'name') return account.name;
    if (sortKey === 'total_balance') return parseFloat(account.total_balance || '0');
    return parseFloat(account.period_balance || '0');
}

function sortTree(accounts: AccountWithChildren[], sortKey: SortKey, sortDir: SortDir): AccountWithChildren[] {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...accounts]
        .sort((a, b) => {
            const aValue = getSortValue(a, sortKey);
            const bValue = getSortValue(b, sortKey);

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return aValue.localeCompare(bValue) * direction;
            }

            return (Number(aValue) - Number(bValue)) * direction;
        })
        .map((account) => ({
            ...account,
            children: sortTree(account.children, sortKey, sortDir),
        }));
}

function findAncestorPath(accounts: AccountWithChildren[], targetGuid: string): string[] | null {
    for (const account of accounts) {
        if (account.guid === targetGuid) return [];
        if (account.children.length > 0) {
            const childPath = findAncestorPath(account.children, targetGuid);
            if (childPath !== null) return [account.guid, ...childPath];
        }
    }
    return null;
}

function buildExpandedDefaults(accounts: AccountWithChildren[], expandToDepth: number): ExpandedState {
    const expanded: Record<string, boolean> = {};
    const visit = (nodes: AccountWithChildren[], depth: number) => {
        for (const node of nodes) {
            if (node.children.length === 0) continue;
            if (expandToDepth === Infinity || depth < expandToDepth) {
                expanded[node.guid] = true;
                visit(node.children, depth + 1);
            }
        }
    };
    visit(accounts, 0);
    return expanded;
}

function applyManualExpanded(defaultExpanded: ExpandedState, manualExpanded: Record<string, boolean>): ExpandedState {
    if (defaultExpanded === true) return true;

    const merged = { ...defaultExpanded };
    for (const [guid, isExpanded] of Object.entries(manualExpanded)) {
        if (isExpanded) {
            merged[guid] = true;
        } else {
            delete merged[guid];
        }
    }
    return merged;
}

function getMaxDate(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
}

function deriveTree(
    accounts: AccountWithChildren[],
    statusMap: ReviewStatusMap,
    reconcileMap: Map<string, ReconcileSummaryRow>,
    balanceReversal: BalanceReversal
): DerivedAccount[] {
    const deriveNode = (account: AccountWithChildren): DerivedAccount => {
        const ownCommodityBalance = applyBalanceReversal(
            parseFloat(account.total_balance || '0'),
            account.account_type,
            balanceReversal
        );
        const ownPeriodBalance = applyBalanceReversal(
            parseFloat(account.period_balance || '0'),
            account.account_type,
            balanceReversal
        );
        const ownTotalUsd = account.total_balance_usd
            ? applyBalanceReversal(parseFloat(account.total_balance_usd), account.account_type, balanceReversal)
            : ownCommodityBalance;
        const ownPeriodUsd = account.period_balance_usd
            ? applyBalanceReversal(parseFloat(account.period_balance_usd), account.account_type, balanceReversal)
            : ownPeriodBalance;
        const ownReconciledUsd = applyBalanceReversal(
            parseFloat(reconcileMap.get(account.guid)?.reconciled_usd || '0'),
            account.account_type,
            balanceReversal
        );

        const children = account.children.map(deriveNode);

        let totalBalanceUsd = ownTotalUsd;
        let periodBalanceUsd = ownPeriodUsd;
        let reconciledUsd = ownReconciledUsd;
        let lastReconcileDate = reconcileMap.get(account.guid)?.last_reconcile_date || null;

        for (const child of children) {
            totalBalanceUsd += child.totalBalanceUsd;
            periodBalanceUsd += child.periodBalanceUsd;
            reconciledUsd += child.reconciledUsd;
            lastReconcileDate = getMaxDate(lastReconcileDate, child.lastReconcileDate);
        }

        const fractionDigits =
            account.account_type === 'STOCK' || account.account_type === 'MUTUAL' ? 4 : 2;

        return {
            ...account,
            children,
            ownCommodityBalance,
            ownCommodityBalanceLabel: new Intl.NumberFormat('en-US', {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
            }).format(ownCommodityBalance),
            periodBalanceUsd,
            totalBalanceUsd,
            reconciledUsd,
            aggregatedUnreviewed: aggregateUnreviewed(account, statusMap),
            hasSimpleFin: statusMap[account.guid]?.hasSimpleFin ?? false,
            simpleFinSyncStatus: statusMap[account.guid]?.simpleFinSyncStatus ?? null,
            simpleFinSyncError: statusMap[account.guid]?.simpleFinSyncError ?? null,
            lastReconcileDate,
        };
    };

    return accounts.map(deriveNode);
}

function filterTree(
    accounts: DerivedAccount[],
    filterText: string,
    showHidden: boolean,
    showToReview: boolean
): DerivedAccount[] {
    const normalizedFilter = filterText.trim().toLowerCase();

    const visit = (account: DerivedAccount): DerivedAccount | null => {
        if (account.hidden && !showHidden) {
            return null;
        }

        const filteredChildren = account.children
            .map(visit)
            .filter((child): child is DerivedAccount => child !== null);

        const selfMatchesText =
            normalizedFilter.length === 0 ||
            account.name.toLowerCase().includes(normalizedFilter);
        const descendantMatchesText = filteredChildren.length > 0;
        const textMatches = selfMatchesText || descendantMatchesText;
        const reviewMatches = !showToReview || account.aggregatedUnreviewed > 0;

        if (!textMatches || !reviewMatches) {
            return null;
        }

        return {
            ...account,
            children: filteredChildren,
        };
    };

    return accounts
        .map(visit)
        .filter((account): account is DerivedAccount => account !== null);
}

function normalizeVisibility(state: VisibilityState): VisibilityState {
    const next = { ...DEFAULT_COLUMN_VISIBILITY, ...state };
    for (const key of ALWAYS_VISIBLE_COLUMNS) {
        next[key] = true;
    }
    return next;
}

function getDefaultVisibility(isMobile: boolean): VisibilityState {
    return isMobile ? MOBILE_DEFAULT_COLUMN_VISIBILITY : DEFAULT_COLUMN_VISIBILITY;
}

function normalizeColumnOrder(order: string[] | ColumnId[] | undefined): ColumnId[] {
    const requested = Array.isArray(order) ? order : [];
    const filtered = requested.filter(
        (id): id is ColumnId => id !== 'accountName' && DEFAULT_COLUMN_ORDER.includes(id as ColumnId)
    );
    const remaining = DEFAULT_COLUMN_ORDER.filter(
        (id) => id !== 'accountName' && !filtered.includes(id)
    );
    return ['accountName', ...filtered, ...remaining];
}

// Identity-stable fallbacks for the queries below. A `= []` destructure
// default mints a fresh array every render while the query is pending (or
// failed); that identity churn cascades through reconcileMap/accountTagsMap
// into the table's `data`/`columns`, and every row-model memo bust queues a
// `resetPageIndex()` whose state spread re-renders unconditionally — the same
// infinite DefaultLane loop that froze the document vault (2026-08-21).
const EMPTY_RECONCILE_SUMMARY: ReconcileSummaryRow[] = [];
const EMPTY_TAGS: TagWithAccounts[] = [];

interface AccountHierarchyProps {
    accounts: AccountWithChildren[];
    onRefresh?: () => void;
    /** Rendered on the header row, before New Account (date range, view toggles). */
    headerActions?: ReactNode;
    /** Open an account in place (split view) instead of navigating to its ledger. */
    onOpenAccount?: (guid: string) => void;
    /** Account shown in the split-view ledger pane; its row is highlighted. */
    selectedGuid?: string | null;
    /** Narrow pane: name and balance only, no column customisation. */
    compact?: boolean;
}

/** Expand-to-depth presets; `Infinity` is stored as 'all'. */
const DEPTH_OPTIONS = [
    { value: '0', label: 'Collapse', hint: 'Top-level accounts only' },
    { value: '1', label: '1', hint: 'Expand one level' },
    { value: '2', label: '2', hint: 'Expand two levels' },
    { value: '3', label: '3', hint: 'Expand three levels' },
    { value: 'all', label: 'All', hint: 'Expand every level' },
];

const COMPACT_COLUMN_VISIBILITY: VisibilityState = MOBILE_CONDENSED_COLUMN_VISIBILITY;

export default function AccountHierarchy({ accounts, onRefresh, headerActions, onOpenAccount, selectedGuid = null, compact = false }: AccountHierarchyProps) {
    const isMobile = useIsMobile();
    const { balanceReversal, dateFormat } = useUserPreferences();
    const invalidateAccounts = useInvalidateAccounts();
    const { success: toastSuccess, error: toastError } = useToast();
    const { isReadonly } = useCurrentUser();
    const { selfName, spouseName } = useHouseholdNames();
    const { data: reviewStatusData } = useReviewStatus();
    const statusMap = useMemo<ReviewStatusMap>(() => reviewStatusData ?? {}, [reviewStatusData]);

    const { data: reconcileSummary = EMPTY_RECONCILE_SUMMARY } = useQuery<ReconcileSummaryRow[]>({
        queryKey: ['accounts', 'reconcile-summary'],
        queryFn: async () => {
            const res = await fetch('/api/accounts/reconcile-summary');
            if (!res.ok) throw new Error('Failed to fetch account reconcile summary');
            return res.json() as Promise<ReconcileSummaryRow[]>;
        },
        staleTime: 1000 * 60 * 5,
    });

    // Tags per account (for chips after the account name)
    const { data: allTags = EMPTY_TAGS } = useQuery<TagWithAccounts[]>({
        queryKey: ['tags', 'with-accounts'],
        queryFn: async () => {
            const res = await fetch('/api/tags?include=accounts');
            if (!res.ok) throw new Error('Failed to fetch tags');
            return res.json() as Promise<TagWithAccounts[]>;
        },
        staleTime: 1000 * 60 * 5,
    });

    const accountTagsMap = useMemo(() => {
        const map = new Map<string, Tag[]>();
        for (const tag of allTags) {
            for (const guid of tag.account_guids ?? []) {
                const list = map.get(guid) ?? [];
                list.push(tag);
                map.set(guid, list);
            }
        }
        for (const list of map.values()) {
            list.sort((a, b) => a.name.localeCompare(b.name));
        }
        return map;
    }, [allTags]);

    const [showHidden, setShowHidden] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.showHidden');
            return saved ? JSON.parse(saved) : false;
        }
        return false;
    });
    const [showToReview, setShowToReview] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.showToReview');
            return saved ? JSON.parse(saved) : false;
        }
        return false;
    });
    const [filterText, setFilterText] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.sortKey');
            return (saved as SortKey) || 'name';
        }
        return 'name';
    });
    const [sortDir, setSortDir] = useState<SortDir>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.sortDir');
            if (saved === 'asc' || saved === 'desc') return saved;
            return defaultSortDir((localStorage.getItem('accountHierarchy.sortKey') as SortKey) || 'name');
        }
        return 'asc';
    });
    const [expandToDepth, setExpandToDepth] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.expandToDepth');
            return saved ? (saved === 'Infinity' ? Infinity : parseInt(saved, 10)) : Infinity;
        }
        return Infinity;
    });
    const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('accountHierarchy.manualExpanded');
            return saved ? JSON.parse(saved) : {};
        }
        return {};
    });
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => getDefaultVisibility(false));
    const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMN_ORDER);
    const [columnPrefsLoaded, setColumnPrefsLoaded] = useState(false);
    const [draggedColumnId, setDraggedColumnId] = useState<ColumnId | null>(null);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const viewMenuRef = useRef<HTMLDivElement | null>(null);

    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedAccount, setSelectedAccount] = useState<AccountWithChildren | null>(null);
    const [parentGuid, setParentGuid] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<AccountWithChildren | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; account: DerivedAccount } | null>(null);
    const filterInputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // Keyboard navigation
    const router = useRouter();
    const searchParams = useSearchParams();
    const [focusedRowIndex, setFocusedRowIndex] = useState(-1);
    const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
    const focusGuid = searchParams.get('focus');

    useEffect(() => {
        localStorage.setItem('accountHierarchy.showHidden', JSON.stringify(showHidden));
    }, [showHidden]);

    useEffect(() => {
        localStorage.setItem('accountHierarchy.showToReview', JSON.stringify(showToReview));
    }, [showToReview]);

    useEffect(() => {
        localStorage.setItem('accountHierarchy.sortKey', sortKey);
        localStorage.setItem('accountHierarchy.sortDir', sortDir);
    }, [sortKey, sortDir]);

    useEffect(() => {
        localStorage.setItem(
            'accountHierarchy.expandToDepth',
            expandToDepth === Infinity ? 'Infinity' : expandToDepth.toString()
        );
    }, [expandToDepth]);

    useEffect(() => {
        localStorage.setItem('accountHierarchy.manualExpanded', JSON.stringify(manualExpanded));
    }, [manualExpanded]);

    useEffect(() => {
        if (!isViewMenuOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
                setIsViewMenuOpen(false);
            }
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setIsViewMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKey, true);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKey, true);
        };
    }, [isViewMenuOpen]);

    useEffect(() => {
        let cancelled = false;

        async function loadColumnPrefs() {
            try {
                const res = await fetch('/api/user/preferences?key=account_hierarchy.*');
                if (!res.ok) throw new Error('Failed to load column preferences');
                const data = await res.json() as { preferences?: Record<string, unknown> };
                const savedVisibility = data.preferences?.[COLUMN_VISIBILITY_KEY];
                const savedOrder = data.preferences?.[COLUMN_ORDER_KEY];

                if (!cancelled && savedVisibility && typeof savedVisibility === 'object' && !Array.isArray(savedVisibility)) {
                    setColumnVisibility(normalizeVisibility(savedVisibility as VisibilityState));
                } else if (!cancelled) {
                    setColumnVisibility(getDefaultVisibility(isMobile));
                }

                if (!cancelled && Array.isArray(savedOrder)) {
                    setColumnOrder(normalizeColumnOrder(savedOrder as string[]));
                }
            } catch {
                if (!cancelled) {
                    setColumnVisibility(getDefaultVisibility(isMobile));
                    setColumnOrder(DEFAULT_COLUMN_ORDER);
                }
            } finally {
                if (!cancelled) {
                    setColumnPrefsLoaded(true);
                }
            }
        }

        loadColumnPrefs();
        return () => {
            cancelled = true;
        };
    }, [isMobile]);

    useEffect(() => {
        if (!columnPrefsLoaded) return;

        const timeoutId = window.setTimeout(() => {
            fetch('/api/user/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preferences: {
                        [COLUMN_VISIBILITY_KEY]: normalizeVisibility(columnVisibility),
                        [COLUMN_ORDER_KEY]: normalizeColumnOrder(columnOrder),
                    },
                }),
            }).catch(() => {
                console.error('Failed to save account hierarchy column preferences');
            });
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [columnOrder, columnVisibility, columnPrefsLoaded]);

    const reconcileMap = useMemo(
        () => new Map(reconcileSummary.map((row) => [row.guid, row])),
        [reconcileSummary]
    );

    const sortedAccounts = useMemo(() => sortTree(accounts, sortKey, sortDir), [accounts, sortKey, sortDir]);

    const handleSortColumn = useCallback((key: SortKey) => {
        if (key === sortKey) {
            setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(defaultSortDir(key));
        }
    }, [sortKey]);
    const derivedAccounts = useMemo(
        () => deriveTree(sortedAccounts, statusMap, reconcileMap, balanceReversal),
        [sortedAccounts, statusMap, reconcileMap, balanceReversal]
    );
    const filteredAccounts = useMemo(
        () => filterTree(derivedAccounts, filterText, showHidden, showToReview),
        [derivedAccounts, filterText, showHidden, showToReview]
    );

    const defaultExpanded = useMemo(
        () => buildExpandedDefaults(filteredAccounts, expandToDepth),
        [filteredAccounts, expandToDepth]
    );
    const expanded = useMemo<ExpandedState>(() => {
        if (filterText || showToReview) return true;
        return applyManualExpanded(defaultExpanded, manualExpanded);
    }, [defaultExpanded, filterText, manualExpanded, showToReview]);

    const handleRowToggle = useCallback((guid: string, isExpanded: boolean) => {
        setManualExpanded((prev) => ({
            ...prev,
            [guid]: !isExpanded,
        }));
    }, []);

    const moveColumn = useCallback((fromId: ColumnId, toId: ColumnId) => {
        if (fromId === toId || fromId === 'accountName' || toId === 'accountName') {
            return;
        }

        setColumnOrder((prev) => {
            const current = normalizeColumnOrder(prev);
            const fromIndex = current.indexOf(fromId);
            const toIndex = current.indexOf(toId);

            if (fromIndex === -1 || toIndex === -1) {
                return current;
            }

            const next = [...current];
            next.splice(fromIndex, 1);
            next.splice(toIndex, 0, fromId);
            return normalizeColumnOrder(next);
        });
    }, []);

    const handleNewAccount = useCallback(() => {
        setSelectedAccount(null);
        setParentGuid(null);
        setModalMode('create');
        setModalOpen(true);
    }, []);

    const handleNewChild = useCallback((parent: AccountWithChildren) => {
        setSelectedAccount(null);
        setParentGuid(parent.guid);
        setModalMode('create');
        setModalOpen(true);
    }, []);

    const handleEdit = useCallback(async (account: AccountWithChildren) => {
        // Fetch full account data including notes and preferences
        try {
            const res = await fetch(`/api/accounts/${account.guid}`);
            if (res.ok) {
                const fullAccount = await res.json();
                setSelectedAccount({
                    ...account,
                    ...fullAccount,
                });
            } else {
                setSelectedAccount(account);
            }
        } catch {
            setSelectedAccount(account);
        }
        setParentGuid(null);
        setModalMode('edit');
        setModalOpen(true);
    }, []);

    const handleDeleteConfirm = useCallback((account: AccountWithChildren) => {
        setDeleteConfirm(account);
        setDeleteError(null);
    }, []);

    const handleDelete = useCallback(async () => {
        if (!deleteConfirm) return;

        setDeleting(true);
        setDeleteError(null);

        try {
            const res = await fetch(`/api/accounts/${deleteConfirm.guid}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(extractErrorMessage(data, 'Failed to delete account'));
            }

            const deletedName = deleteConfirm.name;
            setDeleteConfirm(null);
            invalidateAccounts();
            onRefresh?.();
            toastSuccess(`Deleted account "${deletedName}"`);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
        } finally {
            setDeleting(false);
        }
    }, [deleteConfirm, invalidateAccounts, onRefresh, toastSuccess]);

    const handleSave = useCallback(async (data: {
        name: string;
        account_type: string;
        parent_guid: string | null;
        commodity_guid: string;
        commodity_scu?: number;
        code: string;
        description: string;
        hidden: number;
        placeholder: number;
        notes: string;
        tax_related: boolean;
        is_retirement: boolean;
        retirement_account_type: string | null;
    }) => {
        const url = modalMode === 'create'
            ? '/api/accounts'
            : `/api/accounts/${selectedAccount?.guid}`;
        const method = modalMode === 'create' ? 'POST' : 'PUT';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(extractErrorMessage(errorData, 'Failed to save account'));
            }

            setModalOpen(false);
            invalidateAccounts();
            onRefresh?.();
            toastSuccess(modalMode === 'create' ? `Created account "${data.name}"` : `Updated account "${data.name}"`);
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'Failed to save account');
            throw err; // let AccountForm show inline error too
        }
    }, [modalMode, selectedAccount, invalidateAccounts, onRefresh, toastSuccess, toastError]);

    const openContextMenu = useCallback((event: ReactMouseEvent, account: DerivedAccount) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY, account });
    }, []);

    const contextMenuItems = useMemo<TransactionContextMenuItem[]>(() => {
        if (!contextMenu) return [];
        const account = contextMenu.account;
        return [
            {
                id: 'open-ledger',
                label: 'Open ledger',
                onSelect: () => router.push(`/accounts/${account.guid}`),
            },
            ...(account.children.length > 0 ? [{
                id: 'open-subaccounts',
                label: 'Open with sub-accounts',
                onSelect: () => router.push(`/accounts/${account.guid}?subaccounts=1`),
            }] : []),
            {
                id: 'new-child',
                label: 'New child account',
                onSelect: () => handleNewChild(account),
            },
            {
                id: 'edit',
                label: 'Edit account',
                onSelect: () => { void handleEdit(account); },
            },
            ...(!isReadonly ? [{
                id: 'delete',
                label: 'Delete account',
                variant: 'danger' as const,
                onSelect: () => handleDeleteConfirm(account),
            }] : []),
        ];
    }, [contextMenu, handleDeleteConfirm, handleEdit, handleNewChild, isReadonly, router]);

    const columns = useMemo<ColumnDef<DerivedAccount>[]>(() => [
        {
            id: 'accountName',
            header: 'Account',
            cell: ({ row }) => {
                const account = row.original;
                const canExpand = row.getCanExpand();
                const isExpanded = row.getIsExpanded();
                const indent = row.depth * (isMobile || compact ? 12 : 20) + 8;
                const tags = accountTagsMap.get(account.guid) ?? [];

                return (
                    <div
                        className={`flex w-full min-w-0 items-center gap-1.5 py-2.5 pr-2 md:py-1.5 ${compact ? '' : 'md:min-w-[18rem]'} ${
                            account.hidden ? 'opacity-50 grayscale' : ''
                        }`}
                        style={{ paddingLeft: `${indent}px` }}
                    >
                        {canExpand ? (
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleRowToggle(account.guid, isExpanded);
                                }}
                                className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                                aria-label={isExpanded ? `Collapse ${account.name}` : `Expand ${account.name}`}
                                aria-expanded={isExpanded}
                            >
                                <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5 10.5 8 6 12.5" />
                                </svg>
                            </button>
                        ) : (
                            <span className="-ml-1 w-6 shrink-0" />
                        )}
                        <Link
                            href={`/accounts/${account.guid}`}
                            className={`min-w-0 truncate text-sm transition-colors hover:text-primary ${
                                row.depth === 0 ? 'font-semibold text-foreground' : 'text-foreground'
                            } ${
                                filterText && account.name.toLowerCase().includes(filterText.toLowerCase())
                                    ? 'text-primary underline underline-offset-4 decoration-primary/50'
                                    : ''
                            }`}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (onOpenAccount && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                                    event.preventDefault();
                                    onOpenAccount(account.guid);
                                }
                            }}
                        >
                            {account.name}
                        </Link>
                        {tags.length > 0 && !compact && (
                            <span className="hidden md:contents">
                                {tags.map(tag => (
                                    <TagChip
                                        key={tag.id}
                                        name={tag.name}
                                        color={tag.color}
                                        title={`Show transactions tagged #${tag.name}`}
                                        onClick={() => router.push(`/ledger?search=${encodeURIComponent(`#${tag.name}`)}`)}
                                        className="flex-shrink-0"
                                    />
                                ))}
                            </span>
                        )}
                        {account.hasSimpleFin && (
                            <SimpleFinSyncIndicator
                                status={account.simpleFinSyncStatus}
                                error={account.simpleFinSyncError}
                                compact
                            />
                        )}
                        {account.aggregatedUnreviewed > 0 && (
                            <Tip content={`${account.aggregatedUnreviewed} transaction${account.aggregatedUnreviewed === 1 ? '' : 's'} to review${canExpand ? ' here and below' : ''}`}>
                                <span className="shrink-0 rounded-sm bg-warning/10 px-1.5 font-mono text-xs leading-5 text-warning" style={TNUM}>
                                    {account.aggregatedUnreviewed}
                                </span>
                            </Tip>
                        )}
                        {account.hidden === 1 && (
                            <span className="shrink-0 rounded-sm border border-border px-1.5 text-xs leading-5 text-foreground-muted">
                                Hidden
                            </span>
                        )}
                        <Tip content="Account actions" describedBy={false}>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setContextMenu({ x: rect.left, y: rect.bottom + 4, account });
                                }}
                                className="ml-auto hidden h-6 w-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 md:flex"
                                aria-label={`Actions for ${account.name}`}
                                aria-haspopup="menu"
                            >
                                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                                    <circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" />
                                </svg>
                            </button>
                        </Tip>
                    </div>
                );
            },
        },
        {
            id: 'periodBalance',
            header: 'Period',
            cell: ({ row }) => (
                <div className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-sm leading-tight" style={TNUM}>
                    <span className={amountToneClass(row.original.periodBalanceUsd)}>
                        {formatCurrency(row.original.periodBalanceUsd, 'USD')}
                    </span>
                </div>
            ),
        },
        {
            id: 'totalBalanceUsd',
            header: 'Balance',
            cell: ({ row }) => (
                <div className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-sm leading-tight" style={TNUM}>
                    <span className={`${row.depth === 0 ? 'font-semibold' : 'font-medium'} ${amountToneClass(row.original.totalBalanceUsd)}`}>
                        {isMobile
                            ? new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                                maximumFractionDigits: 0,
                            }).format(row.original.totalBalanceUsd)
                            : formatCurrency(row.original.totalBalanceUsd, 'USD')}
                    </span>
                </div>
            ),
        },
        {
            id: 'totalBalanceCommodity',
            header: 'Units',
            cell: ({ row }) => {
                const account = row.original;
                // Only worth a cell when it says something the USD total does
                // not: shares, or cash held in another currency.
                const showsUnits = Boolean(account.commodity_mnemonic && account.commodity_mnemonic !== 'USD')
                    && account.ownCommodityBalance !== 0;
                return (
                    <div className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-sm leading-tight text-foreground-secondary" style={TNUM}>
                        {showsUnits ? (
                            <Tip content={account.children.length > 0
                                ? `${account.name}'s own balance in ${account.commodity_mnemonic}, not including sub-accounts`
                                : `Balance in ${account.commodity_mnemonic}`}>
                                <span>{account.ownCommodityBalanceLabel} <span className="text-foreground-muted">{account.commodity_mnemonic}</span></span>
                            </Tip>
                        ) : null}
                    </div>
                );
            },
        },
        {
            id: 'lastReconcileDate',
            header: 'Last Reconciled',
            cell: ({ row }) => (
                <div className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-sm leading-tight text-foreground-secondary">
                    {row.original.lastReconcileDate
                        ? formatDateForDisplay(row.original.lastReconcileDate, dateFormat)
                        : <span className="text-foreground-muted">—</span>}
                </div>
            ),
        },
        {
            id: 'reconciledUsd',
            header: 'Reconciled',
            cell: ({ row }) => (
                <div className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-sm leading-tight text-foreground-secondary" style={TNUM}>
                    {formatCurrency(row.original.reconciledUsd, 'USD')}
                </div>
            ),
        },
        {
            id: 'owner',
            header: 'Owner',
            cell: ({ row }) => {
                const owner = row.original.owner;
                const label = owner
                    ? (owner === 'self' ? selfName : owner === 'spouse' ? spouseName : null)
                        ?? OWNER_BADGE_LABELS[owner]
                    : undefined;
                return (
                    <div className="px-3 py-1.5 text-right text-sm leading-tight">
                        {label ? (
                            <span className="text-foreground-secondary">{label}</span>
                        ) : (
                            <span className="text-foreground-muted">—</span>
                        )}
                    </div>
                );
            },
        },
        {
            id: 'placeholderBadge',
            header: 'Placeholder',
            cell: ({ row }) => (
                <div className="px-3 py-1.5 text-right text-sm leading-tight">
                    {row.original.placeholder === 1 ? (
                        <span className="text-xs text-foreground-secondary">Placeholder</span>
                    ) : (
                        <span className="text-foreground-muted">—</span>
                    )}
                </div>
            ),
        },
    ], [accountTagsMap, compact, dateFormat, filterText, handleRowToggle, isMobile, onOpenAccount, router, selfName, spouseName]);

    const normalizedVisibility = useMemo(() => normalizeVisibility(columnVisibility), [columnVisibility]);
    const normalizedOrder = useMemo(() => normalizeColumnOrder(columnOrder), [columnOrder]);
    // On phones, force the condensed name+balance view so the table fits the
    // viewport without horizontal scrolling. Saved column prefs still apply on
    // desktop.
    const effectiveVisibility = useMemo(
        () => (isMobile ? { ...MOBILE_CONDENSED_COLUMN_VISIBILITY } : compact ? { ...COMPACT_COLUMN_VISIBILITY } : normalizedVisibility),
        [compact, isMobile, normalizedVisibility]
    );

    const table = useReactTable({
        data: filteredAccounts,
        columns,
        state: {
            expanded,
            columnVisibility: effectiveVisibility,
            columnOrder: normalizedOrder,
        },
        getRowId: (row) => row.guid,
        getSubRows: (row) => row.children,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        // There is no pagination; without this, any row-model recompute queues
        // a resetPageIndex() whose state spread re-renders unconditionally.
        autoResetPageIndex: false,
        onColumnVisibilityChange: (updater) => {
            setColumnVisibility((prev) => {
                const next = typeof updater === 'function' ? updater(prev) : updater;
                return normalizeVisibility(next);
            });
        },
        onColumnOrderChange: (updater) => {
            setColumnOrder((prev) => {
                const next = typeof updater === 'function' ? updater(prev) : updater;
                return normalizeColumnOrder(next);
            });
        },
    });

    // Keyboard navigation handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const tag = target?.tagName;
            const isInInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

            // Don't handle keys when focus is inside a popover/dropdown (e.g. BookSwitcher)
            if (target?.closest?.('[data-popover]')) return;

            // Split view: the ledger pane owns the page's keys unless focus is in the tree.
            if (selectedGuid && !rootRef.current?.contains(target)) return;

            // Handle Esc in filter input: clear text first, then blur
            if (isInInput && e.key === 'Escape' && e.target === filterInputRef.current) {
                e.preventDefault();
                if (filterText) {
                    setFilterText('');
                } else {
                    filterInputRef.current?.blur();
                }
                return;
            }

            // '/' to focus filter input (when not in an input)
            if (!isInInput && e.key === '/') {
                e.preventDefault();
                filterInputRef.current?.focus();
                return;
            }

            if (isInInput) return;
            if (modalOpen || deleteConfirm !== null || contextMenu !== null) return;

            const rows = table.getRowModel().rows;
            if (rows.length === 0) return;

            switch (e.key) {
                case 'ArrowDown':
                case 'j': {
                    e.preventDefault();
                    setFocusedRowIndex(prev => Math.min(prev + 1, rows.length - 1));
                    break;
                }
                case 'ArrowUp':
                case 'k': {
                    e.preventDefault();
                    setFocusedRowIndex(prev => Math.max(prev - 1, 0));
                    break;
                }
                case 'Enter': {
                    if (focusedRowIndex < 0 || focusedRowIndex >= rows.length) break;
                    e.preventDefault();
                    if (onOpenAccount) onOpenAccount(rows[focusedRowIndex].original.guid);
                    else router.push(`/accounts/${rows[focusedRowIndex].original.guid}`);
                    break;
                }
                case 'ArrowRight':
                case 'l': {
                    if (focusedRowIndex < 0 || focusedRowIndex >= rows.length) break;
                    const row = rows[focusedRowIndex];
                    if (row.getCanExpand() && !row.getIsExpanded()) {
                        e.preventDefault();
                        handleRowToggle(row.original.guid, false);
                    }
                    break;
                }
                case 'ArrowLeft':
                case 'h': {
                    if (focusedRowIndex < 0 || focusedRowIndex >= rows.length) break;
                    const row = rows[focusedRowIndex];
                    if (row.getIsExpanded()) {
                        e.preventDefault();
                        handleRowToggle(row.original.guid, true);
                    } else if (row.depth > 0) {
                        // Move to parent row
                        e.preventDefault();
                        const parentId = row.parentId;
                        if (parentId) {
                            const parentIndex = rows.findIndex(r => r.id === parentId);
                            if (parentIndex >= 0) setFocusedRowIndex(parentIndex);
                        }
                    }
                    break;
                }
                case 'Escape': {
                    setFocusedRowIndex(-1);
                    break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedRowIndex, modalOpen, deleteConfirm, contextMenu, table, handleRowToggle, router, filterText, onOpenAccount, selectedGuid]);

    // Auto-scroll focused row into view
    useEffect(() => {
        if (focusedRowIndex >= 0) {
            const el = rowRefs.current.get(focusedRowIndex);
            el?.scrollIntoView({ block: 'nearest' });
        }
    }, [focusedRowIndex]);

    // Focus row from query param (e.g. navigating back from ledger)
    const hasFocusExpanded = useRef(false);
    useEffect(() => {
        if (!focusGuid) {
            hasFocusExpanded.current = false;
            return;
        }

        const rows = table.getRowModel().rows;
        const idx = rows.findIndex(r => r.original.guid === focusGuid);
        if (idx >= 0) {
            setFocusedRowIndex(idx);
            hasFocusExpanded.current = false;
            // Clean up the query param
            router.replace('/accounts', { scroll: false });
            return;
        }

        // Row not visible - expand ancestors (only try once to avoid infinite loop)
        if (!hasFocusExpanded.current) {
            hasFocusExpanded.current = true;
            const path = findAncestorPath(accounts, focusGuid);
            if (path && path.length > 0) {
                setManualExpanded(prev => {
                    const next = { ...prev };
                    for (const guid of path) {
                        next[guid] = true;
                    }
                    return next;
                });
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusGuid, expanded, accounts]);

    const depthValue = expandToDepth === Infinity ? 'all' : String(expandToDepth);
    // On very wide screens a full-width name column strands the balances
    // ~1,000px from their names; a trailing filler column packs the numbers
    // beside the names instead (DESIGN.md "Data surfaces").
    const packWide = !isMobile && !compact;
    const viewFilterCount = (showToReview ? 1 : 0) + (showHidden ? 1 : 0);

    return (
        <div ref={rootRef} className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
                <div className="flex flex-wrap items-center gap-2">
                    {headerActions}
                    <Tip content={isReadonly ? READONLY_TOOLTIP : undefined}>
                    <button
                        type="button"
                        onClick={handleNewAccount}
                        disabled={isReadonly}
                        className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New<span className="hidden sm:inline"> Account</span>
                    </button>
                    </Tip>
                </div>
            </header>

            <section className="-mx-4 border-y border-border bg-surface sm:mx-0 sm:rounded-lg sm:border-x">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
                    <div className={`relative w-full ${compact ? '' : 'sm:w-auto sm:min-w-[14rem] sm:max-w-[28rem] sm:flex-[1_1_18rem]'}`}>
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={1.75}>
                            <circle cx="7" cy="7" r="4.25" />
                            <path strokeLinecap="round" d="m10.25 10.25 3 3" />
                        </svg>
                        <input
                            ref={filterInputRef}
                            type="search"
                            aria-label="Filter accounts"
                            placeholder="Filter accounts"
                            className={inputClass({ extra: 'h-9 py-0 pl-8 pr-9 [&::-webkit-search-cancel-button]:hidden' })}
                            value={filterText}
                            onChange={(event) => setFilterText(event.target.value)}
                        />
                        {filterText ? (
                            <button
                                type="button"
                                onClick={() => setFilterText('')}
                                aria-label="Clear filter"
                                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                            >
                                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" d="m4 4 8 8M12 4l-8 8" />
                                </svg>
                            </button>
                        ) : (
                            <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border border-border px-1.5 font-mono text-[11px] leading-4 text-foreground-muted sm:block">
                                /
                            </kbd>
                        )}
                    </div>

                    <Segmented
                        ariaLabel="Expand to depth"
                        options={DEPTH_OPTIONS}
                        value={depthValue}
                        onChange={(value) => {
                            setExpandToDepth(value === 'all' ? Infinity : parseInt(value, 10));
                            setManualExpanded({});
                        }}
                    />

                    {showToReview && (
                        <button
                            type="button"
                            onClick={() => setShowToReview(false)}
                            className="flex h-9 items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 text-xs font-medium text-warning hover:bg-warning/15 sm:h-8"
                            aria-label="Showing accounts with transactions to review. Show all accounts"
                        >
                            To review only
                            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" d="m4 4 8 8M12 4l-8 8" />
                            </svg>
                        </button>
                    )}

                    <div className="relative ml-auto" ref={viewMenuRef}>
                        <button
                            type="button"
                            onClick={() => setIsViewMenuOpen((prev) => !prev)}
                            aria-haspopup="true"
                            aria-expanded={isViewMenuOpen}
                            className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors sm:h-8 ${
                                isViewMenuOpen || viewFilterCount > 0
                                    ? 'border-primary/40 bg-primary-light text-primary'
                                    : 'border-border text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
                            }`}
                        >
                            View
                            {viewFilterCount > 0 && (
                                <span className="font-mono" style={TNUM}>· {viewFilterCount}</span>
                            )}
                            <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3 w-3 transition-transform duration-150 ${isViewMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4 6 4 4 4-4" />
                            </svg>
                        </button>
                        {isViewMenuOpen && (
                            <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-surface-elevated py-1 shadow-lg">
                                <ViewMenuCheck
                                    checked={showToReview}
                                    onChange={setShowToReview}
                                    label="To review only"
                                    hint="Accounts with unreviewed imported transactions"
                                />
                                <ViewMenuCheck
                                    checked={showHidden}
                                    onChange={setShowHidden}
                                    label="Show hidden accounts"
                                />
                                {/* Column customisation targets the desktop table; phones and the split pane use a fixed name + balance layout. */}
                                {!isMobile && !compact && (
                                    <>
                                        <div className="mx-3 my-1 border-t border-border" />
                                        <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-foreground-secondary">
                                            Columns <span className="font-normal text-foreground-muted">· drag to reorder</span>
                                        </div>
                                        {table.getAllLeafColumns().map((column) => {
                                            const isRequired = ALWAYS_VISIBLE_COLUMNS.includes(column.id as ColumnId);
                                            const label = String(column.columnDef.header);
                                            const draggable = column.id !== 'accountName';
                                            const visible = column.getIsVisible();

                                            return (
                                                <div
                                                    key={column.id}
                                                    draggable={draggable}
                                                    onDragStart={() => {
                                                        if (draggable) setDraggedColumnId(column.id as ColumnId);
                                                    }}
                                                    onDragEnd={() => setDraggedColumnId(null)}
                                                    onDragOver={(event) => {
                                                        if (!draggable || !draggedColumnId) return;
                                                        event.preventDefault();
                                                    }}
                                                    onDrop={(event) => {
                                                        if (!draggable || !draggedColumnId) return;
                                                        event.preventDefault();
                                                        moveColumn(draggedColumnId, column.id as ColumnId);
                                                        setDraggedColumnId(null);
                                                    }}
                                                    className={`flex items-center gap-1 pr-3 ${draggedColumnId === column.id ? 'opacity-50' : ''}`}
                                                >
                                                    <span aria-hidden="true" className={`w-5 shrink-0 pl-2 text-xs ${draggable ? 'cursor-grab text-foreground-muted' : 'text-transparent'}`}>
                                                        ⋮⋮
                                                    </span>
                                                    <button
                                                        type="button"
                                                        role="checkbox"
                                                        aria-checked={visible}
                                                        disabled={isRequired}
                                                        onClick={() => column.toggleVisibility(!visible)}
                                                        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1.5 text-left text-sm text-foreground-secondary hover:bg-surface-hover hover:text-foreground disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                                                    >
                                                        <CheckboxBox checked={visible} />
                                                        <span className="truncate">{label}</span>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className={`w-full ${isMobile || compact ? 'table-fixed' : 'table-auto md:min-w-[760px]'}`}>
                        {(isMobile || compact) && (
                            <colgroup>
                                <col />
                                <col className="w-32" />
                            </colgroup>
                        )}
                        <thead className="border-b border-border">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => {
                                        const columnId = header.column.id;
                                        const sortColumnKey = SORT_KEY_BY_COLUMN[columnId];
                                        const isSorted = sortColumnKey !== undefined && sortColumnKey === sortKey;
                                        const isNumeric = columnId !== 'accountName';
                                        const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                                        return (
                                            <th
                                                key={header.id}
                                                scope="col"
                                                aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                                                className={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-foreground-secondary ${
                                                    isNumeric ? 'whitespace-nowrap text-right' : `w-full text-left ${packWide ? 'min-[1800px]:w-auto min-[1800px]:min-w-[32rem]' : ''}`
                                                } ${columnId === 'accountName' ? 'pl-4' : ''}`}
                                            >
                                                {sortColumnKey ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSortColumn(sortColumnKey)}
                                                        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground ${isSorted ? 'text-foreground' : ''}`}
                                                    >
                                                        {label}
                                                        <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3 w-3 ${isSorted ? '' : 'opacity-0'} ${isSorted && sortDir === 'desc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m4 10 4-4 4 4" />
                                                        </svg>
                                                    </button>
                                                ) : label}
                                            </th>
                                        );
                                    })}
                                    {packWide && <th aria-hidden="true" className="hidden w-full p-0 min-[1800px]:table-cell" />}
                                </tr>
                            ))}
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {table.getRowModel().rows.map((row, rowIndex) => {
                                const isSelected = selectedGuid === row.original.guid;
                                return (
                                    <tr
                                        key={row.id}
                                        ref={(el) => {
                                            if (el) rowRefs.current.set(rowIndex, el);
                                            else rowRefs.current.delete(rowIndex);
                                        }}
                                        aria-selected={onOpenAccount ? isSelected : undefined}
                                        className={`group transition-colors ${row.getCanExpand() ? 'cursor-pointer' : ''} ${
                                            isSelected ? 'bg-primary-light' : 'hover:bg-surface-hover/60'
                                        } ${rowIndex === focusedRowIndex ? 'outline outline-2 -outline-offset-2 outline-primary/60' : ''}`}
                                        onClick={() => {
                                            setFocusedRowIndex(rowIndex);
                                            if (row.getCanExpand()) {
                                                handleRowToggle(row.original.guid, row.getIsExpanded());
                                            } else if (onOpenAccount) {
                                                onOpenAccount(row.original.guid);
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            setFocusedRowIndex(rowIndex);
                                            openContextMenu(e, row.original);
                                        }}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <td key={cell.id} className="min-w-0 align-middle">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                        {packWide && <td aria-hidden="true" className="hidden p-0 min-[1800px]:table-cell" />}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {table.getRowModel().rows.length === 0 && (
                    <div className="px-4 py-12 text-center text-sm text-foreground-secondary">
                        No accounts match the current filters.
                        {(filterText || showToReview) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setFilterText('');
                                    setShowToReview(false);
                                }}
                                className="ml-2 font-medium text-primary hover:text-primary-hover"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                )}
            </section>

            <TransactionContextMenu
                isOpen={!!contextMenu}
                x={contextMenu?.x ?? 0}
                y={contextMenu?.y ?? 0}
                items={contextMenuItems}
                onClose={() => setContextMenu(null)}
                ariaLabel="Account actions"
            />

            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={modalMode === 'create' ? 'Create Account' : 'Edit Account'}
                size="lg"
            >
                <div className="p-6">
                    <AccountForm
                        mode={modalMode}
                        accountGuid={selectedAccount?.guid}
                        initialData={selectedAccount ? {
                            name: selectedAccount.name,
                            account_type: selectedAccount.account_type,
                            parent_guid: selectedAccount.parent_guid,
                            commodity_guid: selectedAccount.commodity_guid,
                            code: selectedAccount.code,
                            description: selectedAccount.description,
                            hidden: selectedAccount.hidden,
                            placeholder: selectedAccount.placeholder,
                            commodity_scu: selectedAccount.commodity_scu,
                            notes: (selectedAccount as unknown as { notes?: string }).notes ?? '',
                            tax_related: (selectedAccount as unknown as { tax_related?: boolean }).tax_related ?? false,
                            is_retirement: (selectedAccount as unknown as { is_retirement?: boolean }).is_retirement ?? false,
                            retirement_account_type: (selectedAccount as unknown as { retirement_account_type?: string | null }).retirement_account_type ?? null,
                            is_card_payment_source: (selectedAccount as unknown as { is_card_payment_source?: boolean }).is_card_payment_source ?? false,
                        } : undefined}
                        parentGuid={parentGuid}
                        onSave={handleSave}
                        onCancel={() => setModalOpen(false)}
                    />
                </div>
            </Modal>

            <Modal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                title="Delete Account"
                size="sm"
            >
                <div className="p-6 space-y-4">
                    {deleteError && (
                        <div className="bg-error/10 border border-error/30 rounded-lg p-4 text-error text-sm">
                            {deleteError}
                        </div>
                    )}
                    <p className="text-foreground-secondary">
                        Are you sure you want to delete <strong className="text-foreground">{deleteConfirm?.name}</strong>?
                    </p>
                    <p className="text-sm text-foreground-muted">
                        This action cannot be undone. Accounts with transactions cannot be deleted.
                    </p>
                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-4 py-2 text-sm text-foreground-secondary hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="px-4 py-2 text-sm bg-error hover:bg-error/85 disabled:bg-error/50 text-primary-foreground rounded-lg transition-colors"
                        >
                            {deleting ? 'Deleting...' : 'Delete Account'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

/** A checkbox row in the View menu. */
function ViewMenuCheck({ checked, onChange, label, hint }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    hint?: string;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-hover"
        >
            <span className="mt-0.5"><CheckboxBox checked={checked} /></span>
            <span className="min-w-0">
                <span className="block text-sm text-foreground">{label}</span>
                {hint && <span className="block text-xs text-foreground-secondary">{hint}</span>}
            </span>
        </button>
    );
}
