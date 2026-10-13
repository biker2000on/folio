'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/format';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import {
  CostBasisCoverageMark,
  CoveredSliceNote,
  ShortPositionMark,
  ShortBasisNote,
  BASIS_CONSEQUENCE,
} from '@/components/investments/CostBasisCoverageMark';
import type { CostBasisCoverage, PositionSide } from '@/lib/holdings-coverage';
import { Tip } from '@/components/ui/Tooltip';

function stripRoot(path: string): string {
  const idx = path.indexOf(':');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * A cost basis and the coverage that says what it describes, rendered together.
 *
 * Every basis in this table goes through here. `costBasisCoverage` is required
 * rather than optional so a new caller cannot omit it and silently print a
 * partial basis as a complete one — the failure this component exists to stop.
 *
 * `positionSide` is what the basis IS rather than how much of the position it
 * covers: on a short row the number is the proceeds received for shares sold
 * before they were owned, so it is labelled in always-visible text and carries
 * its own marker beside the coverage one.
 */
function CostBasis({ value, coverage, positionSide }: {
  value: number;
  coverage: CostBasisCoverage;
  positionSide?: PositionSide;
}) {
  return (
    <>
      {formatCurrency(value)}
      <CostBasisCoverageMark coverage={coverage} consequence={BASIS_CONSEQUENCE} />
      <ShortPositionMark positionSide={positionSide} />
      <ShortBasisNote positionSide={positionSide} />
    </>
  );
}

/**
 * A gain figure and the slice it covers.
 *
 * The marker sits on the cell carrying the NUMBER, and the slice is named in
 * always-visible text beneath it: under partial coverage `$4,000` is the gain
 * on 150 of 200 shares, and a reader who never opens a tooltip must not take it
 * for the whole position's.
 */
function GainAmount({ value, coverage }: { value: number; coverage: CostBasisCoverage }) {
  return (
    <>
      {formatCurrency(value)}
      <CostBasisCoverageMark coverage={coverage} consequence={BASIS_CONSEQUENCE} />
      <CoveredSliceNote coverage={coverage} className="ml-auto max-w-[10rem] font-sans text-[11px] leading-snug" />
    </>
  );
}

/** Gain %, marked on its own cell — it is the same slice's ratio, not the position's. */
function GainPercent({ value, coverage }: { value: number; coverage: CostBasisCoverage }) {
  return (
    <>
      {value >= 0 ? '+' : ''}{value.toFixed(2)}%
      <CostBasisCoverageMark coverage={coverage} consequence={BASIS_CONSEQUENCE} />
    </>
  );
}

interface Holding {
  accountGuid: string;
  accountName: string;
  accountPath?: string;
  symbol: string;
  shares: number;
  /** Basis of the shares `costBasisCoverage` describes; `gainLoss` matches it. */
  costBasis: number;
  costBasisCoverage: CostBasisCoverage;
  /** `short` marks a row whose `costBasis` is proceeds, not a purchase cost. */
  positionSide?: PositionSide;
  marketValue: number;
  gainLoss: number;
  gainLossPercent: number;
  isCash?: boolean;
  disableNavigation?: boolean;
}

interface ConsolidatedHolding {
  commodityGuid: string;
  symbol: string;
  fullname: string;
  totalShares: number;
  totalCostBasis: number;
  totalCostBasisCoverage: CostBasisCoverage;
  totalPositionSide?: PositionSide;
  totalMarketValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  latestPrice: number;
  priceDate: string;
  accounts: Array<{
    accountGuid: string;
    accountName: string;
    accountPath: string;
    shares: number;
    costBasis: number;
    costBasisCoverage: CostBasisCoverage;
    positionSide?: PositionSide;
    marketValue: number;
    gainLoss: number;
    gainLossPercent: number;
  }>;
}

interface HoldingsTableProps {
  holdings: Holding[];
  consolidatedHoldings?: ConsolidatedHolding[];
}

type SortKey = 'symbol' | 'shares' | 'costBasis' | 'marketValue' | 'gainLoss' | 'gainLossPercent';
type SortDir = 'asc' | 'desc';

const TNUM = { fontFeatureSettings: "'tnum'" } as const;
/** Numeric cell: right-aligned JetBrains Mono, tabular figures (DESIGN.md). */
// No nowrap: a cell may carry an always-visible coverage note under the number,
// which must wrap rather than widen the column. Amounts contain no spaces.
const NUM = 'px-4 py-3 text-right font-mono text-[13px]';
const NUM_SUB = 'px-4 py-2 text-right font-mono text-xs';
const signClass = (v: number) => (v >= 0 ? 'text-positive' : 'text-negative');

function SortHeader({ label, sortKeyName, sortKey, sortDir, onSort, align = 'right', wide = false }: {
  label: string;
  sortKeyName: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  /** Takes the table's slack so numeric columns hug their content. */
  wide?: boolean;
}) {
  const active = sortKey === sortKeyName;
  return (
    <th
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'} ${wide ? 'w-[38%]' : ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKeyName)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground ${
          active ? 'text-foreground' : 'text-foreground-muted'
        }`}
      >
        {label}
        <span aria-hidden="true" className={`w-2 ${active ? '' : 'opacity-0'}`}>
          {sortDir === 'asc' ? '\u2191' : '\u2193'}
        </span>
      </button>
    </th>
  );
}

/** Shared header for both table variants: title, position count, closed toggle. */
function HoldingsHeader({ count, showZeroShares, onToggle }: { count: number; showZeroShares: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Holdings</h2>
        <span className="font-mono text-xs text-foreground-muted" style={TNUM}>{count} {count === 1 ? 'position' : 'positions'}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={showZeroShares}
        onClick={onToggle}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <span
          aria-hidden="true"
          className={`relative h-4 w-7 rounded-full border transition-colors ${showZeroShares ? 'border-primary bg-primary' : 'border-border-hover bg-background-tertiary'}`}
        >
          <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all ${showZeroShares ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        Show closed positions
      </button>
    </div>
  );
}

const TABLE_SHELL = 'rounded-lg border border-border bg-surface overflow-hidden scroll-mt-6';

const formatShares = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * Phone row: name on the left, value and gain on the right, shares/price/basis
 * on a mono detail line. Every number the desktop row shows is still here.
 */
function MobileHoldingRow({
  title,
  badge,
  subtitle,
  detail,
  marketValue,
  gain,
  gainPercent,
  gainSign,
  onClick,
  expandable = false,
  expanded = false,
  nested = false,
}: {
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  detail: ReactNode;
  marketValue: number;
  gain: ReactNode;
  gainPercent: ReactNode;
  gainSign: number;
  onClick?: () => void;
  expandable?: boolean;
  expanded?: boolean;
  nested?: boolean;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`flex gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 ${onClick ? 'cursor-pointer active:bg-surface-hover' : ''} ${
        nested ? 'bg-background-secondary/40 pl-9' : ''
      }`}
    >
      <div className="w-3 shrink-0 pt-1">
        {expandable && (
          <svg
            className={`h-3 w-3 text-foreground-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={nested ? 'truncate text-xs text-foreground-secondary' : 'font-semibold text-foreground'}>{title}</span>
          {badge}
        </div>
        {subtitle && <div className="truncate text-xs text-foreground-muted">{subtitle}</div>}
        <div className="mt-1 font-mono text-[11px] text-foreground-muted" style={TNUM}>{detail}</div>
      </div>
      <div className="shrink-0 text-right font-mono" style={TNUM}>
        <div className={`text-sm font-medium ${nested ? 'text-foreground-secondary' : 'text-foreground'}`}>{formatCurrency(marketValue)}</div>
        <div className={`text-xs ${signClass(gainSign)}`}>{gain}</div>
        <div className={`text-xs ${signClass(gainSign)}`}>{gainPercent}</div>
      </div>
    </div>
  );
}

