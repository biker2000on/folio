'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { INPUT, TNUM } from '@/components/ui/form';
import {
  ACTION_RULE_SECTIONS,
  type ActionGroup,
} from '@/lib/financial-actions/rules';
import type {
  FinancialAction,
  FinancialActionSeverity,
  FinancialActionState,
} from '@/lib/financial-actions/types';

export interface RuleStatus {
  id: string;
  label: string;
  description: string;
  section: string;
  lane: string;
  enabled: boolean;
  openCount: number;
}

const SEVERITY_ORDER: FinancialActionSeverity[] = ['critical', 'warning', 'info'];

const SEVERITY_TEXT: Record<FinancialActionSeverity, string> = {
  critical: 'text-error',
  warning: 'text-warning',
  info: 'text-foreground-secondary',
};

const SEVERITY_DOT: Record<FinancialActionSeverity, string> = {
  critical: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-foreground-muted',
};

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function countLabel(count: number, noun = 'item'): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** The right-hand detail for one item: what it is worth, or when it is due. */
function itemDetail(action: FinancialAction): string | null {
  if (action.impact && action.impact.high > 0) return money(action.impact.high);
  if (action.dueDate) return action.dueDate;
  return null;
}

/** The state that clears an item for good: Do-lane work is resolved, the rest dismissed. */
export function clearingState(action: Pick<FinancialAction, 'lane'>): FinancialActionState {
  return action.lane === 'do' ? 'resolved' : 'dismissed';
}

interface FoldedRow {
  key: string;
  /** The item shown; the highest-priority member. */
  lead: FinancialAction;
  members: FinancialAction[];
}

/**
 * Fold items that say exactly the same thing (a sync failure reported on
 * every run) into one row that acts on all of them.
 */
export function foldIdenticalActions(actions: FinancialAction[]): FoldedRow[] {
  const rows = new Map<string, FoldedRow>();
  for (const action of actions) {
    const key = `${action.title}\u0000${action.summary}`;
    const row = rows.get(key);
    if (row) row.members.push(action);
    else rows.set(key, { key, lead: action, members: [action] });
  }
  return [...rows.values()];
}

function severityCounts(actions: FinancialAction[]) {
  return SEVERITY_ORDER
    .map(severity => ({ severity, count: actions.filter(action => action.severity === severity).length }))
    .filter(entry => entry.count > 0);
}

