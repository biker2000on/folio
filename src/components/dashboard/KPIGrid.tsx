'use client';

import { useState } from 'react';
import { ProvenanceModal } from '@/components/provenance/ProvenanceModal';
import Link from 'next/link';
import { ErrorLiveRegion } from '@/components/a11y/LiveRegion';
import { TNUM } from '@/components/ui/form';

interface TraceReference {
    traceId: string;
    href: string;
}

interface ValuationGap {
    commodityGuid: string;
    label: string;
    message: string;
}

/** Mirrors `StalePriceDisclosure`; declared locally like the gap above. */
interface StalePrice {
    commodityGuid: string;
    label: string;
    priceDate: string;
    ageDays: number;
    message: string;
}

interface ValuationCoverage {
    complete: boolean;
    unvaluedAccountCount: number;
    gaps: ValuationGap[];
    /**
     * Included in the totals, priced from an old quote. Optional for the same
     * reason `coverage` itself is: a payload cached before this existed must
     * still render, and an absent list means "not known", which shows nothing
     * rather than claiming the prices were current.
     */
    stalePrices?: StalePrice[];
}

interface ValuationChangeCoverage extends ValuationCoverage {
    comparable: boolean;
}

interface KPIData {
    netWorth: number;
    netWorthChange: number;
    netWorthChangePercent: number;
    totalIncome: number;
    totalExpenses: number;
    savingsRate: number;
    topExpenseCategory: string;
    topExpenseAmount: number;
    investmentValue: number;
    /** Optional so a payload cached before coverage existed still renders. */
    coverage?: ValuationCoverage;
    changeCoverage?: ValuationChangeCoverage;
    /** The same period a year earlier; absent on older cached payloads, null when the book has nothing there. */
    prior?: { totalIncome: number; totalExpenses: number; startDate: string; endDate: string } | null;
    traces?: Partial<Record<'netWorth' | 'totalIncome' | 'totalExpenses' | 'savingsRate' | 'investmentValue', TraceReference>>;
}

interface KPIGridProps {
    data: KPIData | null;
    loading: boolean;
    /** Name of the selected period, shown beside the flow figures ("This Year"). */
    periodLabel?: string;
    /** Date the balances are valued at, shown beside them ("16 Nov"). */
    asOfLabel?: string;
    /** The request failed (as opposed to returning nothing). */
    error?: boolean;
    onRetry?: () => void;
}

/**
 * A figure against the same period last year: the change, then what it was.
 * `upIsGood` colours the change for income; spending is stated without a
 * verdict, since more spending is not in itself a loss.
 */
function YearOverYear({ current, prior, upIsGood }: { current: number; prior: number; upIsGood: boolean }) {
    if (!(prior > 0)) return null;
    const change = ((current - prior) / prior) * 100;
    const tone = !upIsGood || formatPercent(change) === formatPercent(0)
        ? 'text-foreground-secondary'
        : change > 0 ? 'text-positive' : 'text-negative';
    return (
        <span>
            <span className={`font-mono ${tone}`} style={TNUM}>{formatPercent(change)}</span> vs{' '}
            <span className="font-mono" style={TNUM}>{formatCurrency(prior)}</span> a year earlier
        </span>
    );
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

function formatPercent(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function ChangeIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
    if (value === 0) return null;
    const isPositive = value > 0;
    return (
        <span className={`flex items-center gap-1 font-mono text-xs font-medium ${isPositive ? 'text-positive' : 'text-negative'}`} style={TNUM}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                {isPositive ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                )}
            </svg>
            {suffix ? `${Math.abs(value).toFixed(1)}${suffix}` : formatCurrency(Math.abs(value))}
        </span>
    );
}

interface KPICardProps {
    label: string;
    /** What the figure covers: a period for flows, a date for balances. */
    period?: string;
    value: string;
    /** Tone of the headline figure; a rate below zero reads as a loss. */
    negative?: boolean;
    detail?: React.ReactNode;
    /** Short note that the number is partial; rendered in the warning color. */
    caveat?: string;
    /** The view that explains this number, and the words that say so. */
    href: string;
    cta: string;
    traceId?: string;
    onExplain?: (traceId: string) => void;
}

