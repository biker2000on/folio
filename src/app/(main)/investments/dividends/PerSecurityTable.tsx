'use client';

import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import type { PerSecurityDividend } from '@/lib/dividends';
import { CostBasisCoverageMark, YIELD_CONSEQUENCE } from '@/components/investments/CostBasisCoverageMark';
import { Abbr } from '@/components/ui/Abbr';
import { Tip } from '@/components/ui/Tooltip';
import { Panel } from '@/components/investments/ui';

function formatPercent(value: number | null): string {
    if (value == null) return '—';
    return `${value.toFixed(2)}%`;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y.slice(2)}`;
}

interface PerSecurityTableProps {
    rows: PerSecurityDividend[];
    /** When set, show a year column with each security's income for that year. */
    year?: number | null;
}

export function PerSecurityTable({ rows, year }: PerSecurityTableProps) {
    if (rows.length === 0) {
        return (
            <Panel title="By Security">
                <p className="py-6 text-center text-sm text-foreground-muted">No dividend-paying securities found.</p>
            </Panel>
        );
    }

    const mono = { fontFeatureSettings: "'tnum'" } as const;

    return (
        <Panel title="By Security" subtitle={`${rows.length} dividend-paying ${rows.length === 1 ? 'security' : 'securities'}`} flush>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-background-secondary/60 text-[11px] uppercase tracking-wider text-foreground-muted">
                            <th className="w-[30%] text-left font-medium px-4 py-2.5 sm:px-5">Security</th>
                            {year != null && (
                                <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">{year}</th>
                            )}
                            <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">
                                <Abbr term="TTM" hideIcon /> Income
                            </th>
                            <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">Yield on Cost</th>
                            <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">Current Yield</th>
                            <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">Last Paid</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr
                                key={row.commodityGuid ?? row.ticker}
                                className="border-b border-border/70 last:border-0 hover:bg-surface-hover/60 transition-colors"
                            >
                                <td className="px-4 py-2.5 sm:px-5">
                                    {row.accountGuid ? (
                                        <Tip content="Open investment account ledger">
                                            <Link
                                                href={`/accounts/${row.accountGuid}`}
                                                className="font-semibold text-foreground hover:text-primary transition-colors"
                                            >
                                                {row.ticker}
                                            </Link>
                                        </Tip>
                                    ) : (
                                        <span className="font-semibold text-foreground">{row.ticker}</span>
                                    )}
                                    {row.commodityGuid == null && (
                                        <span className="ml-2 text-xs text-foreground-muted">(cash)</span>
                                    )}
                                </td>
                                {year != null && (
                                    <td className="px-4 py-2.5 text-right font-mono text-foreground-secondary" style={mono}>
                                        {formatCurrency(row.yearIncome ?? 0)}
                                    </td>
                                )}
                                <td className="px-4 py-2.5 text-right font-mono text-foreground" style={mono}>
                                    {formatCurrency(row.ttmIncome)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-positive" style={mono}>
                                    {formatPercent(row.yieldOnCost)}
                                    {/* Withheld (rendered as an em dash) whenever the basis
                                        does not cover the whole position — the marker says
                                        why, since a blank cell alone explains nothing. */}
                                    {row.costBasisCoverage && (
                                        <CostBasisCoverageMark
                                            coverage={row.costBasisCoverage}
                                            consequence={YIELD_CONSEQUENCE}
                                        />
                                    )}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-foreground-secondary" style={mono}>
                                    {formatPercent(row.currentYield)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-foreground-muted" style={mono}>
                                    {formatDate(row.lastPaymentDate)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Panel>
    );
}
