'use client';

import { useState, useMemo, useEffect } from 'react';
import { useInvestmentData } from '@/contexts/InvestmentDataContext';
import { AllocationChart } from '@/components/investments/AllocationChart';
import { IndustryExposureChart } from '@/components/investments/IndustryExposureChart';
import { PerformanceChart } from '@/components/investments/PerformanceChart';
import { HoldingsTable } from '@/components/investments/HoldingsTable';
import { PortfolioSummaryCards } from '@/components/investments/PortfolioSummaryCards';
import ExpandableChart, { ExpandedContext } from '@/components/charts/ExpandableChart';
import { calculateMoneyWeightedReturn, calculateTimeWeightedReturn } from '@/lib/investment-performance';
import { PageHeader } from '@/components/ui/PageHeader';
import { totalHoldings } from '@/lib/holdings-coverage';
import { SELECT } from '@/components/ui/form';
import {
  CHART_EXPAND_BUTTON,
  ChartPanel,
  EmptyState,
  InvestmentsPage,
  Segmented,
} from '@/components/investments/ui';

type AllocationTab = 'holdings' | 'cashPct' | 'sector';

export default function AccountsPage() {
  const { portfolio, indices, loading, fetchAccountHistory, getAccountHistory, getAccountCashFlows } = useInvestmentData();
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [allocationTab, setAllocationTab] = useState<AllocationTab>('holdings');
  const [performanceMetric, setPerformanceMetric] = useState<'twr' | 'mwr'>('twr');

  const parentAccounts = useMemo(() => {
    if (!portfolio) return [];
    return portfolio.cashByAccount.map((account) => ({
      key: account.parentGuid,
      name: account.parentName,
      path: account.parentPath,
    }));
  }, [portfolio]);

  const effectiveSelectedAccount = selectedAccount || parentAccounts[0]?.key || '';
  const selectedParentAccount = useMemo(
    () => parentAccounts.find((account) => account.key === effectiveSelectedAccount),
    [effectiveSelectedAccount, parentAccounts]
  );
  const selectedCashAccount = useMemo(
    () => portfolio?.cashByAccount.find((account) => account.parentGuid === effectiveSelectedAccount),
    [effectiveSelectedAccount, portfolio]
  );

  // Filter holdings for selected account
  const filteredHoldings = useMemo(() => {
    if (!portfolio || !selectedParentAccount) return [];
    const parentPathPrefix = `${selectedParentAccount.path}:`;

    return portfolio.holdings.filter((holding) =>
      holding.accountPath === selectedParentAccount.path || holding.accountPath.startsWith(parentPathPrefix)
    );
  }, [portfolio, selectedParentAccount]);

  const holdingsWithCash = useMemo(() => {
    if (!selectedCashAccount || Math.abs(selectedCashAccount.cashBalance) < 0.01) {
      return filteredHoldings;
    }

    return [
      {
        accountGuid: selectedCashAccount.cashAccountGuid || selectedCashAccount.parentGuid,
        accountName:
          selectedCashAccount.cashSource === 'parent'
            ? `${selectedCashAccount.cashAccountName || selectedCashAccount.parentName} (Parent Cash)`
            : selectedCashAccount.cashAccountName || 'Cash',
        accountPath: selectedCashAccount.cashAccountPath || selectedCashAccount.parentPath,
        symbol: 'CASH',
        shares: 0,
        costBasis: selectedCashAccount.cashBalance,
        // A cash balance is its own basis: nothing is traced, nothing is
        // missing, so this row carries no coverage caveat.
        costBasisCoverage: { status: 'complete' as const, coveredShares: 0 },
        marketValue: selectedCashAccount.cashBalance,
        gainLoss: 0,
        gainLossPercent: 0,
        isCash: true,
        disableNavigation: true,
      },
      ...filteredHoldings,
    ];
  }, [filteredHoldings, selectedCashAccount]);

  // Calculate filtered summary. Include cash so Total Value is the full account
  // value and stays consistent with the performance chart (which folds in cash).
  //
  // totalHoldings SUMS the per-holding covered gains. The old
  // `totalValue - totalCostBasis` put every uncovered share's full market value
  // back into the total, so this card read $6,500 above a visible row that said
  // $4,000 — a total that disagrees with the sum of the rows beneath it.
  const filteredSummary = useMemo(
    () => totalHoldings(holdingsWithCash),
    [holdingsWithCash],
  );

  // Build allocation from filtered holdings
  const filteredAllocation = useMemo(() => {
    if (filteredHoldings.length === 0) return [];
    const totalValue = filteredHoldings.reduce((sum, h) => sum + h.marketValue, 0);
    return filteredHoldings.map(h => ({
      category: h.symbol,
      value: h.marketValue,
      percent: totalValue > 0 ? (h.marketValue / totalValue) * 100 : 0,
    }));
  }, [filteredHoldings]);

  const cashPctForAccount = useMemo(() => {
    if (!selectedCashAccount) return [];

    return [
      {
        category: 'Cash',
        value: selectedCashAccount.cashBalance,
        percent: selectedCashAccount.cashPercent,
      },
      {
        category: 'Investments',
        value: selectedCashAccount.investmentValue,
        percent: 100 - selectedCashAccount.cashPercent,
      },
    ];
  }, [selectedCashAccount]);

  const sectorExposureForAccount = useMemo(() => {
    if (!portfolio || !effectiveSelectedAccount) return [];
    return portfolio.sectorByAccount[effectiveSelectedAccount] || [];
  }, [effectiveSelectedAccount, portfolio]);

  // Drive the performance chart off the selected parent account so the API can
  // resolve its whole subtree server-side — every holding ever held under it
  // (including closed 0-share positions like a since-sold fund) plus its cash.
  // Deriving accounts from current holdings would silently omit closed ones.
  useEffect(() => {
    if (effectiveSelectedAccount) {
      fetchAccountHistory(effectiveSelectedAccount);
    }
  }, [effectiveSelectedAccount, fetchAccountHistory]);

  // Get the cached account history
  const accountHistory = getAccountHistory(effectiveSelectedAccount);
  const accountCashFlows = getAccountCashFlows(effectiveSelectedAccount);
  const performancePercent = useMemo(() => {
    if (performanceMetric === 'mwr') {
      return calculateMoneyWeightedReturn(accountHistory, accountCashFlows);
    }

    return calculateTimeWeightedReturn(accountHistory, accountCashFlows);
  }, [accountCashFlows, accountHistory, performanceMetric]);
  const safePerformancePercent = Number.isFinite(performancePercent) ? performancePercent : 0;

  if (loading) {
    return (
      <InvestmentsPage>
        <div className="h-8 bg-background-tertiary rounded animate-pulse w-48" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`h-[124px] rounded-lg border border-border bg-surface animate-pulse ${i === 1 ? 'col-span-2 lg:col-span-1' : ''}`} />
          ))}
        </div>
      </InvestmentsPage>
    );
  }

  if (!portfolio || portfolio.holdings.length === 0) {
    return (
      <InvestmentsPage>
        <PageHeader title="Account View" subtitle="Per-account investment breakdown" />
        <EmptyState title="No investment accounts found">
          Investment accounts will appear here once they exist in your book.
        </EmptyState>
      </InvestmentsPage>
    );
  }

  const allocationTabs: { value: AllocationTab; label: string }[] = [
    { value: 'holdings', label: 'Holdings' },
    { value: 'cashPct', label: 'Cash %' },
    { value: 'sector', label: 'Sector' },
  ];

  const allocationTitle = allocationTab === 'holdings'
    ? 'Account Allocation'
    : allocationTab === 'cashPct'
      ? 'Cash % of Account'
      : 'Sector Exposure';

  return (
    <InvestmentsPage>
      <PageHeader
        title="Account View"
        subtitle="Per-account investment breakdown"
        actions={
          <select
            aria-label="Investment account"
            value={effectiveSelectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className={`${SELECT} max-w-full sm:w-72`}
          >
            {parentAccounts.map(a => (
              <option key={a.key} value={a.key}>{a.name}</option>
            ))}
          </select>
        }
      />

      {/* Filtered summary cards */}
      <PortfolioSummaryCards
        totalValue={filteredSummary.totalValue}
        totalCostBasis={filteredSummary.totalCostBasis}
        totalCostBasisCoverage={filteredSummary.totalCostBasisCoverage}
        totalGainLoss={filteredSummary.totalGainLoss}
        performancePercent={safePerformancePercent}
        performanceMetric={performanceMetric}
        valueSub="Holdings plus account cash"
        links={{ performance: '#performance' }}
        performanceCta="Account performance"
      />

      {/* Charts: performance leads, allocation beside it on wide screens */}
      <div className="grid gap-4 xl:grid-cols-12">
        <div id="performance" className="min-w-0 scroll-mt-6 xl:col-span-7">
          <ExpandableChart title="Account Performance" expandButtonClassName={CHART_EXPAND_BUTTON}>
            <PerformanceChart
              title="Account Performance"
              data={accountHistory}
              cashFlows={accountCashFlows}
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
                      options={allocationTabs}
                      value={allocationTab}
                      onChange={setAllocationTab}
                    />
                  }
                >
                  {allocationTab === 'holdings' ? (
                    <AllocationChart data={filteredAllocation} />
                  ) : allocationTab === 'cashPct' ? (
                    <AllocationChart data={cashPctForAccount} />
                  ) : (
                    <IndustryExposureChart data={sectorExposureForAccount} />
                  )}
                </ChartPanel>
              )}
            </ExpandedContext.Consumer>
          </ExpandableChart>
        </div>
      </div>

      {/* Filtered holdings table */}
      <HoldingsTable holdings={holdingsWithCash} />
    </InvestmentsPage>
  );
}
