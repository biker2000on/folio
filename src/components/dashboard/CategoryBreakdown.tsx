'use client';

import { useContext, type ReactNode } from 'react';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { TNUM } from '@/components/ui/form';

export interface CategoryDatum {
    name: string;
    value: number;
}

/** Rows shown before the remainder is summed into one line. */
const COLLAPSED_ROWS = 7;

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

function formatShare(share: number): string {
    const percent = Math.round(share * 100);
    return share > 0 && percent < 1 ? '<1%' : `${percent}%`;
}

/**
 * A ranked breakdown: one row per category, largest first, with its amount,
 * its share of the total and a bar whose length is that share.
 *
 * This replaces the dashboard's three donuts. A ranked list answers "what are
 * the biggest ones and by how much" directly, keeps every name readable at a
 * third of the page width, and needs one colour instead of ten.
 */
export function CategoryBreakdown({
    title,
    data,
    loading,
    emptyMessage,
    emptyHint,
}: {
    title: string;
    data: CategoryDatum[];
    loading: boolean;
    emptyMessage: string;
    emptyHint?: ReactNode;
}) {
    const expanded = useContext(ExpandedContext);
    const shell = `flex min-w-0 flex-col rounded-lg border border-border bg-surface ${expanded ? 'h-full' : 'h-full'}`;

    if (loading) {
        return (
            <div className={`${shell} animate-pulse p-5`} aria-busy="true">
                <div className="mb-5 h-4 w-40 rounded bg-background-secondary" />
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="mb-4 h-7 rounded bg-background-secondary" />
                ))}
            </div>
        );
    }

    const rows = [...(data ?? [])].filter(row => row.value > 0).sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, row) => sum + row.value, 0);

    if (rows.length === 0 || total <= 0) {
        return (
            <div className={shell}>
                <header className="border-b border-border px-5 py-3">
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                </header>
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                    <p className="text-sm text-foreground-muted">{emptyMessage}</p>
                    {emptyHint && <p className="max-w-[44ch] text-xs text-foreground-muted">{emptyHint}</p>}
                </div>
            </div>
        );
    }

    const limit = expanded ? rows.length : COLLAPSED_ROWS;
    const shown = rows.slice(0, limit);
    const rest = rows.slice(limit);
    const restTotal = rest.reduce((sum, row) => sum + row.value, 0);
    const largest = shown[0].value;

    return (
        <div className={shell}>
            <header className="flex items-baseline justify-between gap-4 border-b border-border py-3 pl-5 pr-14">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <span className="font-mono text-sm font-semibold text-foreground" style={TNUM}>
                    {formatCurrency(total)}
                </span>
            </header>
            <ol className={`min-h-0 flex-1 px-5 py-2 ${expanded ? 'overflow-auto' : ''}`}>
                {shown.map(row => (
                    <li key={row.name} className="py-2">
                        <div className="flex items-baseline gap-3 text-sm">
                            <span className="min-w-0 flex-1 truncate text-foreground">{row.name}</span>
                            <span className="shrink-0 font-mono text-foreground" style={TNUM}>
                                {formatCurrency(row.value)}
                            </span>
                            <span className="w-9 shrink-0 text-right font-mono text-xs text-foreground-muted" style={TNUM}>
                                {formatShare(row.value / total)}
                            </span>
                        </div>
                        {/* Bars are scaled to the largest row so small categories stay visible. */}
                        <div className="mt-1.5 h-1 rounded-sm bg-background-tertiary" aria-hidden="true">
                            <div
                                className="h-1 rounded-sm bg-primary"
                                style={{ width: `${Math.max(1, (row.value / largest) * 100)}%` }}
                            />
                        </div>
                    </li>
                ))}
                {rest.length > 0 && (
                    <li className="flex items-baseline gap-3 border-t border-border py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                            {rest.length} smaller {rest.length === 1 ? 'category' : 'categories'}
                        </span>
                        <span className="shrink-0 font-mono text-foreground-secondary" style={TNUM}>
                            {formatCurrency(restTotal)}
                        </span>
                        <span className="w-9 shrink-0 text-right font-mono text-xs text-foreground-muted" style={TNUM}>
                            {formatShare(restTotal / total)}
                        </span>
                    </li>
                )}
            </ol>
        </div>
    );
}
