'use client';

import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/format';
import {
  CostBasisCoverageMark,
  CoveredSliceNote,
  gainHeading,
  BASIS_CONSEQUENCE,
} from '@/components/investments/CostBasisCoverageMark';
import type { CostBasisCoverage } from '@/lib/holdings-coverage';
import { Abbr } from '@/components/ui/Abbr';
import { KpiCard, signTone } from '@/components/investments/ui';

/** Where each card drills to. Every KPI opens the view that explains it. */
export interface PortfolioSummaryLinks {
  value: string;
  cash: string;
  costBasis: string;
  gain: string;
  performance: string;
}

export const DEFAULT_SUMMARY_LINKS: PortfolioSummaryLinks = {
  value: '#holdings',
  cash: '/investments?view=cash',
  costBasis: '/reports/investment_lots',
  gain: '/reports/investment_lots',
  performance: '/investments?view=benchmark',
};

interface PortfolioSummaryCardsProps {
  totalValue: number;
  totalCostBasis: number;
  /**
   * What `totalCostBasis` and `totalGainLoss` describe. Required, not optional:
   * these cards summarise a whole portfolio in three numbers, and a summary
   * that silently omits its coverage is exactly how a partial basis gets read
   * as a complete one.
   */
  totalCostBasisCoverage: CostBasisCoverage;
  /** Sum of the per-holding covered gains — never totalValue - totalCostBasis. */
  totalGainLoss: number;
  performancePercent: number;
  performanceMetric: 'twr' | 'mwr';
  /** Cash held inside the investment accounts, when known. */
  cash?: { balance: number; percent: number };
  links?: Partial<PortfolioSummaryLinks>;
  /** CTA under the return card (default: compare against indices). */
  performanceCta?: string;
  /** What Total Value includes, e.g. "Holdings at market, excl. cash". */
  valueSub?: ReactNode;
}

export function PortfolioSummaryCards({
  totalValue,
  totalCostBasis,
  totalCostBasisCoverage,
  totalGainLoss,
  performancePercent = 0,
  performanceMetric,
  cash,
  links,
  performanceCta = 'Compare to indices',
  valueSub,
}: PortfolioSummaryCardsProps) {
  const href = { ...DEFAULT_SUMMARY_LINKS, ...links };
  const safePerformancePercent = Number.isFinite(performancePercent) ? performancePercent : 0;
  const metricTerm = performanceMetric === 'twr' ? 'TWR' : 'MWR';

  const basisMark = (
    <CostBasisCoverageMark coverage={totalCostBasisCoverage} consequence={BASIS_CONSEQUENCE} />
  );

  // One responsive card set: Total Value leads full-width on phones, the rest
  // pair up beneath it. The covered-slice note is always-visible text on every
  // size — the phone is the device least able to hover a tooltip.
  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${cash ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      <KpiCard
        className="col-span-2 lg:col-span-1"
        emphasis
        label="Total Value"
        value={formatCurrency(totalValue)}
        sub={valueSub}
        href={href.value}
        cta="Holdings by value"
      />
      {cash && (
        <KpiCard
          label="Cash"
          value={formatCurrency(cash.balance)}
          sub={`${cash.percent.toFixed(1)}% of portfolio`}
          href={href.cash}
          cta="Cash by account"
        />
      )}
      <KpiCard
        label="Cost Basis"
        value={formatCurrency(totalCostBasis)}
        adornment={basisMark}
        sub={<CoveredSliceNote coverage={totalCostBasisCoverage} />}
        href={href.costBasis}
        cta="Lot-level basis"
      />
      <KpiCard
        // "Total Gain/Loss" only when the basis behind it covers every share.
        label={`Total ${gainHeading(totalCostBasisCoverage)}`}
        value={formatCurrency(totalGainLoss)}
        tone={signTone(totalGainLoss)}
        adornment={basisMark}
        sub={<CoveredSliceNote coverage={totalCostBasisCoverage} />}
        href={href.gain}
        cta="Realized vs unrealized"
      />
      <KpiCard
        className={cash ? '' : 'col-span-2 lg:col-span-1'}
        label={<>Return · <Abbr term={metricTerm} /></>}
        value={`${safePerformancePercent >= 0 ? '+' : ''}${safePerformancePercent.toFixed(2)}%`}
        tone={safePerformancePercent >= 0 ? 'positive' : 'negative'}
        sub={performanceMetric === 'twr' ? 'Time-weighted, since inception' : 'Money-weighted, since inception'}
        href={href.performance}
        cta={performanceCta}
      />
    </div>
  );
}
