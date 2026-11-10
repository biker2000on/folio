'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/lib/format';
import {
    AiSummaryNote,
    AiUnavailableNote,
    aiUsable,
    useAiAvailability,
} from '@/components/ai/AiSuggestStatus';
import type { BudgetProposal } from '@/lib/ai-suggest/budget-proposals';

interface SuggestResponse {
    level: 'summary' | 'full';
    proposals: BudgetProposal[];
    dropped: number;
    whyDropped: number;
    months: string[];
}

/**
 * "Suggest changes with AI" on the budget page. The model proposes, the server
 * validates (budget-the-parent included), and nothing is saved until the user
 * clicks Apply, which calls the ordinary amount routes: all-periods for a new
 * amount, DELETE for a removed line. A new line that replaces a parent or
 * child line is tied to that removal: they are selected together.
 */
export function AiBudgetSuggestions({
    budgetGuid,
    currency,
    onApplied,
}: {
    budgetGuid: string;
    currency: string;
    onApplied: () => Promise<void> | void;
}) {
    const { success, error: showError } = useToast();
    const availability = useAiAvailability(`/api/budgets/${budgetGuid}/ai-suggestions`);
    const usable = aiUsable(availability);

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<SuggestResponse | null>(null);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [applying, setApplying] = useState(false);

    const pathByGuid = useMemo(
        () => new Map((result?.proposals ?? []).map(p => [p.accountGuid, p.accountPath])),
        [result],
    );

    const suggest = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/budgets/${budgetGuid}/ai-suggestions`, { method: 'POST' });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Could not get AI suggestions');
            const body = data as SuggestResponse;
            setResult(body);
            setSelected(new Set(body.proposals.map(p => p.accountGuid)));
        } catch (err) {
            showError(err instanceof Error ? err.message : 'Could not get AI suggestions');
        } finally {
            setLoading(false);
        }
    };

    /** Keep a new line and the removals it relies on selected together. */
    const toggle = (p: BudgetProposal) => {
        if (!result) return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(p.accountGuid)) {
                next.delete(p.accountGuid);
                // Unselecting a removal unselects every new line that needs it.
                for (const other of result.proposals) {
                    if (other.requires.includes(p.accountGuid)) next.delete(other.accountGuid);
                }
            } else {
                next.add(p.accountGuid);
                for (const g of p.requires) next.add(g);
            }
            return next;
        });
    };

    const apply = async () => {
        if (!result) return;
        const chosen = result.proposals.filter(p => selected.has(p.accountGuid));
        if (chosen.length === 0) return;
        setApplying(true);
        const done = new Set<string>();
        let failed = 0;
        try {
            // Removals first, so a replacing line never overlaps its old one.
            const ordered = [...chosen.filter(p => p.to === null), ...chosen.filter(p => p.to !== null)];
            for (const p of ordered) {
                if (p.requires.some(g => !done.has(g))) {
                    failed++;
                    continue;
                }
                const res = p.to === null
                    ? await fetch(`/api/budgets/${budgetGuid}/amounts?account_guid=${encodeURIComponent(p.accountGuid)}`, { method: 'DELETE' })
                    : await fetch(`/api/budgets/${budgetGuid}/amounts/all-periods`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ account_guid: p.accountGuid, amount: p.rawTo }),
                    });
                if (res.ok) done.add(p.accountGuid);
                else failed++;
            }
            if (done.size > 0) success(`Applied ${done.size} change${done.size === 1 ? '' : 's'}.`);
            if (failed > 0) showError(`${failed} change${failed === 1 ? '' : 's'} could not be applied.`);
            setResult(prev => (prev ? { ...prev, proposals: prev.proposals.filter(p => !done.has(p.accountGuid)) } : prev));
            setSelected(prev => new Set([...prev].filter(g => !done.has(g))));
            if (done.size > 0) await onApplied();
        } finally {
            setApplying(false);
        }
    };

    const selectedCount = result ? result.proposals.filter(p => selected.has(p.accountGuid)).length : 0;
    const money = (n: number) => formatCurrency(n, currency, 0);

    return (
        <div className="border border-border rounded-lg bg-surface">
            <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">Suggest changes with AI</h2>
                    <p className="text-xs text-foreground-secondary">
                        Compares each line with the last three complete months. Nothing is saved until you apply it.
                    </p>
                    <AiUnavailableNote state={availability} />
                </div>
                <button
                    onClick={() => void suggest()}
                    disabled={!usable || loading || applying}
                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                    {loading ? 'Asking AI…' : result ? 'Ask again' : 'Suggest changes with AI'}
                </button>
            </div>

            {result && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                    {result.level === 'summary' && <AiSummaryNote />}

                    {result.proposals.length === 0 ? (
                        <p className="py-4 text-center text-sm text-foreground-muted">No changes passed the checks.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted border-b border-border">
                                        <th className="py-2 pr-3 w-8"><span className="sr-only">Apply</span></th>
                                        <th className="py-2 pr-3">Account</th>
                                        <th className="py-2 pr-3 text-right">From</th>
                                        <th className="py-2 pr-3 text-right">To</th>
                                        <th className="py-2">Why</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.proposals.map(p => {
                                        const id = `ai-budget-${p.accountGuid}`;
                                        return (
                                            <tr key={p.accountGuid} className="border-b border-border last:border-b-0 align-top">
                                                <td className="py-2 pr-3">
                                                    <input
                                                        id={id}
                                                        type="checkbox"
                                                        checked={selected.has(p.accountGuid)}
                                                        onChange={() => toggle(p)}
                                                        disabled={applying}
                                                        className="mt-0.5 w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                                                    />
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <label htmlFor={id} className="text-foreground cursor-pointer">{p.accountPath}</label>
                                                    {p.requires.length > 0 && (
                                                        <p className="text-xs text-foreground-muted">
                                                            Replaces {p.requires.map(g => pathByGuid.get(g) ?? 'a line').join(', ')}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground-secondary whitespace-nowrap">
                                                    {p.from === null ? <span className="text-foreground-muted">New line</span> : money(p.from)}
                                                    {p.fromVaries && <div className="text-xs text-foreground-muted">average, varies</div>}
                                                </td>
                                                <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground whitespace-nowrap">
                                                    {p.to === null ? <span className="text-foreground-muted">Remove line</span> : money(p.to)}
                                                </td>
                                                <td className="py-2 text-xs text-foreground-secondary">{p.why ?? ''}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {result.dropped > 0 && (
                        <p className="text-xs text-foreground-muted">
                            {result.dropped} other suggestion{result.dropped === 1 ? '' : 's'} failed the checks and {result.dropped === 1 ? 'is' : 'are'} not shown.
                        </p>
                    )}

                    {result.proposals.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                            <p className="text-xs text-foreground-muted">Amounts are per period and apply to every period.</p>
                            <button
                                onClick={() => void apply()}
                                disabled={applying || selectedCount === 0}
                                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50"
                            >
                                {applying ? 'Applying…' : `Apply selected (${selectedCount})`}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