export function GroupCard({
  group,
  canEdit,
  busy,
  onReview,
  onStateAll,
  onDisableRule,
}: {
  group: ActionGroup<FinancialAction>;
  canEdit: boolean;
  busy: boolean;
  onReview: () => void;
  onStateAll: (state: FinancialActionState, snoozedUntil?: string) => void;
  onDisableRule: () => void;
}) {
  const { rule, actions } = group;
  // The preview folds by title alone: three lines that read the same tell the
  // reader nothing, one line with a count does.
  const preview = useMemo(() => {
    const byTitle = new Map<string, FoldedRow>();
    for (const action of actions) {
      const row = byTitle.get(action.title);
      if (row) row.members.push(action);
      else byTitle.set(action.title, { key: action.title, lead: action, members: [action] });
    }
    return [...byTitle.values()].slice(0, 3);
  }, [actions]);
  const previewed = preview.reduce((sum, row) => sum + row.members.length, 0);
  const counts = severityCounts(actions);
  const clearLabel = actions[0]?.lane === 'do' ? 'Resolve all' : 'Dismiss all';

  return (
    <section
      aria-label={`${rule.label}, ${countLabel(actions.length)}`}
      data-rule-group={rule.id}
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-foreground">{rule.label}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {counts.map(({ severity, count }) => (
              <span key={severity} className={`inline-flex items-center gap-1.5 ${SEVERITY_TEXT[severity]}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[severity]}`} />
                <span className="font-mono" style={TNUM}>{count}</span> {severity}
              </span>
            ))}
          </p>
        </div>
        <span className="font-mono text-xl font-semibold leading-6 text-foreground" style={TNUM}>
          {actions.length.toLocaleString('en-US')}
        </span>
      </div>

      <ul className="mt-3 border-t border-border">
        {preview.map(row => {
          const detail = itemDetail(row.lead);
          return (
            <li key={row.key} className="flex items-baseline gap-3 border-b border-border px-4 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground-secondary">{row.lead.title}</span>
              {row.members.length > 1 && (
                <span className="shrink-0 font-mono text-foreground-muted" style={TNUM}>×{row.members.length}</span>
              )}
              {detail && (
                <span className="shrink-0 font-mono text-foreground-muted" style={TNUM}>{detail}</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onReview}
          className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Review all {actions.length.toLocaleString('en-US')}
        </button>
        {actions.length > previewed && (
          <span className="text-xs text-foreground-muted">
            {(actions.length - previewed).toLocaleString('en-US')} more
          </span>
        )}
        {canEdit && (
          <ActionMenu
            className="ml-auto"
            label={`More actions for ${rule.label}`}
            items={[
              { label: 'Snooze all 7 days', onSelect: () => onStateAll('snoozed', new Date(Date.now() + 7 * 86_400_000).toISOString()), disabled: busy },
              { label: clearLabel, onSelect: () => onStateAll(clearingState(actions[0])), disabled: busy },
              { label: 'Turn off this rule', onSelect: onDisableRule, disabled: busy },
            ]}
          />
        )}
      </div>
    </section>
  );
}

export function GroupDrillDown({
  group,
  canEdit,
  busy,
  onClose,
  onState,
  onOpen,
  onExplain,
  onDisableRule,
}: {
  group: ActionGroup<FinancialAction> | null;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onState: (ids: string[], state: FinancialActionState, snoozedUntil?: string) => void;
  onOpen: (action: FinancialAction, href: string) => void;
  onExplain: (action: FinancialAction) => void;
  onDisableRule: (ruleId: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => foldIdenticalActions(group?.actions ?? []), [group]);
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? rows.filter(row => `${row.lead.title} ${row.lead.summary}`.toLowerCase().includes(needle))
    : rows;
  const visibleIds = visible.flatMap(row => row.members.map(member => member.id));
  const lane = group?.actions[0]?.lane;
  const clearWord = lane === 'do' ? 'Resolve' : 'Dismiss';

  return (
    <Modal
      isOpen={group !== null}
      onClose={onClose}
      title={group ? `${group.rule.label} · ${group.actions.length.toLocaleString('en-US')}` : undefined}
      size="xl"
      resetKey={group?.rule.id ?? null}
    >
      {group && (
        <div className="pb-2">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-[60ch] text-sm text-foreground-secondary">{group.rule.description}</p>
            {canEdit && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || visibleIds.length === 0}
                  onClick={() => onState(visibleIds, clearingState(group.actions[0]))}
                  className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-border-hover hover:bg-surface-hover disabled:opacity-50"
                >
                  {clearWord} {needle ? 'shown' : 'all'} ({visibleIds.length.toLocaleString('en-US')})
                </button>
                <button
                  type="button"
                  disabled={busy || visibleIds.length === 0}
                  onClick={() => onState(visibleIds, 'snoozed', new Date(Date.now() + 7 * 86_400_000).toISOString())}
                  className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground-secondary transition-colors hover:border-border-hover hover:bg-surface-hover disabled:opacity-50"
                >
                  Snooze 7 days
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDisableRule(group.rule.id)}
                  className="rounded-md px-3 py-2 text-xs font-medium text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                >
                  Turn off this rule
                </button>
              </div>
            )}
          </div>

          {rows.length > 8 && (
            <div className="border-b border-border px-5 py-3">
              <input
                type="search"
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Filter by name or detail"
                aria-label={`Filter ${group.rule.label}`}
                className={`${INPUT} max-w-sm`}
              />
            </div>
          )}

          <ul>
            {visible.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-foreground-muted">
                Nothing matches “{filter}”.
              </li>
            )}
            {visible.map(row => {
              const action = row.lead;
              const primary = action.operations.find(operation => operation.primary && operation.href)
                ?? action.operations.find(operation => operation.href);
              const detail = itemDetail(action);
              const ids = row.members.map(member => member.id);
              return (
                <li key={row.key} className="flex flex-col gap-3 border-b border-border px-5 py-3 last:border-b-0 sm:flex-row sm:items-start">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 hidden h-2 w-2 shrink-0 rounded-full sm:block ${SEVERITY_DOT[action.severity]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {action.title}
                      {row.members.length > 1 && (
                        <span className="ml-2 font-mono text-xs font-normal text-foreground-muted" style={TNUM}>
                          ×{row.members.length}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-foreground-secondary">{action.summary}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-foreground-muted">
                      <span className={SEVERITY_TEXT[action.severity]}>{action.severity}</span>
                      {detail && <span className="font-mono" style={TNUM}>{detail}</span>}
                      {action.state !== 'open' && <span>{action.state}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {primary?.href && (
                      <button
                        type="button"
                        onClick={() => onOpen(action, primary.href!)}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary-light"
                      >
                        {primary.label}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onExplain(action)}
                      className="rounded-md px-2.5 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground"
                    >
                      Why
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onState(ids, clearingState(action))}
                        className="rounded-md px-2.5 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                      >
                        {clearWord}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function RuleSwitch({
  rule,
  disabled,
  onToggle,
}: {
  rule: RuleStatus;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={rule.enabled}
      aria-label={rule.label}
      disabled={disabled}
      onClick={() => onToggle(!rule.enabled)}
      className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 rounded-full border transition-colors ${
          rule.enabled ? 'border-primary bg-primary' : 'border-border-hover bg-background-tertiary'
        }`}
      >
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all ${rule.enabled ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function RulesPanel({
  isOpen,
  rules,
  loading,
  error,
  canEdit,
  pendingRuleId,
  onClose,
  onToggle,
  onRetry,
}: {
  isOpen: boolean;
  rules: RuleStatus[] | null;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  pendingRuleId: string | null;
  onClose: () => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onRetry: () => void;
}) {
  const off = (rules ?? []).filter(rule => !rule.enabled);
  const hidden = off.reduce((sum, rule) => sum + rule.openCount, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Action Center rules" size="lg">
      <div className="pb-2">
        <div className="border-b border-border px-5 py-4">
          <p className="max-w-[60ch] text-sm text-foreground-secondary">
            Each rule is one kind of item the Action Center raises. Turn a rule off and its items leave the
            lanes; nothing is deleted, and turning it back on brings them back. Rules are saved per book.
          </p>
          {rules && (
            <p className="mt-2 text-xs text-foreground-muted">
              {off.length === 0
                ? 'Every rule is on.'
                : `${countLabel(off.length, 'rule')} off, hiding ${countLabel(hidden)}.`}
            </p>
          )}
        </div>

        {loading && !rules && (
          <div className="space-y-px px-5 py-4" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-surface" />
            ))}
          </div>
        )}
        {error && (
          <div className="m-5 rounded-lg border border-error/40 bg-error/10 p-4">
            <p className="text-sm text-error">{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium text-foreground underline">
              Try again
            </button>
          </div>
        )}

        {rules && ACTION_RULE_SECTIONS.map(section => {
          const sectionRules = rules.filter(rule => rule.section === section.id);
          if (sectionRules.length === 0) return null;
          return (
            <section key={section.id} aria-label={section.label}>
              <h3 className="border-b border-border bg-background-secondary px-5 py-2 text-xs font-semibold text-foreground-secondary">
                {section.label}
              </h3>
              <ul>
                {sectionRules.map(rule => (
                  <li key={rule.id} className="flex items-start gap-4 border-b border-border px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${rule.enabled ? 'text-foreground' : 'text-foreground-secondary'}`}>
                        {rule.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-foreground-secondary">{rule.description}</p>
                    </div>
                    <span
                      className={`mt-1.5 w-20 shrink-0 text-right font-mono text-xs ${rule.openCount > 0 ? 'text-foreground-secondary' : 'text-foreground-muted'}`}
                      style={TNUM}
                    >
                      {rule.openCount === 0
                        ? 'none now'
                        : `${rule.openCount.toLocaleString('en-US')} ${rule.enabled ? 'open' : 'hidden'}`}
                    </span>
                    <RuleSwitch
                      rule={rule}
                      disabled={!canEdit || pendingRuleId !== null}
                      onToggle={enabled => onToggle(rule.id, enabled)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
