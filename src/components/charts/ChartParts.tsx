'use client';

import type { ReactNode } from 'react';
import { CHART_THEME } from '@/components/investments/ui';
import { TNUM } from '@/components/ui/form';

/**
 * Pieces shared by the dashboard's time-series charts so both read as one
 * system: the axis and grid styling, the tooltip, the legend toggles and the
 * text alternative.
 */

/** Axis styling on tokens. Money ticks are mono with tabular figures (DESIGN.md). */
export const AXIS = {
    tick: { ...CHART_THEME.tick, fontFamily: 'var(--font-mono)' },
    categoryTick: { ...CHART_THEME.tick },
    axisLine: false as const,
    tickLine: false as const,
};

/** Horizontal rules only; vertical rules add noise without helping read a value. */
export const GRID = { vertical: false, stroke: CHART_THEME.grid } as const;

/** The hover cursor: a token-coloured rule instead of recharts' default #ccc. */
export const CURSOR_LINE = { stroke: 'var(--border-hover)', strokeWidth: 1 };
export const CURSOR_BAND = { fill: 'var(--surface-hover)', fillOpacity: 0.5, stroke: 'var(--border-hover)', strokeWidth: 1 };

export interface TooltipRow {
    key: string;
    label: string;
    value: string;
    /** A colour swatch for the series; omit for a derived line. */
    swatch?: string;
    /** Extra class for the value (a signed figure takes its money colour). */
    valueClassName?: string;
    /** Draw a rule above this row. */
    separated?: boolean;
}

/** The tooltip card both charts use. */
export function ChartTooltipCard({ heading, note, rows }: { heading: string; note?: string; rows: TooltipRow[] }) {
    return (
        <div
            className="min-w-[200px] rounded-md border border-border bg-surface-elevated px-3 py-2.5 text-xs shadow-lg"
            role="presentation"
        >
            <div className="flex items-baseline justify-between gap-4">
                <span className="font-semibold text-foreground">{heading}</span>
                {note && <span className="text-foreground-muted">{note}</span>}
            </div>
            <dl className="mt-2 space-y-1">
                {rows.map(row => (
                    <div
                        key={row.key}
                        className={`flex items-baseline justify-between gap-6 ${row.separated ? 'mt-1.5 border-t border-border pt-1.5' : ''}`}
                    >
                        <dt className="flex items-center gap-2 text-foreground-secondary">
                            {row.swatch && (
                                <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ backgroundColor: row.swatch }} />
                            )}
                            {row.label}
                        </dt>
                        <dd className={`font-mono font-medium ${row.valueClassName ?? 'text-foreground'}`} style={TNUM}>
                            {row.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

/** A legend entry that shows or hides its series. Keyboard reachable, state announced. */
export function SeriesToggle({
    label,
    color,
    pressed,
    onToggle,
    shape = 'line',
    disabled = false,
}: {
    label: string;
    color: string;
    pressed: boolean;
    onToggle: () => void;
    shape?: 'line' | 'block' | 'tick';
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onToggle}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:hover:bg-transparent ${
                pressed ? 'text-foreground-secondary' : 'text-foreground-muted line-through'
            }`}
        >
            <span
                aria-hidden="true"
                className={shape === 'block' ? 'h-2.5 w-2.5 rounded-sm' : shape === 'tick' ? 'h-0.5 w-3' : 'h-0.5 w-3.5 rounded-full'}
                style={{ backgroundColor: pressed ? color : 'var(--foreground-muted)' }}
            />
            {label}
        </button>
    );
}

/**
 * The same numbers as a table for screen readers. A chart's shape is not
 * reachable without sight; its values should be.
 */
export function ChartDataTable({
    caption,
    columns,
    rows,
}: {
    caption: string;
    columns: string[];
    rows: Array<{ key: string; cells: ReactNode[] }>;
}) {
    return (
        <table className="sr-only">
            <caption>{caption}</caption>
            <thead>
                <tr>
                    {columns.map(column => <th key={column} scope="col">{column}</th>)}
                </tr>
            </thead>
            <tbody>
                {rows.map(row => (
                    <tr key={row.key}>
                        {row.cells.map((cell, index) => (index === 0
                            ? <th key={index} scope="row">{cell}</th>
                            : <td key={index}>{cell}</td>))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
