'use client';

import { useContext, useMemo, useState } from 'react';
import {
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ExpandedContext } from './ExpandableChart';
import { ChartPanel } from '@/components/investments/ui';
import {
    AXIS,
    ChartDataTable,
    ChartTooltipCard,
    CURSOR_BAND,
    GRID,
    SeriesToggle,
    type TooltipRow,
} from './ChartParts';
import { TNUM } from '@/components/ui/form';
import { fitDomain } from '@/lib/charts/fit-domain';
import {
    axisMoney,
    axisPeriod,
    clipFuturePeriods,
    currentPeriodKey,
    fullMoney,
    localToday,
    longPeriod,
    periodKind,
    signedMoney,
    wholeMoney,
} from '@/lib/charts/chart-format';

export interface CashFlowData {
    month: string;
    income: number;
    expenses: number;
    netCashFlow: number;
}

interface CashFlowChartProps {
    data: CashFlowData[];
    loading: boolean;
}

type Series = 'income' | 'expenses' | 'net';

// Income is money in and expenses money out, so the money colours carry
// their meaning: the sign of the flow. Net is a marker, in the foreground.
const INCOME_COLOR = 'var(--positive)';
const EXPENSE_COLOR = 'var(--negative)';
const NET_COLOR = 'var(--foreground)';

const PLOT_HEIGHT = 260;
const Y_AXIS_WIDTH = 60;
const PARTIAL_OPACITY = 0.45;

const PERIOD_NOUN = { month: 'month', quarter: 'quarter', year: 'year' } as const;

interface Row extends CashFlowData {
    /** The period is still running: its totals are to date. */
    partial: boolean;
}

function ChartSkeleton() {
    return (
        <div className="rounded-lg border border-border bg-surface p-5 animate-pulse" aria-busy="true">
            <div className="h-4 w-32 rounded bg-background-secondary" />
            <div className="mt-2 h-5 w-48 rounded bg-background-secondary" />
            <div className="mt-5 rounded bg-background-secondary" style={{ height: PLOT_HEIGHT }} />
        </div>
    );
}

/** The net for a period: a short rule across the column, not a line between periods. */
function NetTick(props: { cx?: number; cy?: number; payload?: Row }) {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || !Number.isFinite(cy)) return null;
    const half = 9;
    return (
        <g opacity={payload?.partial ? PARTIAL_OPACITY + 0.2 : 1}>
            <line x1={cx - half} x2={cx + half} y1={cy} y2={cy} stroke="var(--surface)" strokeWidth={5} strokeLinecap="round" />
            <line x1={cx - half} x2={cx + half} y1={cy} y2={cy} stroke={NET_COLOR} strokeWidth={2.5} strokeLinecap="round" />
        </g>
    );
}

function FlowTooltip({ active, label, rows }: { active?: boolean; label?: string; rows: Row[] }) {
    if (!active || !label) return null;
    const row = rows.find(item => item.month === label);
    if (!row) return null;
    const rate = row.income > 0 ? (row.netCashFlow / row.income) * 100 : null;
    const lines: TooltipRow[] = [
        { key: 'income', label: 'Income', value: fullMoney(row.income), swatch: INCOME_COLOR },
        // Expenses arrive negative; shown as the amount spent. A month whose
        // refunds outweighed its spending shows a negative amount spent.
        {
            key: 'expenses',
            label: row.expenses > 0 ? 'Expenses (net refund)' : 'Expenses',
            value: fullMoney(-row.expenses),
            swatch: EXPENSE_COLOR,
        },
        {
            key: 'net',
            label: 'Net',
            value: signedMoney(row.netCashFlow),
            valueClassName: Math.abs(row.netCashFlow) < 0.5
                ? 'text-foreground-muted'
                : row.netCashFlow > 0 ? 'text-positive' : 'text-negative',
            separated: true,
        },
    ];
    if (rate !== null) lines.push({ key: 'rate', label: 'Kept of income', value: `${rate.toFixed(0)}%` });
    return <ChartTooltipCard heading={longPeriod(row.month)} note={row.partial ? 'to date' : undefined} rows={lines} />;
}

