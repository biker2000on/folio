'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatCurrency } from '@/lib/format';
import type { DividendSummary } from '@/lib/dividends';
import { DividendMonthlyChart } from './DividendMonthlyChart';
import { PerSecurityTable } from './PerSecurityTable';
import { DividendCalendar } from './DividendCalendar';
import { TTM_TITLE } from './ttm';
import { Abbr } from '@/components/ui/Abbr';
import { EmptyState, InvestmentsPage, KpiCard, Panel, Segmented } from '@/components/investments/ui';

const TTM_KEY = 'ttm';

export default function DividendsPage() {
    const [data, setData] = useState<DividendSummary | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [year, setYear] = useState<number | null>(null);
    // Which selection the settled data/error belongs to. `loading` is derived
    // from it rather than reset at the top of the effect.
    const [settledYear, setSettledYear] = useState<{ year: number | null } | null>(null);

    useEffect(() => {
        let cancelled = false;
        const url = year != null
            ? `/api/investments/dividends?year=${year}`
            : '/api/investments/dividends';
        fetch(url)
            .then(async (res) => {
                if (!res.ok) throw new Error((await res.json()).error || 'Failed to load dividends');
                return res.json();
            })
            .then((json: DividendSummary) => {
                if (!cancelled) { setData(json); setFetchError(null); }
            })
            .catch((err) => { if (!cancelled) setFetchError(err.message); })
            .finally(() => { if (!cancelled) setSettledYear({ year }); });
        return () => { cancelled = true; };
    }, [year]);

    const loading = settledYear === null || settledYear.year !== year;
    // A previous selection's failure is not shown while a new one is in flight.
    const error = loading ? null : fetchError;

    const years = useMemo(() => (data?.perYear ?? []).map(y => y.year).sort((a, b) => b - a), [data]);

    const header = (actions?: ReactNode) => (
        <PageHeader title="Dividend Income" subtitle="Dividend tracking and forward calendar" actions={actions} />
    );

    if (loading && !data) {
        return (
            <InvestmentsPage>
                <div className="h-8 w-48 animate-pulse rounded bg-background-tertiary" />
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                        <div
                            key={i}
                            className={`h-[124px] animate-pulse rounded-lg border border-border bg-surface ${i === 1 ? 'col-span-2 lg:col-span-1' : ''}`}
                        />
                    ))}
                </div>
                <div className="h-80 animate-pulse rounded-lg border border-border bg-surface" />
            </InvestmentsPage>
        );
    }

    if (error) {
        return (
            <InvestmentsPage>
                {header()}
                <div className="rounded-lg border border-border bg-surface p-8 text-center">
                    <p className="text-error">{error}</p>
                </div>
            </InvestmentsPage>
        );
    }

    if (!data || data.paymentCount === 0) {
        return (
            <InvestmentsPage>
                {header()}
                <EmptyState title="No dividend income found">
                    Dividends appear here once income transactions posted to a
                    &ldquo;Dividend&rdquo; income account exist in this book.
                </EmptyState>
            </InvestmentsPage>
        );
    }

    const periodOptions = [
        { value: TTM_KEY, label: 'TTM', hint: TTM_TITLE },
        ...years.slice(0, 6).map(y => ({ value: String(y), label: <span className="font-mono">{y}</span> })),
    ];

    const showYear = year != null && data.yearTotal != null;

    return (
        <InvestmentsPage>
            {header(
                <Segmented
                    ariaLabel="Dividend period"
                    options={periodOptions}
                    value={year == null ? TTM_KEY : String(year)}
                    onChange={v => setYear(v === TTM_KEY ? null : Number(v))}
                />
            )}

            {/* Summary cards — each opens the section that breaks the number down */}
            <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${showYear ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
                <KpiCard
                    className="col-span-2 lg:col-span-1"
                    emphasis
                    label={<><Abbr term="TTM" /> Dividend Income</>}
                    value={formatCurrency(data.ttmTotal)}
                    sub="Trailing 12 months"
                    href="#by-security"
                    cta="By security"
                />
                {showYear && (
                    <KpiCard
                        label={`${year} Dividends`}
                        value={formatCurrency(data.yearTotal ?? 0)}
                        sub={`Total paid in ${year}`}
                        href="#monthly"
                        cta="Month by month"
                    />
                )}
                <KpiCard
                    label="Projected Next 12mo"
                    value={formatCurrency(data.projectedNext12mo)}
                    tone="primary"
                    sub={`${data.forwardCalendar.calendar.length} expected payments`}
                    href="#upcoming"
                    cta="Payment calendar"
                />
                <KpiCard
                    className={showYear ? 'col-span-2 lg:col-span-1' : ''}
                    label="Portfolio Yield"
                    value={data.portfolioYield != null ? `${data.portfolioYield.toFixed(2)}%` : '—'}
                    tone="positive"
                    sub={data.portfolioValue > 0 ? `on ${formatCurrency(data.portfolioValue)}` : 'value unavailable'}
                    href="#by-security"
                    cta="Yield by security"
                />
            </div>

            {/* Monthly income chart */}
            <Panel id="monthly" title="Monthly Dividend Income">
                <DividendMonthlyChart data={data.monthly} height={280} />
            </Panel>

            {/* Per-security table */}
            <div id="by-security" className="min-w-0 scroll-mt-6">
                <PerSecurityTable rows={data.perSecurity} year={year} />
            </div>

            {/* Forward calendar */}
            <section id="upcoming" className="scroll-mt-6 space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold text-foreground">Upcoming Dividends</h2>
                    <span className="text-xs text-foreground-muted">Next 12 months, projected from payment cadence</span>
                </div>
                <DividendCalendar calendar={data.forwardCalendar} />
            </section>
        </InvestmentsPage>
    );
}
