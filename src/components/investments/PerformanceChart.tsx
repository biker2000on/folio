'use client';

import { useState, useMemo, useContext, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area, ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/format';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { computeZeroOffset, CHART_COLORS, GRADIENT_FILL_OPACITY } from '@/lib/chart-utils';
import { ChartSettingsPanel } from './ChartSettingsPanel';
import type { ChartDefaults } from '@/lib/user-preferences';
import type { CashFlowPoint, IndicesData } from '@/types/investments';
import { calculateMoneyWeightedReturn, calculateTimeWeightedReturn } from '@/lib/investment-performance';
import { Tip } from '@/components/ui/Tooltip';
import { ChartPanel, CHART_THEME, Segmented, type SegmentedOption } from '@/components/investments/ui';

export type { ChartDefaults };

interface PerformanceChartProps {
  data: Array<{
    date: string;
    value: number;
  }>;
  cashFlows?: CashFlowPoint[];
  indices?: IndicesData;
  chartDefaults?: ChartDefaults;
  title?: string;
  returnMetric?: 'twr' | 'mwr';
  onReturnMetricChange?: (metric: 'twr' | 'mwr') => void;
}

type Period = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL';
type ChartMode = 'value' | 'twr' | 'mwr';

const INDEX_COLORS = {
  sp500: '#f97316',    // orange
  djia: '#a855f7',     // purple
  nasdaq: '#22c55e',   // green
  russell2000: '#ec4899', // pink
  portfolio: '#14b8a6', // teal
};

export function PerformanceChart({
  data,
  cashFlows = [],
  indices,
  chartDefaults,
  title = 'Portfolio Performance',
  returnMetric = 'twr',
  onReturnMetricChange,
}: PerformanceChartProps) {
  const expanded = useContext(ExpandedContext);

  const initialPeriod = (chartDefaults?.defaultPeriod as Period) || '1Y';
  const resolveChartMode = useCallback((defaultMode?: ChartDefaults['defaultMode']): ChartMode => {
    if (defaultMode === 'twr' || defaultMode === 'mwr') {
      return defaultMode;
    }

    return 'value';
  }, []);

  const initialMode: ChartMode = resolveChartMode(chartDefaults?.defaultMode);

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [chartMode, setChartMode] = useState<ChartMode>(initialMode);
  const [showSP500, setShowSP500] = useState(chartDefaults?.sp500Enabled ?? false);
  const [showDJIA, setShowDJIA] = useState(chartDefaults?.djiaEnabled ?? false);
  const [showNasdaq, setShowNasdaq] = useState(chartDefaults?.nasdaqEnabled ?? false);
  const [showRussell2000, setShowRussell2000] = useState(chartDefaults?.russell2000Enabled ?? false);
  const [currentDefaults, setCurrentDefaults] = useState<ChartDefaults | undefined>(chartDefaults);
  const [defaultsLoaded, setDefaultsLoaded] = useState(!!chartDefaults);

  // Self-load chart defaults from API if not provided via props
  useEffect(() => {
    if (chartDefaults || defaultsLoaded) return;
    let cancelled = false;
    async function loadDefaults() {
      try {
        const res = await fetch('/api/user/preferences?key=chart_defaults');
        if (!res.ok) return;
        const data: ChartDefaults = await res.json();
        if (cancelled) return;
        setCurrentDefaults(data);
        setPeriod((data.defaultPeriod as Period) || '1Y');
        setChartMode(resolveChartMode(data.defaultMode));
        setShowSP500(data.sp500Enabled);
        setShowDJIA(data.djiaEnabled);
        setShowNasdaq(data.nasdaqEnabled);
        setShowRussell2000(data.russell2000Enabled);
      } catch {
        // Ignore - use defaults
      } finally {
        if (!cancelled) setDefaultsLoaded(true);
      }
    }
    loadDefaults();
    return () => { cancelled = true; };
  }, [chartDefaults, defaultsLoaded, resolveChartMode]);

  // Sync with chartDefaults prop when it changes (e.g., after settings save)
  useEffect(() => {
    if (chartDefaults) {
      setCurrentDefaults(chartDefaults);
    }
  }, [chartDefaults]);

  useEffect(() => {
    setChartMode((currentMode) => {
      if (currentMode === 'value') {
        return currentMode;
      }

      return returnMetric;
    });
  }, [returnMetric]);

  const handleSettingsChange = useCallback((newDefaults: ChartDefaults) => {
    setCurrentDefaults(newDefaults);
    setShowSP500(newDefaults.sp500Enabled);
    setShowDJIA(newDefaults.djiaEnabled);
    setShowNasdaq(newDefaults.nasdaqEnabled);
    setShowRussell2000(newDefaults.russell2000Enabled);
    setPeriod((newDefaults.defaultPeriod as Period) || '1Y');
    setChartMode(resolveChartMode(newDefaults.defaultMode));
  }, [resolveChartMode]);

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (period === 'ALL') return data;

    const now = new Date();
    const cutoffDate = new Date();

    switch (period) {
      case '1M': cutoffDate.setMonth(now.getMonth() - 1); break;
      case '3M': cutoffDate.setMonth(now.getMonth() - 3); break;
      case '6M': cutoffDate.setMonth(now.getMonth() - 6); break;
      case '1Y': cutoffDate.setFullYear(now.getFullYear() - 1); break;
      case '3Y': cutoffDate.setFullYear(now.getFullYear() - 3); break;
      case '5Y': cutoffDate.setFullYear(now.getFullYear() - 5); break;
    }

    return data.filter(d => new Date(d.date) >= cutoffDate);
  }, [data, period]);

  const filteredCashFlows = useMemo(() => {
    if (!cashFlows || cashFlows.length === 0) return [];
    if (filteredData.length === 0) return [];

    const startDate = filteredData[0]?.date;
    const endDate = filteredData[filteredData.length - 1]?.date;

    if (!startDate || !endDate) return [];

    return cashFlows.filter((cashFlow) => cashFlow.date >= startDate && cashFlow.date <= endDate);
  }, [cashFlows, filteredData]);

  const displayData = useMemo(() => {
    if (filteredData.length === 0) return [];

    if (chartMode === 'value') {
      return filteredData;
    }

    const portfolioSeries = filteredData.map((point, index) => {
      const historySlice = filteredData.slice(0, index + 1);
      const pointCashFlows = filteredCashFlows.filter((cashFlow) => cashFlow.date <= point.date);
      const value = chartMode === 'mwr'
        ? calculateMoneyWeightedReturn(historySlice, pointCashFlows)
        : calculateTimeWeightedReturn(historySlice, pointCashFlows);

      return {
        ...point,
        value: Number.isFinite(value) ? value : 0,
      };
    });

    if (chartMode === 'mwr') {
      return portfolioSeries;
    }

    const cutoffDateStr = filteredData[0]?.date;
    let sp500Base: number | null = null;
    let djiaBase: number | null = null;
    let nasdaqBase: number | null = null;
    let russell2000Base: number | null = null;

    if (indices?.sp500) {
      for (const pt of indices.sp500) {
        if (pt.date >= cutoffDateStr) { sp500Base = pt.value; break; }
      }
    }
    if (indices?.djia) {
      for (const pt of indices.djia) {
        if (pt.date >= cutoffDateStr) { djiaBase = pt.value; break; }
      }
    }
    if (indices?.nasdaq) {
      for (const pt of indices.nasdaq) {
        if (pt.date >= cutoffDateStr) { nasdaqBase = pt.value; break; }
      }
    }
    if (indices?.russell2000) {
      for (const pt of indices.russell2000) {
        if (pt.date >= cutoffDateStr) { russell2000Base = pt.value; break; }
      }
    }

    const sp500PctMap = new Map<string, number>();
    const djiaPctMap = new Map<string, number>();
    const nasdaqPctMap = new Map<string, number>();
    const russell2000PctMap = new Map<string, number>();

    if (sp500Base && indices?.sp500) {
      for (const pt of indices.sp500) {
        if (pt.date >= cutoffDateStr) {
          sp500PctMap.set(pt.date, Math.round(((pt.value - sp500Base) / sp500Base) * 10000) / 100);
        }
      }
    }
    if (djiaBase && indices?.djia) {
      for (const pt of indices.djia) {
        if (pt.date >= cutoffDateStr) {
          djiaPctMap.set(pt.date, Math.round(((pt.value - djiaBase) / djiaBase) * 10000) / 100);
        }
      }
    }
    if (nasdaqBase && indices?.nasdaq) {
      for (const pt of indices.nasdaq) {
        if (pt.date >= cutoffDateStr) {
          nasdaqPctMap.set(pt.date, Math.round(((pt.value - nasdaqBase) / nasdaqBase) * 10000) / 100);
        }
      }
    }
    if (russell2000Base && indices?.russell2000) {
      for (const pt of indices.russell2000) {
        if (pt.date >= cutoffDateStr) {
          russell2000PctMap.set(pt.date, Math.round(((pt.value - russell2000Base) / russell2000Base) * 10000) / 100);
        }
      }
    }

    return portfolioSeries.map(point => ({
      ...point,
      sp500: sp500PctMap.get(point.date) ?? null,
      djia: djiaPctMap.get(point.date) ?? null,
      nasdaq: nasdaqPctMap.get(point.date) ?? null,
      russell2000: russell2000PctMap.get(point.date) ?? null,
    }));
  }, [chartMode, filteredCashFlows, filteredData, indices]);

  const zeroOffset = useMemo(() => computeZeroOffset(displayData), [displayData]);

  const allPeriods: Period[] = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'ALL'];
  const periods = expanded ? allPeriods : (['1M', '6M', '1Y', 'ALL'] as Period[]);

  const isReturnMode = chartMode !== 'value';
  const isTimeWeightedMode = chartMode === 'twr';
  const hasIndices = indices && (indices.sp500.length > 0 || indices.djia.length > 0 || indices.nasdaq.length > 0 || indices.russell2000.length > 0);

  const periodOptions: SegmentedOption<Period>[] = periods.map(p => ({ value: p, label: p }));
  const modeOptions: SegmentedOption<ChartMode>[] = [
    { value: 'value', label: '$', ariaLabel: 'Dollar value', hint: 'Show dollar value' },
    { value: 'twr', label: 'TWR', hint: 'Time-weighted return' },
    { value: 'mwr', label: 'MWR', hint: 'Money-weighted return' },
  ];
  const handleModeChange = (mode: ChartMode) => {
    setChartMode(mode);
    if (mode !== 'value') onReturnMetricChange?.(mode);
  };

  const panelTitle = (
    <span className="flex items-center gap-1">
      {title}
      <ChartSettingsPanel currentDefaults={currentDefaults} onSettingsChange={handleSettingsChange} />
    </span>
  );
  const controls = (
    <>
      <Segmented ariaLabel="Time range" options={periodOptions} value={period} onChange={setPeriod} />
      <Segmented ariaLabel="Chart metric" options={modeOptions} value={chartMode} onChange={handleModeChange} />
    </>
  );

  if (!data || data.length === 0) {
    return (
      <ChartPanel expanded={expanded} title={panelTitle}>
        <p className="py-10 text-center text-sm text-foreground-muted">No performance data available</p>
      </ChartPanel>
    );
  }

  const indexToggles: Array<{ key: keyof typeof INDEX_COLORS; label: string; on: boolean; set: (v: boolean) => void }> = [
    { key: 'sp500', label: 'S&P 500', on: showSP500, set: setShowSP500 },
    { key: 'djia', label: 'Dow Jones', on: showDJIA, set: setShowDJIA },
    { key: 'nasdaq', label: 'NASDAQ', on: showNasdaq, set: setShowNasdaq },
    { key: 'russell2000', label: 'Russell 2000', on: showRussell2000, set: setShowRussell2000 },
  ];

  // Index lines are legend toggles under the chart rather than a third row of
  // header buttons; they only apply to the time-weighted view.
  const compareFooter = hasIndices ? (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="mr-2 text-xs font-medium text-foreground-muted">Compare</span>
      <span className="mr-1 inline-flex items-center gap-1.5 px-1 text-xs text-foreground-secondary">
        <span aria-hidden="true" className="h-0.5 w-3 rounded-sm" style={{ backgroundColor: INDEX_COLORS.portfolio }} />
        {title.replace(/ Performance$/, '')}
      </span>
      {indexToggles.map(t => {
        const active = isTimeWeightedMode && t.on;
        return (
          <Tip
            key={t.key}
            content={!isTimeWeightedMode ? 'Switch to TWR to compare against an index' : (t.on ? `Hide ${t.label}` : `Show ${t.label}`)}
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => isTimeWeightedMode && t.set(!t.on)}
              disabled={!isTimeWeightedMode}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors duration-150 sm:h-7 ${
                active
                  ? 'border-border-hover bg-surface-hover text-foreground'
                  : 'border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <span
                aria-hidden="true"
                className="h-0.5 w-3 rounded-sm"
                style={{ backgroundColor: active ? INDEX_COLORS[t.key] : 'var(--foreground-muted)' }}
              />
              {t.label}
            </button>
          </Tip>
        );
      })}
    </div>
  ) : undefined;

  const tooltipFormatter = (value: number | undefined, name?: string): [string, string] | [null, null] => {
    if (value === undefined || value === null) return [null, null];
    if (isReturnMode) {
      const labels: Record<string, string> = {
        value: chartMode === 'mwr' ? 'Portfolio MWR' : 'Portfolio TWR',
        sp500: 'S&P 500',
        djia: 'DJIA',
        nasdaq: 'NASDAQ',
        russell2000: 'Russell 2000',
      };
      return [`${Number(value).toFixed(2)}%`, labels[name || ''] || name || ''];
    }
    return [formatCurrency(value), 'Portfolio Value'];
  };

  return (
    <ChartPanel expanded={expanded} title={panelTitle} actions={controls} footer={compareFooter}>
      <div className={expanded ? 'h-full' : 'min-h-[300px] flex-1 sm:min-h-[340px]'}>
      <ResponsiveContainer width="100%" height="100%">
        {isReturnMode ? (
          <AreaChart data={displayData}>
            <defs>
              <linearGradient id="perfFillGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={GRADIENT_FILL_OPACITY} />
                <stop offset={`${zeroOffset * 100}%`} stopColor={CHART_COLORS.green} stopOpacity={GRADIENT_FILL_OPACITY} />
                <stop offset={`${zeroOffset * 100}%`} stopColor={CHART_COLORS.red} stopOpacity={GRADIENT_FILL_OPACITY} />
                <stop offset="100%" stopColor={CHART_COLORS.red} stopOpacity={GRADIENT_FILL_OPACITY} />
              </linearGradient>
              <linearGradient id="perfStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={1} />
                <stop offset={`${zeroOffset * 100}%`} stopColor={CHART_COLORS.green} stopOpacity={1} />
                <stop offset={`${zeroOffset * 100}%`} stopColor={CHART_COLORS.red} stopOpacity={1} />
                <stop offset="100%" stopColor={CHART_COLORS.red} stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
            <XAxis
              dataKey="date"
              stroke={CHART_THEME.axis}
              tick={CHART_THEME.tick}
              tickLine={false}
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis
              stroke={CHART_THEME.axis}
              tick={CHART_THEME.tick}
              tickLine={false}
              tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            />
            <Tooltip
              contentStyle={CHART_THEME.tooltip.contentStyle}
              labelStyle={CHART_THEME.tooltip.labelStyle}
              itemStyle={CHART_THEME.tooltip.itemStyle}
              formatter={tooltipFormatter as never}
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
            />
            <ReferenceLine y={0} stroke={CHART_THEME.zeroLine} strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="value"
              name="value"
              stroke="url(#perfStrokeGradient)"
              fill="url(#perfFillGradient)"
              fillOpacity={1}
              strokeWidth={2}
              dot={false}
              animationDuration={300}
              baseValue={0}
            />
            {showSP500 && (
              <Line
                type="monotone"
                dataKey="sp500"
                name="sp500"
                stroke={INDEX_COLORS.sp500}
                strokeWidth={1.5}
                dot={false}
                animationDuration={300}
                connectNulls
              />
            )}
            {showDJIA && (
              <Line
                type="monotone"
                dataKey="djia"
                name="djia"
                stroke={INDEX_COLORS.djia}
                strokeWidth={1.5}
                dot={false}
                animationDuration={300}
                connectNulls
              />
            )}
            {showNasdaq && (
              <Line
                type="monotone"
                dataKey="nasdaq"
                name="nasdaq"
                stroke={INDEX_COLORS.nasdaq}
                strokeWidth={1.5}
                dot={false}
                animationDuration={300}
                connectNulls
              />
            )}
            {showRussell2000 && (
              <Line
                type="monotone"
                dataKey="russell2000"
                name="russell2000"
                stroke={INDEX_COLORS.russell2000}
                strokeWidth={1.5}
                dot={false}
                animationDuration={300}
                connectNulls
              />
            )}
          </AreaChart>
        ) : (
          <LineChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
            <XAxis
              dataKey="date"
              stroke={CHART_THEME.axis}
              tick={CHART_THEME.tick}
              tickLine={false}
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis
              stroke={CHART_THEME.axis}
              tick={CHART_THEME.tick}
              tickLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={CHART_THEME.tooltip.contentStyle}
              labelStyle={CHART_THEME.tooltip.labelStyle}
              itemStyle={CHART_THEME.tooltip.itemStyle}
              formatter={(value) => value !== undefined ? [formatCurrency(Number(value)), 'Portfolio Value'] : ['', '']}
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#14b8a6"
              strokeWidth={2}
              dot={false}
              animationDuration={300}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}