const STRIP = 'grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-5';
// Five cells in two columns leave a hole; the lead figure takes the full row.
const CELL = 'relative flex min-w-0 flex-col bg-surface px-4 py-3 first:sm:col-span-2 first:xl:col-span-1 sm:px-5 sm:py-4';

function ExplainButton({
    label,
    traceId,
    onExplain,
}: {
    label: string;
    traceId?: string;
    onExplain?: (traceId: string) => void;
}) {
    if (!traceId || !onExplain) return null;
    return (
        <button
            type="button"
            onClick={() => onExplain(traceId)}
            className="relative z-10 -my-1 rounded-md px-1.5 py-1 text-xs font-medium text-foreground-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            aria-label={`Explain ${label}`}
        >
            Explain
        </button>
    );
}

/**
 * One headline figure. The whole cell is the hit target: the visible "what
 * opens" text is the real link and its ::after covers the cell, so Explain
 * sits above that layer and keeps working (DESIGN.md "Every KPI card is a way in").
 */
function KPICard({ label, period, value, negative, detail, caveat, href, cta, traceId, onExplain }: KPICardProps) {
    return (
        <div className={`group ${CELL} transition-colors duration-150 hover:bg-surface-hover focus-within:bg-surface-hover`}>
            <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate text-xs font-medium text-foreground-secondary">
                    {label}
                    {period && <span className="font-normal text-foreground-muted"> · {period}</span>}
                </div>
                <ExplainButton label={label} traceId={traceId} onExplain={onExplain} />
            </div>
            <div
                className={`mt-2 whitespace-nowrap font-mono text-2xl font-semibold ${negative ? 'text-negative' : 'text-foreground'}`}
                style={TNUM}
            >
                {value}
            </div>
            {detail && <div className="mt-1 min-w-0 text-xs text-foreground-muted">{detail}</div>}
            {caveat && <div className="mt-1 text-xs text-warning">{caveat}</div>}
            <div className="mt-auto pt-3">
                <Link
                    href={href}
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground-secondary transition-colors duration-150 after:absolute after:inset-0 after:content-[''] group-hover:text-primary focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
                >
                    {cta}
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5 10.5 8 6 12.5" />
                    </svg>
                </Link>
            </div>
        </div>
    );
}

