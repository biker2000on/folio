'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInvestmentData } from '@/contexts/InvestmentDataContext';
import { PortfolioSummaryCards } from '@/components/investments/PortfolioSummaryCards';
import { AllocationChart } from '@/components/investments/AllocationChart';
import { IndustryExposureChart } from '@/components/investments/IndustryExposureChart';
import { PerformanceChart } from '@/components/investments/PerformanceChart';
import { HoldingsTable } from '@/components/investments/HoldingsTable';
import ExpandableChart, { ExpandedContext } from '@/components/charts/ExpandableChart';
import { calculateMoneyWeightedReturn, calculateTimeWeightedReturn } from '@/lib/investment-performance';
import { ScrubAllButton } from '@/components/investments/ScrubAllButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { RelatedLinks } from '@/components/RelatedLinks';
import { CashAllocationCard } from '@/components/investments/CashAllocationCard';
import {
  CHART_EXPAND_BUTTON,
  ChartPanel,
  EmptyState,
  InvestmentsPage,
  SectionTabs,
  Segmented,
} from '@/components/investments/ui';
import { BenchmarkPanel } from './benchmark/BenchmarkPanel';

type AllocationTab = 'holdings' | 'cashPct' | 'cashAcct' | 'sector';
type InvestmentView = 'overview' | 'cash' | 'benchmark';
type CashSortMode = 'percent' | 'amount';

const VIEW_TABS = [
  { key: 'overview', href: '/investments', label: 'Overview' },
  { key: 'cash', href: '/investments?view=cash', label: 'Cash' },
  { key: 'benchmark', href: '/investments?view=benchmark', label: 'Benchmark' },
];

const ALLOCATION_OPTIONS: { value: AllocationTab; label: string }[] = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'cashPct', label: 'Cash %' },
  { value: 'cashAcct', label: 'Cash by Account' },
  { value: 'sector', label: 'Sector' },
];

