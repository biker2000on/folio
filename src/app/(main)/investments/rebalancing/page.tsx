'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/lib/format';
import type { RebalanceTarget } from '@/lib/rebalancing';
import type { RebalanceMode } from '@/lib/rebalancing-sector';
import type { RebalanceData } from './types';
import { TargetEditor } from './TargetEditor';
import { DriftBars } from './DriftBars';
import { SuggestionsTable } from './SuggestionsTable';
import { SectorSuggestionsTable } from './SectorSuggestionsTable';
import { inputClass } from '@/components/ui/form';
import { EmptyState, InvestmentsPage, KpiCard, Panel, Segmented } from '@/components/investments/ui';

const CONTROL_LABEL = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-muted';

function parseTargets(inputs: Record<string, string>): RebalanceTarget[] {
    return Object.entries(inputs)
        .map(([key, value]) => ({ key, targetPct: parseFloat(value) }))
        .filter(t => Number.isFinite(t.targetPct) && t.targetPct > 0);
}

function sameTargets(a: RebalanceTarget[], b: RebalanceTarget[]): boolean {
    if (a.length !== b.length) return false;
    const bMap = new Map(b.map(t => [t.key, t.targetPct]));
    return a.every(t => Math.abs((bMap.get(t.key) ?? -1) - t.targetPct) < 0.001);
}

function inputsFromTargets(targets: RebalanceTarget[]): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const t of targets) inputs[t.key] = String(t.targetPct);
    return inputs;
}

