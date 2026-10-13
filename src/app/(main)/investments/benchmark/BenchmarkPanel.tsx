'use client';

import { useCallback, useEffect, useState } from 'react';
import ExpandableChart, { ExpandedContext } from '@/components/charts/ExpandableChart';
import { Abbr } from '@/components/ui/Abbr';
import {
  CHART_EXPAND_BUTTON,
  ChartPanel,
  EmptyState,
  KpiCard,
  Segmented,
} from '@/components/investments/ui';
import { useToast } from '@/contexts/ToastContext';
import {
  BENCHMARK_INDEX_OPTIONS,
  DEFAULT_BENCHMARK_SYMBOL,
  type BenchmarkIndexOption,
  type BenchmarkWindow,
} from '@/lib/investment-benchmark-constants';
import type { BenchmarkComparison } from '@/lib/investment-benchmark';
import { BenchmarkChart } from './BenchmarkChart';

const WINDOWS: { key: BenchmarkWindow; label: string }[] = [
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' },
  { key: 'max', label: 'Max' },
];

interface BenchmarkResponse extends BenchmarkComparison {
  availableIndices: BenchmarkIndexOption[];
  backfillEndpoint: string;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function BenchmarkPanel() {
  const { success, error: showError, warning } = useToast();

  const [indexSymbol, setIndexSymbol] = useState<string>(DEFAULT_BENCHMARK_SYMBOL);
  const [window, setWindow] = useState<BenchmarkWindow>('1Y');
  const [data, setData] = useState<BenchmarkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ index: indexSymbol, window });
      const res = await fetch(`/api/investments/benchmark?${params}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        showError(json.error || 'Failed to load benchmark comparison');
      }
    } catch {
      showError('Failed to load benchmark comparison');
    } finally {
      setLoading(false);
    }
  }, [indexSymbol, window, showError]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/api/investments/backfill-indices', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        warning(json.error || 'Backfill requires admin access');
        return;
      }
      if (json.totalStored > 0) {
        success(`Backfilled ${json.totalStored} index prices`);
      } else {
        success('Index prices are already up to date');
      }
      await fetchData();
    } catch {
      showError('Failed to backfill index prices');
    } finally {
      setBackfilling(false);
    }
  }, [fetchData, success, warning, showError]);

  const indexOptions = data?.availableIndices ?? BENCHMARK_INDEX_OPTIONS;

  return (
    <div className="space-y-6">
      {/* Comparison controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-foreground-secondary">
          <Abbr term="TWR" /> portfolio return against a market index.
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="Benchmark index"
            value={indexSymbol}
            onChange={setIndexSymbol}
            options={indexOptions.map(opt => ({ value: opt.symbol, label: opt.name }))}
          />
          <Segmented ariaLabel="Window" value={window} onChange={setWindow} options={WINDOWS.map(w => ({ value: w.key, label: w.label }))} />
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-[124px] rounded-lg border border-border bg-surface animate-pulse ${i === 3 ? 'col-span-2 lg:col-span-1' : ''}`} />
            ))}
          </div>
          <div className="h-80 rounded-lg border border-border bg-surface animate-pulse" />
        </div>
      ) : !data ? (
        <EmptyState title="No benchmark data available" />
      ) : (
        <>
          {/* Headline cards — each opens what explains it */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <KpiCard
              label="Your return"
              value={formatPercent(data.portfolioReturn)}
              tone={data.portfolioReturn >= 0 ? 'positive' : 'negative'}
              sub="Time-weighted return"
              href="#growth"
              cta="Growth chart"
            />
            <KpiCard
              label={`${data.indexName} return`}
              value={data.insufficientCoverage ? '—' : formatPercent(data.indexReturn)}
              tone={data.indexReturn >= 0 ? 'positive' : 'negative'}
              sub={`${data.indexSymbol} total return`}
              href="#growth"
              cta="Growth chart"
            />
            <KpiCard
              className="col-span-2 lg:col-span-1"
              label="Difference (alpha)"
              value={data.insufficientCoverage ? '—' : formatPercent(data.alpha)}
              tone={data.alpha >= 0 ? 'positive' : 'negative'}
              sub={
                data.insufficientCoverage
                  ? 'Needs index coverage'
                  : data.alpha >= 0
                    ? `Ahead of the ${data.indexName}`
                    : `Behind the ${data.indexName}`
              }
              href="/investments/accounts"
              cta="Returns by account"
            />
          </div>

          {/* Coverage prompt */}
          {data.insufficientCoverage && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <p className="text-sm text-warning">
                {data.coverageNote ||
                  `No ${data.indexName} price data covers this window.`}
              </p>
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover disabled:bg-primary/30 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors shrink-0"
              >
                {backfilling ? 'Backfilling…' : 'Backfill index prices'}
              </button>
            </div>
          )}

          {/* Comparison chart */}
          <div id="growth" className="scroll-mt-6">
            <ExpandableChart title={`Growth of 100 — Portfolio vs ${data.indexName}`} expandButtonClassName={CHART_EXPAND_BUTTON}>
              <ExpandedContext.Consumer>
                {expanded => (
                  <ChartPanel
                    expanded={expanded}
                    title={`Growth of 100 — Portfolio vs ${data.indexName}`}
                    footer={
                      <p className="text-xs text-foreground-muted">
                        Both lines start at 100 on{' '}
                        {data.startDate ? new Date(data.startDate).toLocaleDateString() : 'the window start'}.
                        Your line is the time-weighted return (contributions and withdrawals removed); the index
                        line is the price rebased to 100.
                      </p>
                    }
                  >
                    <BenchmarkChart series={data.series} indexName={data.indexName} height={360} />
                  </ChartPanel>
                )}
              </ExpandedContext.Consumer>
            </ExpandableChart>
          </div>
        </>
      )}
    </div>
  );
}