export default function HoldingsPage() {
  const searchParams = useSearchParams();
  const {
    portfolio, history, portfolioCashFlows, indices, loading, fetchingPrices,
    apiConfigured, handleFetchAllPrices
  } = useInvestmentData();

  const [allocationTab, setAllocationTab] = useState<AllocationTab>('holdings');
  const [performanceMetric, setPerformanceMetric] = useState<'twr' | 'mwr'>('twr');
  const [cashSortMode, setCashSortMode] = useState<CashSortMode>('percent');
  const requestedView = searchParams.get('view');
  const view: InvestmentView =
    requestedView === 'cash' || requestedView === 'benchmark' ? requestedView : 'overview';

  const performancePercent = useMemo(() => {
    if (performanceMetric === 'mwr') {
      return calculateMoneyWeightedReturn(history, portfolioCashFlows);
    }

    return calculateTimeWeightedReturn(history, portfolioCashFlows);
  }, [history, performanceMetric, portfolioCashFlows]);
  const safePerformancePercent = Number.isFinite(performancePercent) ? performancePercent : 0;

  const pageHeader = (
    <PageHeader
      title="Investments"
      subtitle={
        view === 'cash'
          ? 'Cash allocation across investment accounts'
          : view === 'benchmark'
            ? 'Portfolio performance against market indices'
            : 'Portfolio overview and performance'
      }
      actions={<ScrubAllButton />}
      menuActions={[
        {
          label: fetchingPrices ? 'Fetching prices...' : 'Refresh All Prices',
          onSelect: handleFetchAllPrices,
          disabled: fetchingPrices,
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ),
        },
      ]}
    />
  );

  const viewTabs = <SectionTabs ariaLabel="Investment views" tabs={VIEW_TABS} active={view} />;

  if (view === 'benchmark') {
    return (
      <InvestmentsPage>
        {pageHeader}
        {viewTabs}
        <BenchmarkPanel />
      </InvestmentsPage>
    );
  }

  // Cash as % of total portfolio (2-slice pie: Cash vs Investments)
  const cashPctOfPortfolio = portfolio?.overallCash ? [
    {
      category: 'Cash',
      value: portfolio.overallCash.totalCashBalance,
      percent: portfolio.overallCash.cashPercent,
    },
    {
      category: 'Investments',
      value: portfolio.overallCash.totalInvestmentValue,
      percent: 100 - portfolio.overallCash.cashPercent,
    },
  ] : [];

  // Cash distribution by account (which account holds what share of total cash)
  const cashByAccountPie = portfolio?.cashByAccount?.map(a => ({
    category: a.parentName,
    value: a.cashBalance,
    percent: portfolio.overallCash.totalCashBalance > 0
      ? (a.cashBalance / portfolio.overallCash.totalCashBalance) * 100
      : 0,
  })) ?? [];

  if (loading) {
    return (
      <InvestmentsPage>
        {pageHeader}
        {viewTabs}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className={`h-[104px] rounded-lg border border-border bg-surface animate-pulse sm:h-[124px] ${i === 1 ? 'col-span-2 lg:col-span-1' : ''}`}
            />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="h-[420px] rounded-lg border border-border bg-surface animate-pulse xl:col-span-7" />
          <div className="h-[420px] rounded-lg border border-border bg-surface animate-pulse xl:col-span-5" />
        </div>
      </InvestmentsPage>
    );
  }

  if (view === 'cash') {
    if (!portfolio?.cashByAccount?.length) {
      return (
        <InvestmentsPage>
          {pageHeader}
          {viewTabs}
          <EmptyState title="No cash data available">
            Cash balances will appear here once detected in your investment accounts.
          </EmptyState>
        </InvestmentsPage>
      );
    }

    const sortedCash = [...portfolio.cashByAccount].sort((a, b) =>
      cashSortMode === 'percent'
        ? b.cashPercent - a.cashPercent
        : b.cashBalance - a.cashBalance
    );

    return (
      <InvestmentsPage>
        {pageHeader}
        {viewTabs}
        <CashAllocationCard
          cashByAccount={sortedCash}
          overallCash={portfolio.overallCash}
          actions={
            <Segmented
              ariaLabel="Sort accounts"
              value={cashSortMode}
              onChange={setCashSortMode}
              options={[
                { value: 'percent', label: 'Sort by %' },
                { value: 'amount', label: 'Sort by $' },
              ]}
            />
          }
        />
      </InvestmentsPage>
    );
  }

  if (!portfolio || portfolio.holdings.length === 0) {
    return (
      <InvestmentsPage>
        {pageHeader}
        {viewTabs}
        <EmptyState title="No investment accounts found">
          Investment accounts (STOCK type) will appear here once they exist in your book.
        </EmptyState>
      </InvestmentsPage>
    );
  }

  const allocationTitle = allocationTab === 'holdings'
    ? 'Portfolio Allocation'
    : allocationTab === 'cashPct'
      ? 'Cash % of Portfolio'
      : allocationTab === 'cashAcct'
        ? 'Cash by Account'
        : 'Sector Exposure';

  const allocationBody = allocationTab === 'holdings' ? (
    <AllocationChart data={portfolio.allocation} />
  ) : allocationTab === 'cashPct' ? (
    <AllocationChart data={cashPctOfPortfolio} />
  ) : allocationTab === 'cashAcct' ? (
    <AllocationChart data={cashByAccountPie} centerLabel="Cash" />
  ) : (
    <IndustryExposureChart data={portfolio.sectorExposure} />
  );

  return (
    <InvestmentsPage>
      {pageHeader}
      {viewTabs}

      {/* API Not Configured Warning */}
      {!apiConfigured && (
        <div className="bg-warning-light border border-warning/50 rounded-lg p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-warning flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-warning font-medium">Price API Not Configured</p>
            <p className="text-warning/70 text-sm">Price service is not available. Check server logs for details.</p>
          </div>
        </div>
      )}

      {/* Summary cards — each one opens the view that explains it */}
      <PortfolioSummaryCards
        totalValue={portfolio.summary.totalValue}
        totalCostBasis={portfolio.summary.totalCostBasis}
        totalCostBasisCoverage={portfolio.summary.totalCostBasisCoverage}
        totalGainLoss={portfolio.summary.totalGainLoss}
        performancePercent={safePerformancePercent}
        performanceMetric={performanceMetric}
        valueSub="Holdings at market, excl. cash"
        cash={
          portfolio.overallCash
            ? { balance: portfolio.overallCash.totalCashBalance, percent: portfolio.overallCash.cashPercent }
            : undefined
        }
      />

      {/* Charts: performance leads, allocation beside it on wide screens */}
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <ExpandableChart title="Portfolio Performance" expandButtonClassName={CHART_EXPAND_BUTTON}>
            <PerformanceChart
              data={history}
              cashFlows={portfolioCashFlows}
              indices={indices}
              returnMetric={performanceMetric}
              onReturnMetricChange={setPerformanceMetric}
            />
          </ExpandableChart>
        </div>
        <div className="min-w-0 xl:col-span-5">
          <ExpandableChart title={allocationTitle} expandButtonClassName={CHART_EXPAND_BUTTON}>
            <ExpandedContext.Consumer>
              {expanded => (
                <ChartPanel
                  expanded={expanded}
                  title="Allocation"
                  actions={
                    <Segmented
                      ariaLabel="Allocation view"
                      options={ALLOCATION_OPTIONS}
                      value={allocationTab}
                      onChange={setAllocationTab}
                    />
                  }
                >
                  {allocationBody}
                </ChartPanel>
              )}
            </ExpandedContext.Consumer>
          </ExpandableChart>
        </div>
      </div>

      {/* Holdings Table */}
      <HoldingsTable
        holdings={portfolio.holdings}
        consolidatedHoldings={portfolio.consolidatedHoldings}
      />
      <RelatedLinks ids={['nav-inv-rebalancing', 'tool-sell-planner', 'rpt-lots', 'rpt-nw-attribution']} />
    </InvestmentsPage>
  );
}
