'use client';

import { useContext } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatCurrency } from '@/lib/format';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { ALLOCATION_COLORS, CHART_THEME } from '@/components/investments/ui';

interface SectorExposure {
  sector: string;
  value: number;
  percent: number;
}

interface IndustryExposureChartProps {
  data: SectorExposure[];
}

const SECTOR_COLORS = ALLOCATION_COLORS;

export function IndustryExposureChart({ data }: IndustryExposureChartProps) {
  const expanded = useContext(ExpandedContext);

  if (!data || data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-foreground-muted">No sector data available</p>
    );
  }

  // Sort by value descending (should already be sorted from API)
  const sorted = [...data].sort((a, b) => b.value - a.value);

  const chartHeight = expanded
    ? Math.max(400, sorted.length * 40)
    : Math.max(250, sorted.length * 32);

  return (
    <div className={expanded ? 'h-full' : ''}>
      <ResponsiveContainer width="100%" height={expanded ? '100%' : chartHeight}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            tick={CHART_THEME.tick}
            axisLine={{ stroke: CHART_THEME.axis }}
            tickLine={{ stroke: CHART_THEME.axis }}
          />
          <YAxis
            type="category"
            dataKey="sector"
            width={expanded ? 160 : 130}
            tick={{ ...CHART_THEME.tickStrong, fontSize: expanded ? 13 : 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={CHART_THEME.tooltip.contentStyle}
            labelStyle={CHART_THEME.tooltip.labelStyle}
            itemStyle={CHART_THEME.tooltip.itemStyle}
            cursor={{ fill: 'var(--surface-hover)' }}
            formatter={(value, _name, entry) => {
              const numValue = typeof value === 'number' ? value : 0;
              const payload = (entry as { payload: SectorExposure }).payload;
              return [
                `${formatCurrency(payload.value)} (${numValue.toFixed(1)}%)`,
                'Allocation',
              ];
            }}
          />
          <Bar dataKey="percent" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {sorted.map((entry, index) => (
              <Cell
                key={entry.sector}
                fill={SECTOR_COLORS[index % SECTOR_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
