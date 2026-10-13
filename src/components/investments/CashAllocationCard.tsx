'use client';

import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/format';
import { Panel } from '@/components/investments/ui';

interface CashByAccount {
  parentGuid: string;
  parentName: string;
  parentPath: string;
  cashBalance: number;
  investmentValue: number;
  cashPercent: number;
}

interface OverallCash {
  totalCashBalance: number;
  totalInvestmentValue: number;
  totalValue: number;
  cashPercent: number;
}

interface CashAllocationCardProps {
  cashByAccount: CashByAccount[];
  overallCash: OverallCash;
  /** Header controls (e.g. sort). */
  actions?: ReactNode;
}

const TNUM = { fontFeatureSettings: "'tnum'" } as const;

/** Cash drag thresholds: >20% is flagged, >10% is worth a look. */
function getCashColor(percent: number): string {
  if (percent > 20) return 'text-error';
  if (percent > 10) return 'text-warning';
  return 'text-primary';
}

function getBarColor(percent: number): string {
  if (percent > 20) return 'bg-error/70';
  if (percent > 10) return 'bg-warning/70';
  return 'bg-primary/70';
}

function stripRoot(path: string): string {
  const idx = path.indexOf(':');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function CashAllocationCard({ cashByAccount, overallCash, actions }: CashAllocationCardProps) {
  if (!cashByAccount || cashByAccount.length === 0) {
    return (
      <Panel title="Cash Allocation">
        <p className="py-6 text-center text-sm text-foreground-muted">No cash accounts detected</p>
      </Panel>
    );
  }

  return (
    <Panel title="Cash Allocation" subtitle="Uninvested cash inside each investment account" actions={actions} flush>
      {/* Overall total */}
      <div className="grid gap-4 border-b border-border bg-background-secondary/40 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-foreground-muted">Overall portfolio</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-mono text-2xl font-semibold ${getCashColor(overallCash.cashPercent)}`} style={TNUM}>
              {overallCash.cashPercent.toFixed(1)}%
            </span>
            <span className="text-sm text-foreground-secondary">cash</span>
          </div>
          <CashBar cashPercent={overallCash.cashPercent} className="mt-3 max-w-xl" />
        </div>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 self-center text-right">
          {[
            ['Cash', overallCash.totalCashBalance],
            ['Invested', overallCash.totalInvestmentValue],
            ['Total', overallCash.totalValue],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-[11px] uppercase tracking-wider text-foreground-muted">{label}</dt>
              <dd className="font-mono text-sm text-foreground" style={TNUM}>{formatCurrency(value as number)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Per-account rows */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="text-[11px] uppercase tracking-wider text-foreground-muted">
              <th className="px-4 py-2.5 text-left font-medium sm:px-5">Account</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Cash</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Invested</th>
              <th className="px-4 py-2.5 text-left font-medium md:w-[32%]">Cash share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {cashByAccount.map((account) => (
              <tr key={account.parentGuid}>
                <td className="px-4 py-3 align-top sm:px-5">
                  <div className="font-medium text-foreground">{account.parentName}</div>
                  <div className="break-words text-xs text-foreground-muted">{stripRoot(account.parentPath)}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-foreground-secondary md:hidden" style={TNUM}>
                    <span>Cash {formatCurrency(account.cashBalance)}</span>
                    <span>Invested {formatCurrency(account.investmentValue)}</span>
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-[13px] text-foreground md:table-cell" style={TNUM}>
                  {formatCurrency(account.cashBalance)}
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-[13px] text-foreground-secondary md:table-cell" style={TNUM}>
                  {formatCurrency(account.investmentValue)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CashBar cashPercent={account.cashPercent} className="flex-1" />
                    <span className={`w-14 text-right font-mono text-[13px] font-medium ${getCashColor(account.cashPercent)}`} style={TNUM}>
                      {account.cashPercent.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CashBar({ cashPercent, className = '' }: { cashPercent: number; className?: string }) {
  const clampedPercent = Math.min(Math.max(cashPercent, 0), 100);

  return (
    <div className={`h-1.5 min-w-16 overflow-hidden rounded-sm bg-background-tertiary ${className}`}>
      <div
        className={`h-full rounded-sm transition-all ${getBarColor(cashPercent)}`}
        style={{ width: `${clampedPercent}%` }}
      />
    </div>
  );
}
