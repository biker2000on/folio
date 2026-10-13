'use client';

import { useContext } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency } from '@/lib/format';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { ALLOCATION_COLORS } from '@/components/investments/ui';

interface AllocationChartProps {
  data: Array<{
    category: string;
    value: number;
    percent: number;
  }>;
  /** Shown in the donut hole. */
  centerLabel?: string;
}

interface AllocationLegendPayload {
  percent?: number;
  category?: string;
}

const TNUM = { fontFeatureSettings: "'tnum'" } as const;

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

/**
 * Donut plus a ranked legend. The legend carries the numbers (share and
 * value per slice), so the chart reads without hovering and the panel's
 * width is used rather than leaving a small ring in an empty card.
 * Renders bare: the surrounding Panel owns the title and controls.
 */
export function AllocationChart({ data, centerLabel = 'Total' }: AllocationChartProps) {
  const expanded = useContext(ExpandedContext);

  if (!data || data.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No allocation data available</p>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const colored = data.map((d, i) => ({ ...d, color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }));
  const ranked = [...colored].sort((a, b) => b.value - a.value);

  return (
    <div
      className={`grid items-center gap-5 ${
        expanded
          ? 'h-full grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]'
          : 'flex-1 grid-cols-1 content-center @lg:grid-cols-[200px_minmax(0,1fr)] @2xl:grid-cols-[240px_minmax(0,1fr)]'
      }`}
    >
      <div className={expanded ? 'h-[50vh] md:h-full' : 'mx-auto h-[200px] w-[200px] @2xl:h-[240px] @2xl:w-[240px]'}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={colored}
              dataKey="value"
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {colored.map(entry => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
            </Pie>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central">
              <tspan x="50%" dy="-0.6em" fill="var(--foreground-muted)" fontSize={11}>{centerLabel}</tspan>
              <tspan
                x="50%"
                dy="1.4em"
                fill="var(--foreground)"
                fontSize={expanded ? 20 : 15}
                fontWeight={600}
                fontFamily="var(--font-mono, ui-monospace)"
              >
                {formatCompactCurrency(total)}
              </tspan>
            </text>
            <Tooltip
              content={({ active, payload: tooltipPayload }) => {
                if (!active || !tooltipPayload || tooltipPayload.length === 0) return null;
                const entry = tooltipPayload[0];
                const entryPayload = (entry?.payload ?? {}) as AllocationLegendPayload & { value?: number };
                const numValue = typeof entry?.value === 'number' ? entry.value : 0;
                const percent = total > 0 ? (numValue / total) * 100 : 0;
                return (
                  <div className="rounded-md border border-border bg-surface-elevated px-3 py-2 shadow-lg">
                    <p className="text-sm font-medium text-foreground">{entryPayload.category ?? ''}</p>
                    <p className="font-mono text-xs text-foreground-secondary" style={TNUM}>
                      {formatCurrency(numValue)} ({percent.toFixed(1)}%)
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul
        className={`min-w-0 divide-y divide-border/60 ${expanded ? 'max-h-full overflow-y-auto' : 'max-h-[240px] overflow-y-auto @lg:max-h-[280px] pr-1 [scrollbar-width:thin]'}`}
        aria-label="Allocation breakdown"
      >
        {ranked.map(entry => (
          <li key={entry.category} className="flex items-center gap-3 py-1.5 text-sm">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="min-w-0 flex-1 truncate text-foreground-secondary">{entry.category}</span>
            <span className="shrink-0 font-mono text-xs text-foreground-muted" style={TNUM}>
              {formatCurrency(entry.value)}
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-xs font-medium text-foreground" style={TNUM}>
              {entry.percent.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
