import { describe, expect, it } from 'vitest';
import {
  ACTION_RULES,
  ANOMALY_NOTIFICATION_TITLES,
  COLLAPSE_MIN_ITEMS,
  disabledRuleIds,
  filterDisabledRules,
  individualCards,
  isRuleEnabled,
  layoutLane,
  ruleIdForAction,
} from '../rules';
import type { FinancialActionLane, FinancialActionOrigin } from '../types';

interface Item {
  id: string;
  origin: FinancialActionOrigin;
  stableKey: string;
  title: string;
  lane: FinancialActionLane;
  metadata?: Record<string, unknown>;
  trace?: { evidence?: Array<{ label?: string }> };
}

let sequence = 0;
function item(overrides: Partial<Item> = {}): Item {
  sequence += 1;
  return {
    id: `a${sequence}`,
    origin: 'data_health',
    stableKey: `data-health:${sequence}`,
    title: `Item ${sequence}`,
    lane: 'fix',
    ...overrides,
  };
}

const spike = (lane: FinancialActionLane = 'decide') => item({
  origin: 'notification',
  stableKey: `notification:${sequence + 1}`,
  title: ANOMALY_NOTIFICATION_TITLES.category_spike,
  lane,
  metadata: { notificationType: 'spending_anomaly' },
});

describe('ruleIdForAction', () => {
  it('gives every rule a unique id', () => {
    expect(new Set(ACTION_RULES.map(rule => rule.id)).size).toBe(ACTION_RULES.length);
  });

  it('sends both spike detectors to one rule', () => {
    expect(ruleIdForAction(spike())).toBe('spending.category-spike');
    expect(ruleIdForAction(item({
      origin: 'insight',
      stableKey: 'insight:7',
      metadata: { insightKind: 'category-spike' },
    }))).toBe('spending.category-spike');
  });

  it('classifies an insight stored before insightKind existed from its evidence label', () => {
    expect(ruleIdForAction(item({
      origin: 'insight',
      stableKey: 'insight:9',
      trace: { evidence: [{ label: 'new-merchant' }] },
    }))).toBe('spending.new-merchant');
  });

  it('tells the anomaly types apart by notification title', () => {
    const anomaly = (title: string) => item({
      origin: 'notification',
      title,
      metadata: { notificationType: 'spending_anomaly' },
    });
    expect(ruleIdForAction(anomaly(ANOMALY_NOTIFICATION_TITLES.first_time_merchant))).toBe('spending.new-merchant');
    expect(ruleIdForAction(anomaly(ANOMALY_NOTIFICATION_TITLES.duplicate_charge))).toBe('spending.duplicate-charge');
    expect(ruleIdForAction(anomaly(ANOMALY_NOTIFICATION_TITLES.amount_outlier))).toBe('spending.large-charge');
  });

  it('treats any budget-scoped item as a budget alert, except a ranked opportunity', () => {
    expect(ruleIdForAction(item({
      origin: 'notification',
      metadata: { notificationType: 'budget_alert', budgetGuid: 'b1' },
    }))).toBe('budget.alerts');
    expect(ruleIdForAction(item({ origin: 'opportunity', metadata: { budgetGuid: 'b1' } }))).toBe('opportunities');
  });

  it('splits shared origins by stable key', () => {
    expect(ruleIdForAction(item({ origin: 'receipt_inbox', stableKey: 'receipt:4:unmatched' }))).toBe('receipts.unmatched');
    expect(ruleIdForAction(item({ origin: 'receipt_inbox', stableKey: 'receipt:4:ocr' }))).toBe('receipts.unreadable');
    expect(ruleIdForAction(item({ origin: 'statement_reconciliation', stableKey: 'continuous-close:abc:never' }))).toBe('reconcile.stale');
    expect(ruleIdForAction(item({ origin: 'statement_reconciliation', stableKey: 'statement:12' }))).toBe('statements.unfinished');
    expect(ruleIdForAction(item({ origin: 'compliance', stableKey: 'tax-records:missing:2025:1099:x' }))).toBe('tax-records.missing');
    expect(ruleIdForAction(item({ origin: 'compliance', stableKey: 'compliance:1040:2025' }))).toBe('compliance.deadlines');
  });

  it('always resolves to a known rule', () => {
    const known = new Set(ACTION_RULES.map(rule => rule.id));
    const origins: FinancialActionOrigin[] = [
      'transaction_review', 'comment', 'receipt_inbox', 'payslip', 'statement_reconciliation', 'data_health',
      'insight', 'compliance', 'business_close', 'failed_job', 'notification', 'payment', 'reimbursement',
      'job_profitability', 'rental', 'resilience', 'education', 'utility', 'family', 'trip', 'vehicle',
      'vendor_1099', 'giving', 'estate', 'farm', 'retirement', 'opportunity',
    ];
    for (const origin of origins) {
      expect(known.has(ruleIdForAction(item({ origin, stableKey: 'x' })))).toBe(true);
    }
  });
});

