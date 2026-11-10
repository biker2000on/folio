'use client';

import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  AiSummaryNote,
  AiUnavailableNote,
  aiUsable,
  useAiAvailability,
} from '@/components/ai/AiSuggestStatus';
import type { RuleProposal } from '@/lib/ai-suggest/rule-proposals';

interface SuggestResponse {
  level: 'summary' | 'full';
  proposals: RuleProposal[];
  dropped: number;
  whyDropped: number;
  considered: number;
}

const keyOf = (p: Pick<RuleProposal, 'match' | 'matchType' | 'accountGuid'>) =>
  `${p.matchType}:${p.match.toLowerCase()}:${p.accountGuid}`;

/**
 * "Suggest rules with AI": proposals the user reviews and applies. The model
 * proposes, the server validates, and nothing is saved until Apply, which
 * calls the ordinary rule-creation route (and, when chosen, the existing
 * apply-to-history route with its caps, uncategorized transactions only).
 */
export default function AiRuleSuggestions({ onApplied }: { onApplied: () => void }) {
  const { success, error: showError } = useToast();
  const availability = useAiAvailability('/api/categorization/ai-suggestions');
  const usable = aiUsable(availability);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [alsoHistory, setAlsoHistory] = useState(false);
  const [applying, setApplying] = useState(false);

  const suggest = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/categorization/ai-suggestions', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not get AI suggestions');
      setResult(data as SuggestResponse);
      setSelected(new Set((data as SuggestResponse).proposals.map(keyOf)));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not get AI suggestions');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = async () => {
    if (!result) return;
    const chosen = result.proposals.filter(p => selected.has(keyOf(p)));
    if (chosen.length === 0) return;
    setApplying(true);
    const done = new Set<string>();
    let created = 0;
    let recategorized = 0;
    let failed = 0;
    try {
      for (const p of chosen) {
        const res = await fetch('/api/categorization/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern: p.match, matchType: p.matchType, accountGuid: p.accountGuid, priority: 0 }),
        });
        const rule = await res.json().catch(() => null);
        if (!res.ok || typeof rule?.id !== 'number') {
          failed++;
          continue;
        }
        created++;
        done.add(keyOf(p));
        if (alsoHistory) {
          const hist = await fetch('/api/settings/rules/apply-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruleId: rule.id, dryRun: false, onlyUncategorized: true }),
          });
          const histData = await hist.json().catch(() => null);
          if (hist.ok && typeof histData?.applied === 'number') recategorized += histData.applied;
        }
      }
      if (created > 0) {
        const parts = [`Created ${created} rule${created === 1 ? '' : 's'}.`];
        if (alsoHistory) parts.push(`Recategorized ${recategorized} past transaction${recategorized === 1 ? '' : 's'}.`);
        success(parts.join(' '));
      }
      if (failed > 0) showError(`${failed} rule${failed === 1 ? '' : 's'} could not be created.`);
      setResult(prev => (prev ? { ...prev, proposals: prev.proposals.filter(p => !done.has(keyOf(p))) } : prev));
      setSelected(prev => new Set([...prev].filter(k => !done.has(k))));
      if (created > 0) onApplied();
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = result ? result.proposals.filter(p => selected.has(keyOf(p))).length : 0;

  return (
    <div className="border border-border rounded-md bg-surface">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Suggest rules with AI</h2>
          <p className="text-xs text-foreground-secondary">
            For descriptions the learned suggestions miss: rare ones, mixed ones, and ones still in
            Imbalance. Every suggestion is checked against your history. Nothing is saved until you apply it.
          </p>
          <AiUnavailableNote state={availability} />
        </div>
        <button
          onClick={() => void suggest()}
          disabled={!usable || loading || applying}
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {loading ? 'Asking AI…' : result ? 'Ask again' : 'Suggest rules with AI'}
        </button>
      </div>

      {result && (
        <div className="px-4 py-3 space-y-3">
          {result.level === 'summary' && <AiSummaryNote />}

          {result.proposals.length === 0 ? (
            <p className="py-4 text-center text-sm text-foreground-muted">
              {result.considered === 0
                ? 'Nothing left to suggest. Your rules and learned suggestions cover your descriptions.'
                : 'No suggestions passed the checks.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {result.proposals.map(p => {
                const key = keyOf(p);
                const id = `ai-rule-${key}`;
                return (
                  <li key={key} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                      disabled={applying}
                      className="mt-0.5 w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 space-y-1 cursor-pointer">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-mono text-foreground break-all">{p.match}</span>
                        {p.matchType === 'exact' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-background-tertiary text-foreground-secondary font-medium">Exact</span>
                        )}
                        <span className="text-foreground-muted">&rarr;</span>
                        <span className="text-foreground">{p.accountPath}</span>
                      </div>
                      <p className="text-xs text-foreground-secondary">
                        Matches <span className="font-mono">{p.matchCount}</span> past transaction{p.matchCount === 1 ? '' : 's'}
                        {p.uncategorizedCount > 0 && (
                          <>, <span className="font-mono">{p.uncategorizedCount}</span> still uncategorized</>
                        )}
                        .
                      </p>
                      {p.samples.length > 0 && (
                        <p className="text-xs text-foreground-muted font-mono break-all">
                          {p.samples.join(' · ')}
                        </p>
                      )}
                      {p.why && <p className="text-xs text-foreground-secondary">{p.why}</p>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {result.dropped > 0 && (
            <p className="text-xs text-foreground-muted">
              {result.dropped} other suggestion{result.dropped === 1 ? '' : 's'} failed the checks and {result.dropped === 1 ? 'is' : 'are'} not shown.
            </p>
          )}

          {result.proposals.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  checked={alsoHistory}
                  onChange={e => setAlsoHistory(e.target.checked)}
                  disabled={applying}
                  className="w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                />
                Also apply to past uncategorized transactions
              </label>
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
