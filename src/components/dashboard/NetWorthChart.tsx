'use client';

import { useContext, useMemo, useState } from 'react';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { ChartPanel } from '@/components/investments/ui';
import {
    AXIS,
    ChartDataTable,
    ChartTooltipCard,
    CURSOR_LINE,
    GRID,
    type TooltipRow,
} from '@/components/charts/ChartParts';
import { TNUM } from '@/components/ui/form';
import { clipFuturePoints, fitDomain } from '@/lib/charts/fit-domain';
import {
    axisMoney,
    axisPeriod,
    fullMoney,
    localToday,
    longPeriod,
    signedMoney,
    signedPercent,
    wholeMoney,
} from '@/lib/charts/chart-format';

interface NetWorthDataPoint {
    date: string;
    netWorth: number;
    assets: number;
    liabilities: number;
}

interface NetWorthChartProps {
    data: NetWorthDataPoint[];
    loading: boolean;
}

/** A point as the chart draws it: debt as the positive amount owed. */
interface ChartPoint {
    date: string;
    /** YYYY-MM, for axis labels and tooltip headings. */
    month: string;
    netWorth: number;
    assets: number;
    debt: number;
}

// Net worth is the headline, so it takes the accent. Debt is a balance
// category, not a loss, so it takes a neutral rather than the money-negative
// red; drawn as the amount owed, rising debt rises.
const NET_WORTH_COLOR = 'var(--primary)';
const ASSET_COLOR = 'var(--secondary)';
const DEBT_COLOR = 'var(--foreground-secondary)';

const BREAKDOWN_STORAGE_KEY = 'dashboard.netWorthChart.breakdown';
const HERO_HEIGHT = 260;
const MULTIPLE_HEIGHT = 112;
const Y_AXIS_WIDTH = 60;