export default function RebalancingPage() {
    const { success, error: showError } = useToast();

    const [data, setData] = useState<RebalanceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fetchingMeta, setFetchingMeta] = useState(false);
    const [mode, setMode] = useState<RebalanceMode>('symbol');

    const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});
    const [newCashInput, setNewCashInput] = useState('');
    const [bandInput, setBandInput] = useState('5');

    const initialized = useRef(false);
    const skipPreview = useRef(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestSeq = useRef(0);
    const targetInputsRef = useRef(targetInputs);
    targetInputsRef.current = targetInputs;

    const buildQuery = useCallback((preview: boolean, modeParam: RebalanceMode | null): string => {
        const params = new URLSearchParams();
        if (modeParam) params.set('mode', modeParam);
        const cash = parseFloat(newCashInput);
        if (Number.isFinite(cash) && cash > 0) params.set('newCash', String(cash));
        const band = parseFloat(bandInput);
        if (Number.isFinite(band) && band >= 0) params.set('band', String(band));
        if (preview) params.set('targets', JSON.stringify(parseTargets(targetInputsRef.current)));
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }, [newCashInput, bandInput]);

    const fetchData = useCallback(async (preview: boolean, modeParam: RebalanceMode | null) => {
        const seq = ++requestSeq.current;
        try {
            const res = await fetch(`/api/investments/rebalance${buildQuery(preview, modeParam)}`);
            if (!res.ok) throw new Error('Request failed');
            const json: RebalanceData = await res.json();
            if (seq !== requestSeq.current) return; // stale response
            setData(json);
            if (!initialized.current) {
                // Adopt the saved mode and seed editable state from saved targets
                setMode(json.allocationMode);
                setTargetInputs(inputsFromTargets(json.savedTargets));
                setBandInput(String(json.savedBandPct));
                initialized.current = true;
            }
        } catch {
            if (seq === requestSeq.current) showError('Failed to load rebalancing data');
        }
    }, [buildQuery, showError]);

    // Initial load (saved mode + targets, no preview)
    useEffect(() => {
        void fetchData(false, null).finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced live preview when inputs change
    useEffect(() => {
        if (!initialized.current) return;
        if (skipPreview.current) {
            // A mode switch just reseeded the inputs — its own fetch is in flight.
            skipPreview.current = false;
            return;
        }
        setRefreshing(true);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            void fetchData(true, mode).finally(() => setRefreshing(false));
        }, 400);
        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetInputs, newCashInput, bandInput, fetchData]);

    const handleTargetChange = useCallback((key: string, value: string) => {
        setTargetInputs(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleModeChange = useCallback((next: RebalanceMode) => {
        if (next === mode || !data) return;
        setMode(next);
        // Reseed inputs from the other mode's saved targets and refetch
        skipPreview.current = true;
        setTargetInputs(inputsFromTargets(
            next === 'sector' ? data.savedTargetsBySector : data.savedTargetsBySymbol
        ));
        setRefreshing(true);
        void fetchData(false, next).finally(() => setRefreshing(false));
    }, [mode, data, fetchData]);

    const editedTargets = useMemo(() => parseTargets(targetInputs), [targetInputs]);
    const bandValue = useMemo(() => {
        const b = parseFloat(bandInput);
        return Number.isFinite(b) && b >= 0 ? b : 5;
    }, [bandInput]);

    const dirty = data !== null && (
        !sameTargets(editedTargets, data.savedTargets) ||
        Math.abs(bandValue - data.savedBandPct) > 0.001 ||
        mode !== data.savedMode
    );

    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const res = await fetch('/api/investments/rebalance', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, targets: editedTargets, bandPct: bandValue }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Save failed');
            }
            success('Target allocation saved');
            await fetchData(false, mode);
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Failed to save targets');
        } finally {
            setSaving(false);
        }
    }, [saving, mode, editedTargets, bandValue, success, showError, fetchData]);

    const handleFetchSectorData = useCallback(async () => {
        if (fetchingMeta) return;
        setFetchingMeta(true);
        try {
            const res = await fetch('/api/investments/commodity-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: data?.unclassifiedSymbols ?? [] }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Fetch failed');
            }
            const json = await res.json();
            success(`Sector data refreshed — ${json.refreshed} updated, ${json.failed} unavailable`);
            setRefreshing(true);
            await fetchData(true, mode).finally(() => setRefreshing(false));
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Failed to fetch sector data');
        } finally {
            setFetchingMeta(false);
        }
    }, [fetchingMeta, data, mode, success, showError, fetchData]);

    if (loading) {
        return (
            <InvestmentsPage>
                <div className="h-8 bg-background-tertiary rounded animate-pulse w-48" />
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-[124px] rounded-lg border border-border bg-surface animate-pulse" />
                    ))}
                </div>
                <div className="h-64 rounded-lg border border-border bg-surface animate-pulse" />
            </InvestmentsPage>
        );
    }

    if (!data || data.holdings.length === 0) {
        return (
            <InvestmentsPage>
                <PageHeader title="Rebalancing" subtitle="Target allocation, drift, and tax-aware suggestions" />
                <EmptyState title="No holdings to rebalance">
                    Investment holdings (STOCK/MUTUAL accounts) will appear here once present in your book.
                </EmptyState>
            </InvestmentsPage>
        );
    }

    const sectorMode = mode === 'sector';
    const unclassified = sectorMode ? (data.unclassifiedSymbols ?? []) : [];

    // Headline figures, read straight off the response (no new math).
    const trackedRows = data.rows.filter(r => r.currentPct > 0 || r.targetPct > 0);
    const outOfBand = trackedRows.filter(r => r.outsideBand);
    const largestDrift = trackedRows.reduce<typeof trackedRows[number] | null>(
        (best, r) => (best == null || Math.abs(r.driftPct) > Math.abs(best.driftPct) ? r : best),
        null,
    );
    const trades = sectorMode ? (data.symbolTrades ?? []) : data.suggestions;
    const buyTotal = trades.filter(t => t.action === 'BUY').reduce((sum, t) => sum + t.amount, 0);
    const sellTotal = trades.filter(t => t.action === 'SELL').reduce((sum, t) => sum + t.amount, 0);

    return (
        <InvestmentsPage>
            <PageHeader
                title="Rebalancing"
                subtitle="Target allocation, drift, and tax-aware suggestions"
                actions={
                    <button
                        onClick={handleSave}
                        disabled={!dirty || saving}
                        className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover disabled:bg-primary/30 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors"
                    >
                        {saving ? 'Saving…' : dirty ? 'Save Targets' : 'Targets Saved'}
                    </button>
                }
            />

            {/* Summary cards — each opens the section behind the number */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <KpiCard
                    className="col-span-2 lg:col-span-1"
                    emphasis
                    label="Portfolio Value"
                    value={formatCurrency(data.totalValue)}
                    sub={data.newCash > 0 ? `plus ${formatCurrency(data.newCash)} new cash` : 'Holdings being rebalanced'}
                    href="/investments#holdings"
                    cta="Holdings"
                />
                <KpiCard
                    label="Outside Band"
                    value={`${outOfBand.length} of ${trackedRows.length}`}
                    tone={outOfBand.length > 0 ? 'warning' : 'default'}
                    sub={`±${data.bandPct} pts drift band`}
                    href="#drift"
                    cta="Current vs target"
                />
                <KpiCard
                    label="Largest Drift"
                    value={largestDrift ? `${largestDrift.driftPct > 0 ? '+' : ''}${largestDrift.driftPct.toFixed(1)} pts` : '—'}
                    tone={largestDrift?.outsideBand ? 'warning' : 'default'}
                    sub={largestDrift ? largestDrift.key : 'No targets set'}
                    href="#targets"
                    cta="Edit targets"
                />
                <KpiCard
                    className="col-span-2 lg:col-span-1"
                    label="Suggested Trades"
                    value={String(trades.length)}
                    sub={
                        <span className="font-mono" style={{ fontFeatureSettings: "'tnum'" }}>
                            Buy {formatCurrency(buyTotal)}{sellTotal > 0 ? ` · Sell ${formatCurrency(sellTotal)}` : ''}
                        </span>
                    }
                    href="#suggestions"
                    cta={data.mode === 'buy-only' ? 'Buy-only plan' : 'Trade list'}
                />
            </div>

            {/* Scenario controls */}
            <Panel
                title="Scenario"
                subtitle="Changes preview live; save to keep the targets and band"
                actions={
                    <>
                        {refreshing && <span className="text-xs text-foreground-muted">Recalculating…</span>}
                        {data.mode === 'buy-only' && (
                            <span className="rounded-sm bg-secondary-light px-2 py-1 text-xs text-secondary">
                                Buy-only mode — new cash covers rebalancing
                            </span>
                        )}
                    </>
                }
            >
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                    <div>
                        <span className={CONTROL_LABEL}>Allocate By</span>
                        <Segmented
                            ariaLabel="Allocate by"
                            value={mode}
                            onChange={handleModeChange}
                            options={[
                                { value: 'symbol', label: 'Symbol' },
                                { value: 'sector', label: 'Sector' },
                            ]}
                        />
                    </div>
                    <label className="block">
                        <span className={CONTROL_LABEL}>New Cash to Invest</span>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">$</span>
                            <input
                                type="number"
                                min={0}
                                step={100}
                                inputMode="decimal"
                                value={newCashInput}
                                placeholder="0"
                                onChange={e => setNewCashInput(e.target.value)}
                                className={inputClass({ extra: 'w-40! py-1.5! pl-6! text-right font-mono tabular-nums' })}
                            />
                        </div>
                    </label>
                    <label className="block">
                        <span className={CONTROL_LABEL}>Drift Band (± pts)</span>
                        <input
                            type="number"
                            min={0}
                            max={50}
                            step={1}
                            inputMode="decimal"
                            value={bandInput}
                            onChange={e => setBandInput(e.target.value)}
                            className={inputClass({ extra: 'w-24! py-1.5! text-right font-mono tabular-nums' })}
                        />
                    </label>
                </div>
            </Panel>

            {/* Missing sector data callout */}
            {sectorMode && unclassified.length > 0 && (
                <div className="bg-secondary-light border border-secondary/30 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-foreground-secondary">
                        No sector data for{' '}
                        <span className="font-mono text-foreground">{unclassified.join(', ')}</span>
                        {' '}— their value is shown under &ldquo;Unclassified&rdquo;.
                    </p>
                    <button
                        onClick={handleFetchSectorData}
                        disabled={fetchingMeta}
                        className="px-3 py-1.5 text-xs font-medium bg-primary hover:bg-primary-hover disabled:bg-primary/30 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors"
                    >
                        {fetchingMeta ? 'Fetching…' : 'Fetch sector data'}
                    </button>
                </div>
            )}

            {/* Warnings */}
            {data.warnings.length > 0 && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 space-y-1">
                    {data.warnings.map((w, i) => (
                        <p key={i} className="text-sm text-warning">{w}</p>
                    ))}
                </div>
            )}

            <div className="grid gap-4 2xl:grid-cols-12">
                {/* Drift bars */}
                <div id="drift" className="min-w-0 scroll-mt-6 2xl:col-span-5">
                    <DriftBars
                        rows={data.rows}
                        bandPct={data.bandPct}
                        keyWidthClass={sectorMode ? 'w-40' : 'w-16'}
                    />
                </div>

                {/* Target editor */}
                <div id="targets" className="min-w-0 scroll-mt-6 2xl:col-span-7">
                    <TargetEditor
                        rows={data.rows}
                        targetInputs={targetInputs}
                        onTargetChange={handleTargetChange}
                        keyHeader={sectorMode ? 'Sector' : 'Symbol'}
                    />
                </div>
            </div>

            {/* Suggestions */}
            <div id="suggestions" className="scroll-mt-6 space-y-4">
                {sectorMode ? (
                    <>
                        <SectorSuggestionsTable
                            groups={data.sectorGroups ?? []}
                            netBySymbol={data.symbolTrades ?? []}
                            mode={data.mode}
                        />
                        {(data.symbolTrades?.length ?? 0) > 0 && (
                            <SuggestionsTable
                                suggestions={data.symbolTrades ?? []}
                                mode={data.mode}
                                title="Net Trades by Symbol (Tax Impact)"
                            />
                        )}
                    </>
                ) : (
                    <SuggestionsTable suggestions={data.suggestions} mode={data.mode} />
                )}
            </div>
        </InvestmentsPage>
    );
}