export function HoldingsTable({ holdings, consolidatedHoldings }: HoldingsTableProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<SortKey>('marketValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showZeroShares, setShowZeroShares] = useState(false);
  const [expandedCommodities, setExpandedCommodities] = useState<Set<string>>(new Set());

  const useConsolidated = !!consolidatedHoldings && consolidatedHoldings.length > 0;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleExpanded = (commodityGuid: string) => {
    setExpandedCommodities(prev => {
      const next = new Set(prev);
      if (next.has(commodityGuid)) {
        next.delete(commodityGuid);
      } else {
        next.add(commodityGuid);
      }
      return next;
    });
  };

  // Map sort keys to consolidated holding fields
  const consolidatedSortKeyMap: Record<SortKey, keyof ConsolidatedHolding> = {
    symbol: 'symbol',
    shares: 'totalShares',
    costBasis: 'totalCostBasis',
    marketValue: 'totalMarketValue',
    gainLoss: 'totalGainLoss',
    gainLossPercent: 'totalGainLossPercent',
  };

  if (!holdings || holdings.length === 0) {
    return (
      <section id="holdings" className={TABLE_SHELL}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Holdings</h2>
        </div>
        <p className="px-5 py-10 text-center text-sm text-foreground-muted">No holdings found</p>
      </section>
    );
  }

  // Consolidated view
  if (useConsolidated) {
    const filtered = showZeroShares
      ? consolidatedHoldings
      : consolidatedHoldings.filter(h => h.totalShares !== 0);

    const sorted = [...filtered].sort((a, b) => {
      const aKey = consolidatedSortKeyMap[sortKey];
      const bKey = consolidatedSortKeyMap[sortKey];
      const aVal = a[aKey];
      const bVal = b[bKey];
      const mult = sortDir === 'asc' ? 1 : -1;
      if (typeof aVal === 'string') return (aVal as string).localeCompare(bVal as string) * mult;
      return ((aVal as number) - (bVal as number)) * mult;
    });

    return (
      <section id="holdings" className={TABLE_SHELL}>
        <HoldingsHeader count={sorted.length} showZeroShares={showZeroShares} onToggle={() => setShowZeroShares(!showZeroShares)} />
        {isMobile ? (
          <div>
            {sorted.map((holding) => {
              const isMultiAccount = holding.accounts.length > 1;
              const isExpanded = expandedCommodities.has(holding.commodityGuid);

              return (
                <div key={holding.commodityGuid}>
                  <MobileHoldingRow
                    title={holding.symbol}
                    badge={isMultiAccount ? (
                      <span className="rounded-sm bg-background-tertiary px-1.5 py-px text-[10px] font-medium text-foreground-muted">
                        {holding.accounts.length} accounts
                      </span>
                    ) : undefined}
                    subtitle={holding.fullname}
                    detail={<>{formatShares(holding.totalShares)} sh @ {formatCurrency(holding.latestPrice)} · basis <CostBasis value={holding.totalCostBasis} coverage={holding.totalCostBasisCoverage} positionSide={holding.totalPositionSide} /></>}
                    marketValue={holding.totalMarketValue}
                    gain={<GainAmount value={holding.totalGainLoss} coverage={holding.totalCostBasisCoverage} />}
                    gainPercent={<GainPercent value={holding.totalGainLossPercent} coverage={holding.totalCostBasisCoverage} />}
                    gainSign={holding.totalGainLoss}
                    expandable={isMultiAccount}
                    expanded={isExpanded}
                    onClick={isMultiAccount ? () => toggleExpanded(holding.commodityGuid) : () => router.push(`/accounts/${holding.accounts[0].accountGuid}`)}
                  />
                  {/* Expanded sub-accounts */}
                  {isMultiAccount && isExpanded && holding.accounts.map((account) => (
                    <MobileHoldingRow
                      key={account.accountGuid}
                      nested
                      title={stripRoot(account.accountPath)}
                      detail={<>{formatShares(account.shares)} sh · basis <CostBasis value={account.costBasis} coverage={account.costBasisCoverage} positionSide={account.positionSide} /></>}
                      marketValue={account.marketValue}
                      gain={<GainAmount value={account.gainLoss} coverage={account.costBasisCoverage} />}
                      gainPercent={<GainPercent value={account.gainLossPercent} coverage={account.costBasisCoverage} />}
                      gainSign={account.gainLoss}
                      onClick={() => router.push(`/accounts/${account.accountGuid}`)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-background-secondary/60">
                <tr>
                  <th className="w-8 px-2 py-2.5"><span className="sr-only">Expand</span></th>
                  <SortHeader label="Symbol" sortKeyName="symbol" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" wide />
                  <SortHeader label="Shares" sortKeyName="shares" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-foreground-muted">Price</th>
                  <SortHeader label="Cost Basis" sortKeyName="costBasis" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Market Value" sortKeyName="marketValue" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Gain/Loss" sortKeyName="gainLoss" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Gain %" sortKeyName="gainLossPercent" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {sorted.map((holding) => {
                  const isMultiAccount = holding.accounts.length > 1;
                  const isExpanded = expandedCommodities.has(holding.commodityGuid);

                  return (
                    <ConsolidatedRow
                      key={holding.commodityGuid}
                      holding={holding}
                      isMultiAccount={isMultiAccount}
                      isExpanded={isExpanded}
                      onToggle={() => toggleExpanded(holding.commodityGuid)}
                      onNavigate={(guid) => router.push(`/accounts/${guid}`)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  // Fallback: legacy flat view
  const filteredHoldings = showZeroShares
    ? holdings
    : holdings.filter(h => h.isCash || h.shares !== 0);

  const sortedHoldings = [...filteredHoldings].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    const mult = sortDir === 'asc' ? 1 : -1;
    if (typeof aVal === 'string') return aVal.localeCompare(bVal as string) * mult;
    return ((aVal as number) - (bVal as number)) * mult;
  });

  return (
    <section id="holdings" className={TABLE_SHELL}>
      <HoldingsHeader count={sortedHoldings.length} showZeroShares={showZeroShares} onToggle={() => setShowZeroShares(!showZeroShares)} />
      {isMobile ? (
        <div>
          {sortedHoldings.map((holding) => (
            <MobileHoldingRow
              key={holding.accountGuid}
              title={holding.symbol}
              subtitle={holding.accountName}
              detail={<>{holding.isCash ? 'Cash' : `${formatShares(holding.shares)} sh`} · basis <CostBasis value={holding.costBasis} coverage={holding.costBasisCoverage} positionSide={holding.positionSide} /></>}
              marketValue={holding.marketValue}
              gain={<GainAmount value={holding.gainLoss} coverage={holding.costBasisCoverage} />}
              gainPercent={<GainPercent value={holding.gainLossPercent} coverage={holding.costBasisCoverage} />}
              gainSign={holding.gainLoss}
              onClick={holding.disableNavigation ? undefined : () => router.push(`/accounts/${holding.accountGuid}`)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-background-secondary/60">
              <tr>
                <SortHeader label="Symbol" sortKeyName="symbol" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" wide />
                <SortHeader label="Shares" sortKeyName="shares" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Cost Basis" sortKeyName="costBasis" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Market Value" sortKeyName="marketValue" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Gain/Loss" sortKeyName="gainLoss" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Gain %" sortKeyName="gainLossPercent" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {sortedHoldings.map((holding) => (
                <tr
                  key={holding.accountGuid}
                  onClick={holding.disableNavigation ? undefined : () => router.push(`/accounts/${holding.accountGuid}`)}
                  className={`transition-colors ${holding.disableNavigation ? '' : 'hover:bg-surface-hover/60 cursor-pointer'}`}
                >
                  <td className="px-4 py-3">
                    <Tip content={holding.accountPath ? stripRoot(holding.accountPath) : undefined}><div className="w-fit font-semibold text-foreground">{holding.symbol}</div></Tip>
                    <div className="max-w-[28rem] truncate text-xs text-foreground-muted">{holding.accountName}</div>
                  </td>
                  <td className={`${NUM} text-foreground-secondary`} style={TNUM}>
                    {holding.isCash ? '\u2014' : holding.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </td>
                  <td className={`${NUM} text-foreground-secondary`} style={TNUM}>
                    <CostBasis value={holding.costBasis} coverage={holding.costBasisCoverage} positionSide={holding.positionSide} />
                  </td>
                  <td className={`${NUM} font-medium text-foreground`} style={TNUM}>{formatCurrency(holding.marketValue)}</td>
                  <td className={`${NUM} ${signClass(holding.gainLoss)}`} style={TNUM}>
                    <GainAmount value={holding.gainLoss} coverage={holding.costBasisCoverage} />
                  </td>
                  <td className={`${NUM} ${signClass(holding.gainLossPercent)}`} style={TNUM}>
                    <GainPercent value={holding.gainLossPercent} coverage={holding.costBasisCoverage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Renders a consolidated row with optional expandable sub-rows
 */
function ConsolidatedRow({
  holding,
  isMultiAccount,
  isExpanded,
  onToggle,
  onNavigate,
}: {
  holding: ConsolidatedHolding;
  isMultiAccount: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: (guid: string) => void;
}) {
  return (
    <>
      {/* Main consolidated row */}
      <tr
        onClick={isMultiAccount ? onToggle : () => onNavigate(holding.accounts[0].accountGuid)}
        className="cursor-pointer transition-colors hover:bg-surface-hover/60"
      >
        <td className="px-2 py-3 text-center align-middle">
          {isMultiAccount && (
            <svg
              className={`mx-auto w-4 h-4 text-foreground-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{holding.symbol}</span>
            {isMultiAccount && (
              <span className="rounded-sm bg-background-tertiary px-1.5 py-px text-[10px] font-medium text-foreground-muted">
                {holding.accounts.length} accounts
              </span>
            )}
          </div>
          <div className="max-w-[28rem] truncate text-xs text-foreground-muted">{holding.fullname}</div>
        </td>
        <td className={`${NUM} text-foreground-secondary`} style={TNUM}>
          {holding.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </td>
        <td className={`${NUM} text-foreground-secondary`} style={TNUM}>{formatCurrency(holding.latestPrice)}</td>
        <td className={`${NUM} text-foreground-secondary`} style={TNUM}>
          <CostBasis value={holding.totalCostBasis} coverage={holding.totalCostBasisCoverage} positionSide={holding.totalPositionSide} />
        </td>
        <td className={`${NUM} font-medium text-foreground`} style={TNUM}>{formatCurrency(holding.totalMarketValue)}</td>
        <td className={`${NUM} ${signClass(holding.totalGainLoss)}`} style={TNUM}>
          <GainAmount value={holding.totalGainLoss} coverage={holding.totalCostBasisCoverage} />
        </td>
        <td className={`${NUM} ${signClass(holding.totalGainLossPercent)}`} style={TNUM}>
          <GainPercent value={holding.totalGainLossPercent} coverage={holding.totalCostBasisCoverage} />
        </td>
      </tr>

      {/* Expanded sub-rows */}
      {isMultiAccount && isExpanded && holding.accounts.map((account) => (
        <tr
          key={account.accountGuid}
          onClick={() => onNavigate(account.accountGuid)}
          className="cursor-pointer bg-background-secondary/40 transition-colors hover:bg-surface-hover/50"
        >
          <td className="px-2 py-2"></td>
          <td className="px-4 py-2 pl-6">
            <div className="border-l-2 border-border pl-3 text-xs text-foreground-secondary">{stripRoot(account.accountPath)}</div>
          </td>
          <td className={`${NUM_SUB} text-foreground-muted`} style={TNUM}>
            {account.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </td>
          <td className="px-4 py-2"></td>
          <td className={`${NUM_SUB} text-foreground-muted`} style={TNUM}>
            <CostBasis value={account.costBasis} coverage={account.costBasisCoverage} positionSide={account.positionSide} />
          </td>
          <td className={`${NUM_SUB} text-foreground-secondary`} style={TNUM}>{formatCurrency(account.marketValue)}</td>
          <td className={`${NUM_SUB} ${account.gainLoss >= 0 ? 'text-positive/80' : 'text-negative/80'}`} style={TNUM}>
            <GainAmount value={account.gainLoss} coverage={account.costBasisCoverage} />
          </td>
          <td className={`${NUM_SUB} ${account.gainLossPercent >= 0 ? 'text-positive/80' : 'text-negative/80'}`} style={TNUM}>
            <GainPercent value={account.gainLossPercent} coverage={account.costBasisCoverage} />
          </td>
        </tr>
      ))}
    </>
  );
}