describe('rule switches', () => {
  it('starts net worth milestones off and everything else on', () => {
    expect(isRuleEnabled('networth.milestone', {})).toBe(false);
    expect(isRuleEnabled('spending.category-spike', {})).toBe(true);
    expect([...disabledRuleIds({})]).toEqual(['networth.milestone']);
  });

  it('lets the owner override either default', () => {
    const overrides = { 'networth.milestone': true, 'spending.category-spike': false };
    expect([...disabledRuleIds(overrides)]).toEqual(['spending.category-spike']);
  });

  it('drops only the actions of rules that are off', () => {
    const kept = item();
    const dropped = spike();
    expect(filterDisabledRules([kept, dropped], new Set(['spending.category-spike']))).toEqual([kept]);
    expect(filterDisabledRules([kept, dropped], new Set())).toEqual([kept, dropped]);
  });
});

describe('layoutLane', () => {
  it('folds a collapsing rule into one group once it reaches the minimum', () => {
    const spikes = Array.from({ length: COLLAPSE_MIN_ITEMS }, () => spike());
    const entries = layoutLane(spikes, 'decide');
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('group');
    expect(entries[0].kind === 'group' && entries[0].group.actions).toEqual(spikes);
  });

  it('leaves a couple of items as individual cards', () => {
    const spikes = Array.from({ length: COLLAPSE_MIN_ITEMS - 1 }, () => spike());
    expect(layoutLane(spikes, 'decide').map(entry => entry.kind)).toEqual(['card', 'card']);
  });

  it('never folds a rule whose items are each their own decision', () => {
    const checks = Array.from({ length: 6 }, () => item());
    expect(layoutLane(checks, 'fix').every(entry => entry.kind === 'card')).toBe(true);
  });

  it('puts a group where its highest-priority item was', () => {
    const top = item();
    const spikes = [spike('fix'), spike('fix'), spike('fix')];
    const bottom = item();
    const entries = layoutLane([spikes[0], top, spikes[1], bottom, spikes[2]], 'fix');
    expect(entries.map(entry => entry.kind)).toEqual(['group', 'card', 'card']);
  });

  it('groups per lane, so an accepted item is not pulled back', () => {
    const decide = [spike(), spike(), spike()];
    const accepted = spike('do');
    const all = [...decide, accepted];
    expect(layoutLane(all, 'decide')).toHaveLength(1);
    expect(layoutLane(all, 'do').map(entry => entry.kind)).toEqual(['card']);
  });

  it('exposes only un-grouped items to keyboard focus', () => {
    const lone = item();
    const spikes = [spike(), spike(), spike()];
    expect(individualCards([...spikes, lone], ['fix', 'decide', 'do'])).toEqual([lone]);
    expect(individualCards([...spikes, lone], ['fix', 'decide', 'do'], { collapse: false })).toHaveLength(4);
  });
});
