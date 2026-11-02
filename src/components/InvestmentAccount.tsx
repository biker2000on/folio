'use client';

/**
 * Investment-account pieces of the account ledger page. The page is a ledger
 * first (owner decision, 2026-11-02): the security summary lives in the page
 * header and a compact KPI strip, the transactions come next, and the price
 * chart is a collapsible panel under them.
 *
 * All three read one cached valuation query, so they never disagree and the
 * page makes one request for them.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/format';
import {
    CostBasisCoverageMark,
    CoveredSliceNote,
    gainHeading,
    ShortPositionMark,
    ShortBasisNote,
    BASIS_CONSEQUENCE,
} from '@/components/investments/CostBasisCoverageMark';
import { CHART_THEME, KpiCard, Segmented, signTone } from '@/components/investments/ui';
import type { CostBasisCoverage, PositionSide } from '@/lib/holdings-coverage';
import { useToast } from '@/contexts/ToastContext';
import { Modal } from './ui/Modal';
import { Tip } from './ui/Tooltip';
import { inputClass, LABEL } from './ui/form';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, AreaChart, Area, ReferenceLine, CartesianGrid } from 'recharts';
import type { CategoricalChartFunc } from 'recharts/types/chart/types';
import { formatDateForDisplay, parseDateInput } from '@/lib/date-format';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { toLocalDateString } from '@/lib/datePresets';
import { extractErrorMessage } from '@/lib/api-error';

interface PriceData {
    guid: string;
    date: string;
    value: number;
    source: string | null;
}

export interface ValuationData {
    isInvestment: boolean;
    account: {
        guid: string;
        name: string;
        account_type: string;
    };
    commodity?: {
        guid: string;
        namespace: string;
        mnemonic: string;
        fullname: string | null;
        fraction: number;
    };
    holdings?: {
        shares: number;
        /** Basis of the shares `costBasisCoverage` describes, not always all of them. */
        costBasis: number;
        costBasisCoverage: CostBasisCoverage;
        /** `short` marks a position whose `costBasis` is proceeds, not cost. */
        positionSide?: PositionSide;
        marketValue: number;
        /** Gain of the covered shares; see `costBasisCoverage`. */
        gainLoss: number;
        gainLossPercent: number;
        latestPrice: PriceData | null;
    };
    priceHistory?: PriceData[];
}

/**
 * The account's valuation (holdings, latest price, price history). Keyed
 * under ['accounts', 'balances'] so ledger writes, which invalidate that
 * prefix, refresh it.
 */
export function valuationQueryKey(accountGuid: string) {
    return ['accounts', 'balances', accountGuid, 'valuation'] as const;
}

export function useAccountValuation(accountGuid: string, enabled = true) {
    return useQuery<ValuationData>({
        queryKey: valuationQueryKey(accountGuid),
        queryFn: async () => {
            const res = await fetch(`/api/accounts/${accountGuid}/valuation?days=36500`);
            if (!res.ok) throw new Error('Failed to fetch valuation');
            return res.json() as Promise<ValuationData>;
        },
        enabled,
        staleTime: 1000 * 60,
    });
}