export default function CashFlowChart({ data, loading }: CashFlowChartProps) {
    const expanded = useContext(ExpandedContext);
    const [shown, setShown] = useState<Record<Series, boolean>>({ income: true, expenses: true, net: true });

    const rows = useMemo<Row[]>(() => {
        const today = localToday();
        const clipped = clipFuturePeriods(data ?? [], today);
        const current = clipped.length > 0 ? currentPeriodKey(clipped[0].month, today) : '';
        return clipped.map(row => ({ ...row, partial: row.month === current }));
    }, [data]);

    const axis = useMemo(() => fitDomain([
        0,
        ...rows.flatMap(row => [
            shown.income ? row.income : 0,
            shown.expenses ? row.expenses : 0,
            shown.net ? row.netCashFlow : 0,
        ]),
    ]), [rows, shown]);

    if (loading) return <ChartSkeleton />;

    const kind = rows.length > 0 ? periodKind(rows[0].month) : 'month';
    const title = 'Cash flow';
    const noun = PERIOD_NOUN[kind];

    if (rows.length === 0) {
        return (
            <ChartPanel expanded={expanded} title={title}>
                <div className="flex items-center justify-center" style={{ height: PLOT_HEIGHT }}>
                    <p className="text-sm text-foreground-muted">No income or spending in this period.</p>
                </div>
            </ChartPanel>
        );
    }

    const totalNet = rows.reduce((sum, row) => sum + row.netCashFlow, 0);
    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const partial = rows.find(row => row.partial);
    const figure = (
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span
                className={`font-mono text-lg font-semibold ${totalNet < 0 ? 'text-negative' : 'text-foreground'}`}
                style={TNUM}
            >
                {signedMoney(totalNet)}
            </span>
            <span className="text-xs text-foreground-muted">
                net over {rows.length} {noun}{rows.length === 1 ? '' : 's'}
                {totalIncome > 0 && (
                    <>
                        {' · '}
                        <span className="font-mono" style={TNUM}>{Math.round((totalNet / totalIncome) * 100)}%</span> kept
                    </>
                )}
                {partial && <> · {axisPeriod(partial.month, 1)} to date</>}
            </span>
        </span>
    );
    const toggle = (series: Series) => setShown(current => {
        const next = { ...current, [series]: !current[series] };
        // Never hide everything: an empty plot reads as "no data".
        return next.income || next.expenses || next.net ? next : current;
    });
    const legend = (
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Series shown">
            <SeriesToggle label="Income" color={INCOME_COLOR} shape="block" pressed={shown.income} onToggle={() => toggle('income')} />
            <SeriesToggle label="Expenses" color={EXPENSE_COLOR} shape="block" pressed={shown.expenses} onToggle={() => toggle('expenses')} />
            <SeriesToggle label="Net" color={NET_COLOR} shape="tick" pressed={shown.net} onToggle={() => toggle('net')} />
        </div>
    );

    return (
        <ChartPanel
            expanded={expanded}
            title={title}
            subtitle={figure}
            actions={expanded ? <>{figure}{legend}</> : legend}
        >
            <div className={expanded ? 'h-full min-h-[240px]' : ''} style={expanded ? undefined : { height: PLOT_HEIGHT }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={rows}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                        barCategoryGap="28%"
                        stackOffset="sign"
                        title={`Income, expenses and net by ${noun}`}
                        desc={`Net ${signedMoney(totalNet)} over ${rows.length} ${noun}s.`}
                    >
                        <CartesianGrid {...GRID} />
                        <XAxis
                            dataKey="month"
                            tickFormatter={(value: string, index: number) => axisPeriod(value, index)}
                            tick={AXIS.categoryTick}
                            axisLine={false}
                            tickLine={AXIS.tickLine}
                            interval="preserveStartEnd"
                            minTickGap={16}
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
                        <Tooltip cursor={CURSOR_BAND} isAnimationActive={false} content={<FlowTooltip rows={rows} />} />
                        <ReferenceLine y={0} stroke="var(--foreground-muted)" strokeWidth={1} />
                        {shown.income && (
                            <Bar dataKey="income" stackId="flow" fill={INCOME_COLOR} radius={[2, 2, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                                {rows.map(row => <Cell key={row.month} fillOpacity={row.partial ? PARTIAL_OPACITY : 0.85} />)}
                            </Bar>
                        )}
                        {shown.expenses && (
                            <Bar dataKey="expenses" stackId="flow" fill={EXPENSE_COLOR} radius={[2, 2, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                                {rows.map(row => <Cell key={row.month} fillOpacity={row.partial ? PARTIAL_OPACITY : 0.85} />)}
                            </Bar>
                        )}
                        {shown.net && (
                            <Scatter dataKey="netCashFlow" shape={<NetTick />} isAnimationActive={false} />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <ChartDataTable
                caption={`Income, expenses and net by ${noun}`}
                columns={[noun[0].toUpperCase() + noun.slice(1), 'Income', 'Expenses', 'Net']}
                rows={rows.map(row => ({
                    key: row.month,
                    cells: [
                        `${longPeriod(row.month)}${row.partial ? ' (to date)' : ''}`,
                        wholeMoney(row.income),
                        wholeMoney(-row.expenses),
                        signedMoney(row.netCashFlow),
                    ],
                }))}
            />
        </ChartPanel>
    );
}
