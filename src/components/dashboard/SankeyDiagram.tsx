'use client';

import { useContext, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ExpandedContext } from '@/components/charts/ExpandableChart';
import { Segmented } from '@/components/investments/ui';
import { TNUM } from '@/components/ui/form';
import type { SankeyNodeKind } from '@/components/charts/SankeyChart';

const SankeyChart = dynamic(() => import('@/components/charts/SankeyChart'), { ssr: false });

export interface SankeyHierarchyNode {
    guid: string;
    name: string;
    value: number;
    depth: number;
    children: SankeyHierarchyNode[];
}

export interface SankeyResponseData {
    income: SankeyHierarchyNode[];
    expense: SankeyHierarchyNode[];
    totalIncome: number;
    totalExpenses: number;
    savings: number;
    maxDepth: number;
}

interface SankeyDiagramProps {
    data: SankeyResponseData | null;
    loading: boolean;
}

// ---------------------------------------------------------------------------
// Flatten hierarchical tree to flat Sankey nodes/links for D3
// ---------------------------------------------------------------------------

interface FlowNode {
    name: string;
    kind: SankeyNodeKind;
}

function flattenToSankey(
    incomeTree: SankeyHierarchyNode[],
    expenseTree: SankeyHierarchyNode[],
    savings: number,
    displayLevels: number
): { nodes: FlowNode[]; links: { source: number; target: number; value: number }[] } {
    const nodes: FlowNode[] = [];
    const links: { source: number; target: number; value: number }[] = [];

    // --- Collect income-side level nodes ---
    const incomeLevelNodes: Map<number, { name: string; value: number; parentName: string | null }[]> = new Map();

    function collectIncomeNodes(
        tree: SankeyHierarchyNode[],
        parentName: string | null,
        currentDepth: number,
        maxDisplayDepth: number
    ) {
        for (const node of tree) {
            if (currentDepth < maxDisplayDepth) {
                const level = incomeLevelNodes.get(currentDepth) || [];
                level.push({ name: node.name, value: node.value, parentName });
                incomeLevelNodes.set(currentDepth, level);

                if (currentDepth + 1 < maxDisplayDepth && node.children.length > 0) {
                    collectIncomeNodes(node.children, node.name, currentDepth + 1, maxDisplayDepth);
                }
            }
        }
    }

    collectIncomeNodes(incomeTree, null, 0, displayLevels);

    // Duplicate name handling
    const usedNames = new Set<string>();
    function uniqueName(name: string, side: 'income' | 'expense'): string {
        const candidate = name;
        if (!usedNames.has(candidate)) {
            usedNames.add(candidate);
            return candidate;
        }
        const disambiguated = `${name} (${side === 'income' ? 'Inc' : 'Exp'})`;
        usedNames.add(disambiguated);
        return disambiguated;
    }

    // Income levels: add from deepest to shallowest (left-most columns first in the chart)
    const incomeNodeIndices: Map<string, number> = new Map();
    for (let level = displayLevels - 1; level >= 0; level--) {
        const levelNodes = incomeLevelNodes.get(level) || [];
        for (const ln of levelNodes) {
            const name = uniqueName(ln.name, 'income');
            const idx = nodes.length;
            nodes.push({ name, kind: 'income' });
            incomeNodeIndices.set(`${level}:${ln.name}`, idx);
        }
    }

    // One central node. Income arrives on its left and leaves on its right as
    // spending and savings; a second "expenses + savings" node only repeated
    // the same total across a band as tall as the chart.
    const totalIncomeIdx = nodes.length;
    nodes.push({ name: 'Income', kind: 'total' });
    const totalExpSavingsIdx = totalIncomeIdx;

    // --- Collect expense-side level nodes ---
    const expenseLevelNodes: Map<number, { name: string; value: number; parentName: string | null }[]> = new Map();

    function collectExpenseNodes(
        tree: SankeyHierarchyNode[],
        parentName: string | null,
        currentDepth: number,
        maxDisplayDepth: number
    ) {
        for (const node of tree) {
            if (currentDepth < maxDisplayDepth) {
                const level = expenseLevelNodes.get(currentDepth) || [];
                level.push({ name: node.name, value: node.value, parentName });
                expenseLevelNodes.set(currentDepth, level);

                if (currentDepth + 1 < maxDisplayDepth && node.children.length > 0) {
                    collectExpenseNodes(node.children, node.name, currentDepth + 1, maxDisplayDepth);
                }
            }
        }
    }

    collectExpenseNodes(expenseTree, null, 0, displayLevels);

    // Expense levels: add from shallowest to deepest (left to right after center)
    const expenseNodeIndices: Map<string, number> = new Map();
    for (let level = 0; level < displayLevels; level++) {
        const levelNodes = expenseLevelNodes.get(level) || [];
        for (const ln of levelNodes) {
            const name = uniqueName(ln.name, 'expense');
            const idx = nodes.length;
            nodes.push({ name, kind: 'expense' });
            expenseNodeIndices.set(`${level}:${ln.name}`, idx);
        }
    }

    // Add Savings node if positive
    let savingsIdx = -1;
    if (savings > 0) {
        savingsIdx = nodes.length;
        nodes.push({ name: 'Saved', kind: 'savings' });
    }

    // --- Build links ---

    // Income side: deeper levels link to their parent level
    for (let level = displayLevels - 1; level > 0; level--) {
        const levelNodes = incomeLevelNodes.get(level) || [];
        for (const ln of levelNodes) {
            const sourceIdx = incomeNodeIndices.get(`${level}:${ln.name}`);
            const targetIdx = incomeNodeIndices.get(`${level - 1}:${ln.parentName}`);
            if (sourceIdx !== undefined && targetIdx !== undefined && ln.value > 0) {
                links.push({ source: sourceIdx, target: targetIdx, value: ln.value });
            }
        }
    }

    // Shallowest income level (level 0) links to Total Income
    const level0Income = incomeLevelNodes.get(0) || [];
    for (const ln of level0Income) {
        const sourceIdx = incomeNodeIndices.get(`0:${ln.name}`);
        if (sourceIdx !== undefined && ln.value > 0) {
            links.push({ source: sourceIdx, target: totalIncomeIdx, value: ln.value });
        }
    }

    // Total Expenses + Savings links to shallowest expense level (level 0) and savings
    const level0Expense = expenseLevelNodes.get(0) || [];
    for (const ln of level0Expense) {
        const targetIdx = expenseNodeIndices.get(`0:${ln.name}`);
        if (targetIdx !== undefined && ln.value > 0) {
            links.push({ source: totalExpSavingsIdx, target: targetIdx, value: ln.value });
        }
    }
    if (savings > 0 && savingsIdx >= 0) {
        links.push({ source: totalExpSavingsIdx, target: savingsIdx, value: savings });
    }

    // Expense side: shallower levels link to deeper levels
    for (let level = 0; level < displayLevels - 1; level++) {
        const nextLevelNodes = expenseLevelNodes.get(level + 1) || [];
        for (const ln of nextLevelNodes) {
            const sourceIdx = expenseNodeIndices.get(`${level}:${ln.parentName}`);
            const targetIdx = expenseNodeIndices.get(`${level + 1}:${ln.name}`);
            if (sourceIdx !== undefined && targetIdx !== undefined && ln.value > 0) {
                links.push({ source: sourceIdx, target: targetIdx, value: ln.value });
            }
        }
    }

    return { nodes, links };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ChartSkeleton() {
    return (
        <div className="bg-surface border border-border rounded-lg p-6 animate-pulse" aria-busy="true">
            <div className="h-5 w-48 bg-background-secondary rounded mb-6" />
            <div className="h-[420px] bg-background-secondary rounded" />
        </div>
    );
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

/** Tall enough for the busiest column to keep one label per row. */
function chartHeight(nodes: FlowNode[]): number {
    const perKind = (kind: SankeyNodeKind) => nodes.filter(node => node.kind === kind).length;
    const busiest = Math.max(perKind('income'), perKind('expense') + perKind('savings'));
    // Every node needs its padding plus room to show its share; a fixed height
    // squeezes a deep level into hairlines.
    return Math.max(300, Math.min(busiest * 34, 440) + Math.max(0, busiest - 13) * 26);
}

export default function SankeyDiagram({ data, loading }: SankeyDiagramProps) {
    const expanded = useContext(ExpandedContext);
    const [displayLevel, setDisplayLevel] = useState(1);

    const maxDepth = data?.maxDepth ?? 0;

    const { nodes, links } = useMemo(() => {
        if (!data || data.maxDepth === 0) {
            return { nodes: [], links: [] };
        }
        return flattenToSankey(
            data.income,
            data.expense,
            data.savings,
            displayLevel
        );
    }, [data, displayLevel]);

    if (loading) return <ChartSkeleton />;

    if (!data || (nodes.length === 0 && links.length === 0)) {
        return (
            <div className={`bg-surface border border-border rounded-lg p-6 ${expanded ? 'h-full' : ''}`}>
                <h3 className="text-base font-semibold text-foreground mb-4">Income flow</h3>
                <div className="h-[300px] flex items-center justify-center">
                    <p className="text-foreground-muted text-sm">No income or spending in this period.</p>
                </div>
            </div>
        );
    }

    const shortfall = data.totalExpenses - data.totalIncome;
    const savedShare = data.totalIncome > 0 ? Math.round((data.savings / data.totalIncome) * 100) : null;
    const summary = shortfall > 0
        ? `${formatCurrency(data.totalIncome)} came in and ${formatCurrency(data.totalExpenses)} went out, ${formatCurrency(shortfall)} more than income.`
        : `${formatCurrency(data.totalIncome)} came in, ${formatCurrency(data.totalExpenses)} was spent and ${formatCurrency(data.savings)} was kept.`;

    return (
        <div className={`flex flex-col bg-surface border border-border rounded-lg p-6 ${expanded ? 'h-full' : ''}`}>
            {/* pr-8 keeps the control clear of ExpandableChart's expand button. */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pr-8">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">Income flow</h3>
                    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        <div className="flex items-baseline gap-1.5">
                            <dt className="text-foreground-muted">Income</dt>
                            <dd className="font-mono text-sm font-semibold text-foreground" style={TNUM}>
                                {formatCurrency(data.totalIncome)}
                            </dd>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                            <dt className="text-foreground-muted">Spent</dt>
                            <dd className="font-mono text-sm font-semibold text-foreground" style={TNUM}>
                                {formatCurrency(data.totalExpenses)}
                            </dd>
                        </div>
                        {shortfall > 0 ? (
                            <div className="flex items-baseline gap-1.5">
                                <dt className="text-foreground-muted">Over income by</dt>
                                <dd className="font-mono text-sm font-semibold text-negative" style={TNUM}>
                                    {formatCurrency(shortfall)}
                                </dd>
                            </div>
                        ) : (
                            <div className="flex items-baseline gap-1.5">
                                <dt className="text-foreground-muted">Saved</dt>
                                <dd className="font-mono text-sm font-semibold text-primary" style={TNUM}>
                                    {formatCurrency(data.savings)}
                                    {savedShare !== null && (
                                        <span className="ml-1.5 text-xs font-normal text-foreground-muted">{savedShare}%</span>
                                    )}
                                </dd>
                            </div>
                        )}
                    </dl>
                </div>
                {maxDepth > 1 && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground-muted" id="sankey-detail-label">Account depth</span>
                        <Segmented
                            ariaLabel="Account depth shown in the flow"
                            value={String(displayLevel)}
                            onChange={value => setDisplayLevel(parseInt(value, 10))}
                            options={Array.from({ length: Math.min(maxDepth, 4) }, (_, i) => ({
                                value: String(i + 1),
                                label: String(i + 1),
                                ariaLabel: `${i + 1} level${i === 0 ? '' : 's'} of accounts`,
                            }))}
                        />
                    </div>
                )}
            </div>
            <div className={expanded ? 'min-h-0 flex-1' : ''}>
                <SankeyChart
                    nodes={nodes}
                    links={links}
                    height={expanded ? undefined : chartHeight(nodes)}
                    total={data.totalIncome}
                    ariaLabel={`Income flow. ${summary}`}
                />
            </div>
        </div>
    );
}