function formatShares(shares: number): string {
    return shares.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPriceDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Header line: security name, last price, price actions
// ---------------------------------------------------------------------------

/**
 * One line under the page title: the security's full name and last price,
 * with Fetch Price / Add Price as icon buttons.
 */
export function InvestmentSecurityLine({ accountGuid }: { accountGuid: string }) {
    const { data } = useAccountValuation(accountGuid);
    const queryClient = useQueryClient();
    const { success, error: showError } = useToast();
    const { dateFormat } = useUserPreferences();
    const [fetchingPrice, setFetchingPrice] = useState(false);
    const [showPriceModal, setShowPriceModal] = useState(false);
    const [newPrice, setNewPrice] = useState({ date: '', value: '' });
    const [priceDisplayDate, setPriceDisplayDate] = useState('');
    const [savingPrice, setSavingPrice] = useState(false);
    const [priceError, setPriceError] = useState<string | null>(null);

    const refresh = useCallback(
        () => queryClient.invalidateQueries({ queryKey: valuationQueryKey(accountGuid) }),
        [accountGuid, queryClient],
    );

    if (!data?.isInvestment || !data.commodity) return null;
    const { commodity, holdings } = data;

    const handleFetchPrice = async () => {
        setFetchingPrice(true);
        try {
            const response = await fetch('/api/prices/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: [commodity.mnemonic] }),
            });
            const responseData = await response.json();

            if (!response.ok) {
                showError(extractErrorMessage(responseData, 'Failed to fetch price'));
                return;
            }
            if (responseData.queued) {
                success('Price refresh queued');
                return;
            }
            if (responseData.stored > 0) {
                await refresh();
                success(
                    `Updated ${responseData.results?.[0]?.symbol || commodity.mnemonic}: ${responseData.stored} historical price${responseData.stored === 1 ? '' : 's'} stored`
                );
            } else {
                const result = responseData.results?.[0];
                if (result?.success === false) {
                    showError(result.error || 'Failed to fetch price');
                } else {
                    success(`${commodity.mnemonic} is already up to date`);
                    await refresh();
                }
            }
        } catch {
            showError('Network error fetching price');
        } finally {
            setFetchingPrice(false);
        }
    };

    const openAddPrice = () => {
        const today = toLocalDateString(new Date());
        setNewPrice({ date: today, value: '' });
        setPriceDisplayDate(formatDateForDisplay(today, dateFormat));
        setPriceError(null);
        setShowPriceModal(true);
    };

    const handleAddPrice = async () => {
        if (!newPrice.date || !newPrice.value) return;

        setSavingPrice(true);
        setPriceError(null);
        try {
            // Find USD currency for pricing
            const commoditiesRes = await fetch('/api/commodities');
            const commodities = await commoditiesRes.json();
            const usd = commodities.find((c: { mnemonic: string; namespace: string }) =>
                c.mnemonic === 'USD' && c.namespace === 'CURRENCY'
            );
            if (!usd) throw new Error('USD currency not found');

            const res = await fetch('/api/prices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commodity_guid: commodity.guid,
                    currency_guid: usd.guid,
                    date: newPrice.date,
                    value: parseFloat(newPrice.value),
                }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(extractErrorMessage(err, 'Failed to add price'));
            }

            setShowPriceModal(false);
            setNewPrice({ date: '', value: '' });
            success(`Added ${commodity.mnemonic} price`);
            void refresh();
        } catch (err) {
            setPriceError(err instanceof Error ? err.message : 'Failed to add price');
        } finally {
            setSavingPrice(false);
        }
    };

    const iconButton = 'flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50';

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-secondary">
            {commodity.fullname && <span className="truncate">{commodity.fullname}</span>}
            {commodity.fullname && holdings?.latestPrice && <span aria-hidden="true" className="text-foreground-muted">·</span>}
            {holdings?.latestPrice ? (
                <span className="whitespace-nowrap">
                    <span className="font-mono text-foreground" style={{ fontFeatureSettings: "'tnum'" }}>
                        {formatCurrency(holdings.latestPrice.value, 'USD')}
                    </span>{' '}
                    on {formatPriceDate(holdings.latestPrice.date)}
                </span>
            ) : (
                <span>No price yet</span>
            )}
            <span className="flex items-center">
                <Tip content={fetchingPrice ? 'Fetching price…' : `Fetch the latest ${commodity.mnemonic} price`} describedBy={false}>
                    <button
                        type="button"
                        onClick={handleFetchPrice}
                        disabled={fetchingPrice}
                        aria-label="Fetch price"
                        className={iconButton}
                    >
                        <svg aria-hidden="true" className={`h-4 w-4 ${fetchingPrice ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </Tip>
                <Tip content="Add a price by hand" describedBy={false}>
                    <button type="button" onClick={openAddPrice} aria-label="Add price" className={iconButton}>
                        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </Tip>
            </span>

            <Modal isOpen={showPriceModal} onClose={() => setShowPriceModal(false)} title={`Add ${commodity.mnemonic} Price`} size="sm">
                <div className="space-y-4 p-5">
                    <div>
                        <label htmlFor="add-price-date" className={LABEL}>Date</label>
                        <input
                            id="add-price-date"
                            type="text"
                            value={priceDisplayDate}
                            onChange={e => setPriceDisplayDate(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => {
                                const parsed = parseDateInput(priceDisplayDate);
                                if (parsed) {
                                    setNewPrice(prev => ({ ...prev, date: parsed }));
                                    setPriceDisplayDate(formatDateForDisplay(parsed, dateFormat));
                                } else if (newPrice.date) {
                                    setPriceDisplayDate(formatDateForDisplay(newPrice.date, dateFormat));
                                }
                            }}
                            placeholder="MM/DD/YYYY"
                            className={inputClass()}
                        />
                    </div>
                    <div>
                        <label htmlFor="add-price-value" className={LABEL}>Price (USD)</label>
                        <input
                            id="add-price-value"
                            type="number"
                            step="0.01"
                            value={newPrice.value}
                            onChange={e => setNewPrice(prev => ({ ...prev, value: e.target.value }))}
                            placeholder="0.00"
                            className={inputClass({ extra: 'font-mono' })}
                        />
                    </div>
                    {priceError && <p className="text-sm text-error" role="alert">{priceError}</p>}
                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setShowPriceModal(false)}
                            className="px-4 py-2 text-sm text-foreground-secondary transition-colors hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleAddPrice}
                            disabled={savingPrice || !newPrice.date || !newPrice.value}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                        >
                            {savingPrice ? 'Saving…' : 'Add Price'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

/** Shares · cost basis · market value · gain, each a link to its explanation. */
export function InvestmentKpis({ accountGuid }: { accountGuid: string }) {
    const { data, isLoading, error } = useAccountValuation(accountGuid);

    if (isLoading) {
        return <div className="h-[104px] animate-pulse rounded-lg border border-border bg-surface" aria-hidden="true" />;
    }
    if (error) {
        return (
            <div className="rounded-lg border border-error/40 bg-surface px-4 py-3 text-sm text-error" role="alert">
                Could not load holdings: {error instanceof Error ? error.message : 'request failed'}
            </div>
        );
    }
    const holdings = data?.holdings;
    if (!data?.isInvestment || !holdings) return null;

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
                label="Shares"
                value={formatShares(holdings.shares)}
                sub={data.commodity?.mnemonic}
                href="?view=lots#ledger"
                cta="View lots"
            />
            <KpiCard
                label="Cost basis"
                value={formatCurrency(Math.abs(holdings.costBasis), 'USD')}
                adornment={
                    <>
                        {/* Says what this number IS: on a short position it is the
                            proceeds received for shares sold before they were owned. */}
                        <ShortPositionMark positionSide={holdings.positionSide} />
                        {/* Names the shares this basis (and the gain beside it) leaves out. */}
                        <CostBasisCoverageMark coverage={holdings.costBasisCoverage} consequence={BASIS_CONSEQUENCE} />
                    </>
                }
                sub={<ShortBasisNote positionSide={holdings.positionSide} />}
                href="?view=lots#ledger"
                cta="Lot detail"
            />
            <KpiCard
                label="Market value"
                value={formatCurrency(holdings.marketValue, 'USD')}
                tone={signTone(holdings.marketValue)}
                sub={holdings.latestPrice ? `at ${formatCurrency(holdings.latestPrice.value, 'USD')}` : 'No price yet'}
                href="#price-history"
                cta="Price history"
            />
            <KpiCard
                // The heading names the slice: this is the gain on the shares the
                // basis covers, beside a whole-position share count and value.
                label={gainHeading(holdings.costBasisCoverage)}
                value={`${holdings.gainLoss >= 0 ? '+' : ''}${formatCurrency(holdings.gainLoss, 'USD')}`}
                tone={signTone(holdings.gainLoss)}
                adornment={<CostBasisCoverageMark coverage={holdings.costBasisCoverage} consequence={BASIS_CONSEQUENCE} />}
                sub={
                    <>
                        {holdings.gainLoss >= 0 ? '+' : ''}{holdings.gainLossPercent.toFixed(2)}%
                        <CoveredSliceNote coverage={holdings.costBasisCoverage} />
                    </>
                }
                href="/reports/investment_lots"
                cta="Lots report"
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Price chart (collapsible, follows the page date range)
// ---------------------------------------------------------------------------

const CHART_OPEN_KEY = 'investmentAccount.priceChartOpen';

/**
 * Price history for the page's date range, in a panel that is closed by
 * default (the ledger comes first). The open state is remembered, and a
 * `#price-history` link (the Market value KPI) opens it.
 */
export function InvestmentPriceChart({
    accountGuid,
    startDate,
    endDate,
}: {
    accountGuid: string;
    startDate?: string | null;
    endDate?: string | null;
}) {
    const { data } = useAccountValuation(accountGuid);
    // The panel only renders once the valuation has loaded client-side, so
    // reading storage and the hash in the initialiser cannot mismatch SSR.
    const [open, setOpen] = useState(() => {
        if (typeof window === 'undefined') return false;
        if (window.location.hash === '#price-history') return true;
        try { return localStorage.getItem(CHART_OPEN_KEY) === '1'; } catch { return false; }
    });
    const [chartMode, setChartMode] = useState<'price' | 'percentChange'>('price');

    useEffect(() => {
        const openFromHash = () => {
            if (window.location.hash === '#price-history') setOpen(true);
        };
        window.addEventListener('hashchange', openFromHash);
        return () => window.removeEventListener('hashchange', openFromHash);
    }, []);

    const toggle = () => {
        setOpen(prev => {
            const next = !prev;
            try { localStorage.setItem(CHART_OPEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    // Index-based zoom state
    interface ZoomDomain {
        startIndex: number | null;
        endIndex: number | null;
    }
    // Zoom belongs to one date range; a new range starts unzoomed.
    const rangeKey = `${startDate ?? ''}|${endDate ?? ''}`;
    const [zoom, setZoom] = useState<ZoomDomain & { rangeKey: string }>({ rangeKey, startIndex: null, endIndex: null });
    const zoomDomain: ZoomDomain = zoom.rangeKey === rangeKey ? zoom : { startIndex: null, endIndex: null };
    const setZoomDomain = useCallback((next: ZoomDomain) => setZoom({ rangeKey, ...next }), [rangeKey]);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [dragEnd, setDragEnd] = useState<number | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);

    // The page's date range drives the chart; no second period control.
    const filteredPriceHistory = useMemo(() => {
        const history = data?.priceHistory ?? [];
        return history.filter(p => {
            const day = p.date.slice(0, 10);
            return (!startDate || day >= startDate) && (!endDate || day <= endDate);
        });
    }, [data?.priceHistory, startDate, endDate]);

    const chartData = useMemo(() => {
        if (!filteredPriceHistory.length) return [];
        if (zoomDomain.startIndex === null && zoomDomain.endIndex === null) return filteredPriceHistory;
        const start = zoomDomain.startIndex ?? 0;
        const end = zoomDomain.endIndex ?? filteredPriceHistory.length;
        return filteredPriceHistory.slice(start, end + 1);
    }, [filteredPriceHistory, zoomDomain.startIndex, zoomDomain.endIndex]);

    const displayChartData = useMemo(() => {
        if (chartMode === 'price' || chartData.length === 0) return chartData;
        const firstValue = chartData[0].value;
        if (firstValue === 0) return chartData;
        return chartData.map(point => ({
            ...point,
            value: ((point.value - firstValue) / firstValue) * 100,
        }));
    }, [chartData, chartMode]);

    const handleMouseDown = useCallback<CategoricalChartFunc>((nextState) => {
        if (nextState.activeTooltipIndex !== undefined) {
            setIsDragging(true);
            setDragStart(nextState.activeTooltipIndex as number);
            setDragEnd(nextState.activeTooltipIndex as number);
        }
    }, []);

    const handleMouseMove = useCallback<CategoricalChartFunc>((nextState) => {
        if (isDragging && nextState.activeTooltipIndex !== undefined) {
            setDragEnd(nextState.activeTooltipIndex as number);
        }
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        if (isDragging && dragStart !== null && dragEnd !== null && dragStart !== dragEnd) {
            setZoomDomain({ startIndex: Math.min(dragStart, dragEnd), endIndex: Math.max(dragStart, dragEnd) });
        }
        setIsDragging(false);
        setDragStart(null);
        setDragEnd(null);
    }, [isDragging, dragStart, dragEnd, setZoomDomain]);

    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        const dataLength = filteredPriceHistory.length;
        if (dataLength < 2) return;

        const currentStart = zoomDomain.startIndex ?? 0;
        const currentEnd = zoomDomain.endIndex ?? dataLength - 1;
        const currentLength = currentEnd - currentStart + 1;

        // Scroll up zooms in, scroll down zooms out
        const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
        const newLength = Math.max(5, Math.min(dataLength, Math.round(currentLength * zoomFactor)));
        if (newLength >= dataLength) {
            setZoomDomain({ startIndex: null, endIndex: null });
            return;
        }

        const center = Math.floor((currentStart + currentEnd) / 2);
        const halfNew = Math.floor(newLength / 2);
        const newStart = Math.max(0, Math.min(dataLength - newLength, center - halfNew));
        const newEnd = Math.min(dataLength - 1, newStart + newLength - 1);
        setZoomDomain({ startIndex: newStart, endIndex: newEnd });
    }, [filteredPriceHistory.length, zoomDomain.startIndex, zoomDomain.endIndex, setZoomDomain]);

    if (!data?.isInvestment || !data.priceHistory?.length) return null;

    const isZoomed = zoomDomain.startIndex !== null || zoomDomain.endIndex !== null;
    const lastValue = displayChartData[displayChartData.length - 1]?.value ?? 0;
    // % mode: line colour follows the sign of the change over the range.
    const percentColor = lastValue < 0 ? 'var(--negative)' : 'var(--positive)';
    const shortDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const longDate = (date: string) => new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const dragArea = isDragging && dragStart !== null && dragEnd !== null && (
        <ReferenceArea
            x1={chartData[Math.min(dragStart, dragEnd)]?.date}
            x2={chartData[Math.max(dragStart, dragEnd)]?.date}
            strokeOpacity={0}
            fill="var(--primary)"
            fillOpacity={0.12}
        />
    );

    return (
        <section id="price-history" className="scroll-mt-4 rounded-lg border border-border bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    aria-controls="price-history-body"
                    className="-ml-1 flex items-center gap-2 rounded-sm px-1 py-1 text-sm font-semibold text-foreground hover:text-primary"
                >
                    <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5 10.5 8 6 12.5" />
                    </svg>
                    {data.commodity?.mnemonic} price history
                    <span className="text-xs font-normal text-foreground-secondary">
                        {filteredPriceHistory.length > 0
                            ? `${filteredPriceHistory.length} price${filteredPriceHistory.length === 1 ? '' : 's'} in range`
                            : 'No prices in this range'}
                    </span>
                </button>
                {open && filteredPriceHistory.length > 0 && (
                    <div className="flex items-center gap-2">
                        {isZoomed && (
                            <button
                                type="button"
                                onClick={() => setZoomDomain({ startIndex: null, endIndex: null })}
                                className="h-7 rounded-md px-2.5 text-xs font-medium text-foreground-secondary hover:bg-surface-hover hover:text-foreground"
                            >
                                Reset zoom
                            </button>
                        )}
                        <Segmented
                            ariaLabel="Chart units"
                            value={chartMode}
                            onChange={setChartMode}
                            options={[
                                { value: 'price', label: '$', ariaLabel: 'Price', hint: 'Price per share' },
                                { value: 'percentChange', label: '%', ariaLabel: 'Percent change', hint: 'Change since the start of the range' },
                            ]}
                        />
                    </div>
                )}
            </header>
            {open && (
                <div id="price-history-body" className="border-t border-border p-4 sm:p-5">
                    {filteredPriceHistory.length === 0 ? (
                        <p className="py-8 text-center text-sm text-foreground-secondary">
                            No {data.commodity?.mnemonic} prices fall in this date range.
                        </p>
                    ) : (
                        <div ref={chartContainerRef} className="h-64 select-none" onWheel={handleWheel}>
                            <ResponsiveContainer width="100%" height="100%">
                                {chartMode === 'percentChange' ? (
                                    <AreaChart
                                        data={displayChartData}
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={handleMouseUp}
                                        onMouseLeave={handleMouseUp}
                                    >
                                        <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="date" tick={CHART_THEME.tick} tickFormatter={shortDate} stroke={CHART_THEME.axis} />
                                        <YAxis
                                            tick={CHART_THEME.tick}
                                            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                                            stroke={CHART_THEME.axis}
                                            domain={['auto', 'auto']}
                                            width={64}
                                        />
                                        <Tooltip
                                            {...CHART_THEME.tooltip}
                                            formatter={(value) => [`${Number(value).toFixed(2)}%`, 'Change']}
                                            labelFormatter={(label) => longDate(String(label))}
                                        />
                                        <ReferenceLine y={0} stroke={CHART_THEME.zeroLine} strokeDasharray="3 3" />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke={percentColor}
                                            fill={percentColor}
                                            fillOpacity={0.1}
                                            strokeWidth={2}
                                            dot={false}
                                            activeDot={{ r: 4, fill: percentColor }}
                                            animationDuration={300}
                                            baseValue={0}
                                        />
                                        {dragArea}
                                    </AreaChart>
                                ) : (
                                    <LineChart
                                        data={displayChartData}
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={handleMouseUp}
                                        onMouseLeave={handleMouseUp}
                                    >
                                        <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="date" tick={CHART_THEME.tick} tickFormatter={shortDate} stroke={CHART_THEME.axis} />
                                        <YAxis
                                            tick={CHART_THEME.tick}
                                            tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                                            stroke={CHART_THEME.axis}
                                            domain={['auto', 'auto']}
                                            width={72}
                                        />
                                        <Tooltip
                                            {...CHART_THEME.tooltip}
                                            formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Price']}
                                            labelFormatter={(label) => longDate(String(label))}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="value"
                                            stroke="var(--primary)"
                                            strokeWidth={2}
                                            dot={false}
                                            activeDot={{ r: 4, fill: 'var(--primary)' }}
                                            animationDuration={300}
                                        />
                                        {dragArea}
                                    </LineChart>
                                )}
                            </ResponsiveContainer>
                        </div>
                    )}
                    <p className="mt-2 text-xs text-foreground-secondary">Drag across the chart to zoom; scroll to zoom in and out.</p>
                </div>
            )}
        </section>
    );
}