function loadBreakdown(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(BREAKDOWN_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function saveBreakdown(value: boolean) {
    try {
        localStorage.setItem(BREAKDOWN_STORAGE_KEY, String(value));
    } catch {
        // A view preference; losing it is harmless.
    }
}

function changeOf(points: ChartPoint[], key: keyof Pick<ChartPoint, 'netWorth' | 'assets' | 'debt'>) {
    if (points.length < 2) return null;
    const first = points[0][key];
    const last = points[points.length - 1][key];
    return { amount: last - first, percent: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : Number.NaN };
}

function signClass(amount: number, upIsGood = true): string {
    if (Math.abs(amount) < 0.5) return 'text-foreground-muted';
    return (amount > 0) === upIsGood ? 'text-positive' : 'text-negative';
}

function ChartSkeleton() {
    return (
        <div className="rounded-lg border border-border bg-surface p-5 animate-pulse" aria-busy="true">
            <div className="h-4 w-32 rounded bg-background-secondary" />
            <div className="mt-2 h-5 w-48 rounded bg-background-secondary" />
            <div className="mt-5 rounded bg-background-secondary" style={{ height: HERO_HEIGHT }} />
        </div>
    );
}

/** One line of the hero tooltip: the month's figures and its change from the month before. */
function HeroTooltip({
    active,
    label,
    points,
}: {
    active?: boolean;
    label?: string;
    points: ChartPoint[];
}) {
    if (!active || !label) return null;
    const index = points.findIndex(point => point.date === label);
    const point = points[index];
    if (!point) return null;
    const previous = index > 0 ? points[index - 1] : null;
    const rows: TooltipRow[] = [
        { key: 'netWorth', label: 'Net worth', value: fullMoney(point.netWorth), swatch: NET_WORTH_COLOR },
        { key: 'assets', label: 'Assets', value: fullMoney(point.assets), swatch: ASSET_COLOR },
        { key: 'debt', label: 'Debt owed', value: fullMoney(point.debt), swatch: DEBT_COLOR },
    ];
    if (previous) {
        const change = point.netWorth - previous.netWorth;
        rows.push({
            key: 'change',
            label: 'Change in month',
            value: signedMoney(change),
            valueClassName: signClass(change),
            separated: true,
        });
    }
    return <ChartTooltipCard heading={longPeriod(point.month)} rows={rows} />;
}

function SingleTooltip({
    active,
    label,
    points,
    field,
    name,
    color,
}: {
    active?: boolean;
    label?: string;
    points: ChartPoint[];
    field: 'assets' | 'debt';
    name: string;
    color: string;
}) {
    if (!active || !label) return null;
    const point = points.find(item => item.date === label);
    if (!point) return null;
    return (
        <ChartTooltipCard
            heading={longPeriod(point.month)}
            rows={[{ key: field, label: name, value: fullMoney(point[field]), swatch: color }]}
        />
    );
}

/** One of the two small charts under the hero: its own scale, its own figure. */
function SmallMultiple({
    points,
    field,
    name,
    color,
    upIsGood,
}: {
    points: ChartPoint[];
    field: 'assets' | 'debt';
    name: string;
    color: string;
    upIsGood: boolean;
}) {
    const axis = useMemo(() => fitDomain(points.map(point => point[field]), 2), [points, field]);
    const change = changeOf(points, field);
    const last = points[points.length - 1]?.[field] ?? 0;

    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-xs font-medium text-foreground-secondary">{name}</h3>
                <p className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-sm font-semibold text-foreground" style={TNUM}>{wholeMoney(last)}</span>
                    {change && (
                        <span className={`font-mono ${signClass(change.amount, upIsGood)}`} style={TNUM}>
                            {signedMoney(change.amount)}
                        </span>
                    )}
                </p>
            </div>
            <div className="mt-1" style={{ height: MULTIPLE_HEIGHT }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={points} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} title={`${name} by month`}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="date" hide />
                        <YAxis
                            width={Y_AXIS_WIDTH}
                            domain={axis?.domain ?? ['auto', 'auto']}
                            ticks={axis?.ticks}
                            allowDataOverflow
                            tickFormatter={axisMoney}
                            tick={AXIS.tick}
                            axisLine={AXIS.axisLine}
                            tickLine={AXIS.tickLine}
                        />
                        <Tooltip
                            cursor={CURSOR_LINE}
                            isAnimationActive={false}
                            content={<SingleTooltip points={points} field={field} name={name} color={color} />}
                        />
                        <Area
                            type="monotoneX"
                            dataKey={field}
                            stroke={color}
                            strokeWidth={1.5}
                            fill={color}
                            fillOpacity={0.08}
                            baseValue={axis?.domain[0] ?? 'dataMin'}
                            dot={false}
                            activeDot={{ r: 3, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }}
                            isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function NetWorthChart({ data, loading }: NetWorthChartProps) {
    const expanded = useContext(ExpandedContext);
    // Renders only after data loads on the client, so reading storage here
    // cannot cause a hydration mismatch.
    const [breakdown, setBreakdown] = useState<boolean>(loadBreakdown);

    const points = useMemo<ChartPoint[]>(() => clipFuturePoints(data ?? [], localToday()).map(point => ({
        date: point.date,
        month: point.date.slice(0, 7),
        netWorth: point.netWorth,
        assets: point.assets,
        // Liabilities arrive as GnuCash stores them (negative when owed).
        debt: -point.liabilities,
    })), [data]);
    const axis = useMemo(() => fitDomain(points.map(point => point.netWorth)), [points]);

    if (loading) return <ChartSkeleton />;

    const toggleBreakdown = () => {
        setBreakdown(current => {
            saveBreakdown(!current);
            return !current;
        });
    };

    if (points.length === 0) {
        return (
            <ChartPanel expanded={expanded} title="Net worth">
                <div className="flex items-center justify-center" style={{ height: HERO_HEIGHT }}>
                    <p className="text-sm text-foreground-muted">No net worth data for this period.</p>
                </div>
            </ChartPanel>
        );
    }

    const last = points[points.length - 1];
    const change = changeOf(points, 'netWorth');
    const figure = (
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className="font-mono text-lg font-semibold text-foreground" style={TNUM}>{wholeMoney(last.netWorth)}</span>
            {change && (
                <span className="text-xs text-foreground-muted">
                    <span className={`font-mono ${signClass(change.amount)}`} style={TNUM}>
                        {signedMoney(change.amount)}
                    </span>{' '}
                    <span className="font-mono" style={TNUM}>{signedPercent(change.percent)}</span>{' '}
                    since {axisPeriod(points[0].month, 0)}
                </span>
            )}
        </span>
    );
    const breakdownToggle = (
        <button
            type="button"
            aria-pressed={breakdown}
            onClick={toggleBreakdown}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                breakdown
                    ? 'border-primary/50 bg-primary-light text-primary'
                    : 'border-border text-foreground-secondary hover:border-border-hover hover:text-foreground'
            }`}
        >
            Assets &amp; debt
        </button>
    );

    const summary = change
        ? `Net worth ${wholeMoney(last.netWorth)}, ${signedMoney(change.amount)} since ${longPeriod(points[0].month)}.`
        : `Net worth ${wholeMoney(last.netWorth)}.`;

    return (
        <ChartPanel
            expanded={expanded}
            title="Net worth"
            subtitle={figure}
            actions={expanded ? <>{figure}{breakdownToggle}</> : breakdownToggle}
        >
            <div className={`flex min-w-0 flex-col ${expanded ? 'h-full' : ''}`}>
                <div className={expanded ? 'min-h-[240px] flex-1' : ''} style={expanded ? undefined : { height: HERO_HEIGHT }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            data={points}
                            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                            title="Net worth by month"
                            desc={summary}
                        >
                            <CartesianGrid {...GRID} />
                            <XAxis
                                dataKey="date"
                                tickFormatter={(value: string, index: number) => axisPeriod(value.slice(0, 7), index)}
                                tick={AXIS.categoryTick}
                                axisLine={{ stroke: 'var(--border)' }}
                                tickLine={AXIS.tickLine}
                                interval="preserveStartEnd"
                                minTickGap={24}
                                tickMargin={8}
                            />
                            <YAxis
                                width={Y_AXIS_WIDTH}
                                domain={axis?.domain ?? ['auto', 'auto']}
                                ticks={axis?.ticks}
                                allowDataOverflow
                                tickFormatter={axisMoney}
                                tick={AXIS.tick}
                                axisLine={AXIS.axisLine}
                                tickLine={AXIS.tickLine}
                            />
                            <Tooltip
                                cursor={CURSOR_LINE}
                                isAnimationActive={false}
                                content={<HeroTooltip points={points} />}
                            />
                            <Area
                                type="monotoneX"
                                dataKey="netWorth"
                                stroke={NET_WORTH_COLOR}
                                strokeWidth={2}
                                fill={NET_WORTH_COLOR}
                                fillOpacity={0.08}
                                baseValue={axis?.domain[0] ?? 'dataMin'}
                                dot={false}
                                activeDot={{ r: 4, fill: NET_WORTH_COLOR, stroke: 'var(--surface)', strokeWidth: 2 }}
                                isAnimationActive={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                {breakdown && (
                    <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-border pt-4 md:grid-cols-2">
                        <SmallMultiple points={points} field="assets" name="Assets" color={ASSET_COLOR} upIsGood />
                        <SmallMultiple points={points} field="debt" name="Debt owed" color={DEBT_COLOR} upIsGood={false} />
                    </div>
                )}
                <ChartDataTable
                    caption="Net worth, assets and debt owed by month"
                    columns={['Month', 'Net worth', 'Assets', 'Debt owed']}
                    rows={points.map(point => ({
                        key: point.date,
                        cells: [longPeriod(point.month), fullMoney(point.netWorth), fullMoney(point.assets), fullMoney(point.debt)],
                    }))}
                />
            </div>
        </ChartPanel>
    );
}