export default function KPIGrid({ data, loading, periodLabel, asOfLabel, error = false, onRetry }: KPIGridProps) {
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    if (loading) {
        return (
            <div className={`${STRIP} animate-pulse`} aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={CELL}>
                        <div className="h-3 w-24 rounded bg-background-secondary" />
                        <div className="mt-3 h-7 w-32 rounded bg-background-secondary" />
                        <div className="mt-2 h-3 w-28 rounded bg-background-secondary" />
                        <div className="mt-5 h-3 w-20 rounded bg-background-secondary" />
                    </div>
                ))}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="rounded-lg border border-border bg-surface px-6 py-8 text-center">
                <p className="text-sm text-foreground">
                    {error ? 'The headline figures could not be loaded.' : 'No figures are available for this period.'}
                </p>
                {error && (
                    <>
                        <p className="mt-1 text-xs text-foreground-muted">The request failed; nothing here is zero.</p>
                        {onRetry && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:border-border-hover hover:bg-surface-hover"
                            >
                                Try again
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    }

    // A holding with no price and a currency with no exchange rate are both
    // left out of the totals entirely. Say so on the numbers they affect.
    const coverage = data.coverage;
    const changeCoverage = data.changeCoverage;
    const unvaluedCount = coverage && !coverage.complete ? coverage.unvaluedAccountCount : 0;
    const partialCaveat = unvaluedCount > 0
        ? `Partial: excludes ${unvaluedCount} unvalued ${unvaluedCount === 1 ? 'account' : 'accounts'}`
        : undefined;
    // The other way a total goes quietly wrong: everything is priced, from
    // quotes that stopped updating. Unlike the exclusion above, the money IS in
    // the number -- so this qualifies the figure rather than shrinking it.
    const stalePrices = coverage?.stalePrices ?? [];
    // No day count here: how old is too old depends on the instrument, and two
    // commodities in one total can be held to different bounds. Each line in the
    // banner states its own; the caveat only says the total has one.
    const staleCaveat = stalePrices.length > 0
        ? 'Priced from out-of-date quotes'
        : undefined;
    const valuationCaveat = [partialCaveat, staleCaveat].filter(Boolean).join(' · ') || undefined;
    // When the two dates could not value the same holdings, the difference
    // between them is an artifact of the missing data, not a gain or loss.
    // An ABSENT field means unknown, and unknown fails safe to "not shown": a
    // payload predating this check (a stale cache entry, a missed key bump)
    // then withholds the number rather than fabricating one.
    const changeComparable = changeCoverage?.comparable ?? false;
    // The banner covers the level totals and the change alike: a gap at only the
    // START date leaves end coverage complete, and that is exactly the case
    // where an uncaveated change would be most misleading.
    const bannerCoverage = coverage && !coverage.complete
        ? coverage
        : changeCoverage && !changeCoverage.complete
            ? changeCoverage
            : undefined;
    const showBanner = bannerCoverage !== undefined || !changeComparable || stalePrices.length > 0;
    // Named because it is both shown and announced, and the two must not drift.
    const bannerHeading = bannerCoverage
        ? 'These totals are incomplete'
        : !changeComparable
            ? 'Net worth change is not available'
            : 'These totals use out-of-date prices';

    const net = data.totalIncome - data.totalExpenses;
    const mono = 'font-mono';
    const cards: KPICardProps[] = [
        {
            label: 'Net worth',
            period: asOfLabel,
            value: formatCurrency(data.netWorth),
            caveat: valuationCaveat,
            detail: changeComparable ? (
                <span className="flex flex-wrap items-center gap-x-2">
                    <ChangeIndicator value={data.netWorthChange} />
                    <span className={mono} style={TNUM}>{formatPercent(data.netWorthChangePercent)}</span>
                    {periodLabel && <span>over {periodLabel.toLowerCase()}</span>}
                </span>
            ) : (
                <span className="font-medium text-warning">Change not available</span>
            ),
            href: '/reports/balance_sheet',
            cta: 'Balance sheet',
            traceId: data.traces?.netWorth?.traceId,
            onExplain: setSelectedTraceId,
        },
        {
            label: 'Income',
            period: periodLabel,
            value: formatCurrency(data.totalIncome),
            detail: data.prior && data.prior.totalIncome > 0 ? (
                <YearOverYear current={data.totalIncome} prior={data.prior.totalIncome} upIsGood />
            ) : (
                <span>
                    <span className={`${mono} ${net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : ''}`} style={TNUM}>
                        {formatCurrency(net)}
                    </span>{' '}
                    left after expenses
                </span>
            ),
            href: '/reports/income_statement',
            cta: 'Income statement',
            traceId: data.traces?.totalIncome?.traceId,
            onExplain: setSelectedTraceId,
        },
        {
            label: 'Expenses',
            period: periodLabel,
            value: formatCurrency(data.totalExpenses),
            detail: data.prior && data.prior.totalExpenses > 0 ? (
                <YearOverYear current={data.totalExpenses} prior={data.prior.totalExpenses} upIsGood={false} />
            ) : data.topExpenseCategory ? (
                <span className="flex min-w-0 gap-1.5">
                    <span className="truncate">Top: {data.topExpenseCategory}</span>
                    <span className={`shrink-0 ${mono}`} style={TNUM}>{formatCurrency(data.topExpenseAmount)}</span>
                </span>
            ) : undefined,
            href: '/reports/income_statement',
            cta: 'Income statement',
            traceId: data.traces?.totalExpenses?.traceId,
            onExplain: setSelectedTraceId,
        },
        {
            label: 'Savings rate',
            period: periodLabel,
            value: `${data.savingsRate.toFixed(1)}%`,
            negative: data.savingsRate < 0,
            // The arithmetic, not a verdict: what was kept, out of what came in.
            detail: data.totalIncome > 0 ? (
                <span>
                    <span className={mono} style={TNUM}>{formatCurrency(net)}</span> kept of{' '}
                    <span className={mono} style={TNUM}>{formatCurrency(data.totalIncome)}</span>
                </span>
            ) : (
                <span>No income in this period</span>
            ),
            href: '/reports/cash_flow',
            cta: 'Cash flow',
            traceId: data.traces?.savingsRate?.traceId,
            onExplain: setSelectedTraceId,
        },
        {
            label: 'Investments',
            period: asOfLabel,
            value: formatCurrency(data.investmentValue),
            caveat: valuationCaveat,
            detail: data.netWorth > 0 && data.investmentValue > 0 ? (
                <span>
                    <span className={mono} style={TNUM}>
                        {Math.round((data.investmentValue / data.netWorth) * 100)}%
                    </span>{' '}
                    of net worth
                </span>
            ) : undefined,
            href: '/investments',
            cta: 'Holdings',
            traceId: data.traces?.investmentValue?.traceId,
            onExplain: setSelectedTraceId,
        },
    ];

    return (
        <>
            {showBanner && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 mb-4 text-sm text-warning">
                    {/*
                      * The banner renders with its heading already in it, so a
                      * role on this node announces nothing reliably — the node
                      * and its text reach the accessibility tree in one commit.
                      * The shared region mounts empty and publishes on a later
                      * one, which is the mechanism a screen reader responds to.
                      * A missing figure interrupts; a figure that is present but
                      * priced from an old quote waits for a pause.
                      */}
                    <ErrorLiveRegion
                        message={bannerHeading}
                        politeness={bannerCoverage || !changeComparable ? 'assertive' : 'polite'}
                    />
                    <div className="font-medium">{bannerHeading}</div>
                    {bannerCoverage && bannerCoverage.gaps.length > 0 && (
                        <ul className="mt-1.5 space-y-1 text-xs">
                            {bannerCoverage.gaps.map(gap => (
                                <li key={gap.commodityGuid}>{gap.message}</li>
                            ))}
                        </ul>
                    )}
                    {bannerCoverage && bannerCoverage.gaps.length === 0 && (
                        <p className="mt-1.5 text-xs">
                            {bannerCoverage.unvaluedAccountCount} account balance(s) could not be
                            converted to the report currency and are excluded.
                        </p>
                    )}
                    {!changeComparable && (
                        <p className="mt-1.5 text-xs">
                            {changeCoverage
                                ? 'The start and end dates could not value the same holdings, so the net worth change and percentage are not shown.'
                                : 'The net worth change could not be checked against both dates, so it is not shown. Reload to recompute.'}
                        </p>
                    )}
                    {stalePrices.length > 0 && (
                        <>
                            <ul className="mt-1.5 space-y-1 text-xs">
                                {stalePrices.map(stale => (
                                    <li key={stale.commodityGuid}>{stale.message}</li>
                                ))}
                            </ul>
                            {/*
                              * The dashboard always values as of now, and nothing
                              * on this page fetches a price -- a book without the
                              * daily refresh schedule enabled only gets newer
                              * quotes when someone asks for them. So the notice
                              * says who can clear it and how, rather than
                              * reporting a condition and leaving the reader to
                              * guess. A warning that recurs and cannot be acted
                              * on is the one that gets ignored.
                              */}
                            <p className="mt-1.5 text-xs">
                                Refresh All Prices, from the menu on the Investments page, fetches
                                newer quotes.
                            </p>
                        </>
                    )}
                </div>
            )}

            <div className={STRIP}>
                {cards.map(card => (
                    <KPICard key={card.label} {...card} />
                ))}
            </div>
            <ProvenanceModal
                traceId={selectedTraceId}
                isOpen={selectedTraceId !== null}
                onClose={() => setSelectedTraceId(null)}
            />
        </>
    );
}
