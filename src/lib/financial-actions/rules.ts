/**
 * Action Center rules.
 *
 * Every Action Center item is produced by exactly one rule: the kind of thing
 * that was noticed ("category spending spike", "receipt without a
 * transaction"). A rule is the unit the owner turns on or off, and the unit
 * the lanes collapse: twenty spending spikes are one card that opens a list,
 * not twenty cards.
 *
 * Pure and client-safe. Classification reads only what is already stored on
 * an action (origin, stable key, metadata), so it applies to rows written
 * before rules existed.
 */

import type { FinancialAction, FinancialActionLane, FinancialActionOrigin } from './types';

export type ActionRuleSection = 'books' | 'spending' | 'deadlines' | 'household';

export interface ActionRule {
  id: string;
  /** Plural noun phrase: the collapsed card's title and the settings row label. */
  label: string;
  /** One sentence: exactly what raises an item under this rule. */
  description: string;
  section: ActionRuleSection;
  /** The lane a collapsed card for this rule sits in. */
  lane: FinancialActionLane;
  /**
   * Whether several items under this rule fold into one card. Off for rules
   * whose every item is its own decision (a ranked opportunity, a deadline).
   */
  collapse: boolean;
}

export const ACTION_RULE_SECTIONS: Array<{ id: ActionRuleSection; label: string }> = [
  { id: 'books', label: 'Books and imports' },
  { id: 'spending', label: 'Spending and budgets' },
  { id: 'deadlines', label: 'Deadlines and operations' },
  { id: 'household', label: 'Household and planning' },
];

/** Items under one collapsing rule fold into a single card from this count up. */
export const COLLAPSE_MIN_ITEMS = 3;

/** Titles the spending scan gives its notifications, by anomaly type. */
export const ANOMALY_NOTIFICATION_TITLES = {
  duplicate_charge: 'Possible duplicate charge',
  first_time_merchant: 'New merchant charge',
  amount_outlier: 'Unusually large charge',
  category_spike: 'Category spending spike',
} as const;

const rule = (
  id: string,
  section: ActionRuleSection,
  lane: FinancialActionLane,
  label: string,
  description: string,
  collapse = true,
): ActionRule => ({ id, section, lane, label, description, collapse });

export const ACTION_RULES: ActionRule[] = [
  // Books and imports
  rule('review.imported', 'books', 'fix', 'Imported transactions to review',
    'An imported transaction nobody has marked reviewed. Hand-entered transactions never appear.'),
  rule('receipts.unmatched', 'books', 'fix', 'Receipts without a transaction',
    'An uploaded receipt that could not be matched to exactly one ledger transaction automatically.'),
  rule('receipts.unreadable', 'books', 'fix', 'Receipts that could not be read',
    'Text extraction failed on an uploaded receipt, or has been pending for over an hour.'),
  rule('payslips', 'books', 'fix', 'Payslips to map or post',
    'An uploaded payslip that failed processing, needs account mappings, or is not posted yet.'),
  rule('statements.unfinished', 'books', 'fix', 'Statements to finish',
    'An imported statement that failed, or still has unmatched lines.'),
  rule('reconcile.stale', 'books', 'fix', 'Accounts to reconcile',
    'An active balance-sheet account that has never been reconciled, or not recently.'),
  rule('data-health', 'books', 'fix', 'Data Health checks',
    'A Data Health check that found issues, one item per check.', false),
  rule('jobs.failed', 'books', 'fix', 'Sync and background job failures',
    'A bank sync, import or background job that reported an error.'),
  rule('payments.failed', 'books', 'fix', 'Customer payment problems',
    'A customer payment the processor reported as failed, or posted with a fee to sort out.', false),
  rule('comments.unresolved', 'books', 'decide', 'Unresolved transaction comments',
    'A comment thread on a transaction that nobody has marked resolved.'),

  // Spending and budgets
  rule('spending.category-spike', 'spending', 'decide', 'Category spending spikes',
    'A category whose spending this period is well above its own recent average.'),
  rule('spending.new-merchant', 'spending', 'decide', 'New merchants',
    'The first imported charge from a merchant the book has never recorded. Hand-entered charges and reference-number variations of a known merchant are ignored.'),
  rule('spending.duplicate-charge', 'spending', 'decide', 'Possible duplicate charges',
    'The same merchant charged the same amount twice within three days.'),
  rule('spending.large-charge', 'spending', 'decide', 'Unusually large charges',
    'A charge far above what that merchant has charged before.'),
  rule('spending.savings-rate', 'spending', 'decide', 'Savings rate drops',
    'This month’s savings rate is at least 10 points under its six-month average for the same days.'),
  rule('spending.balance-drop', 'spending', 'decide', 'Cash balance drops',
    'A bank or cash account lost more than 30% of its balance in a week.'),
  rule('networth.milestone', 'spending', 'decide', 'Net worth milestones',
    'Net worth crossed a $25,000 mark, up or down.'),
  rule('budget.alerts', 'spending', 'decide', 'Budget overages',
    'A budget line that is over, projected to go over, or past its alert threshold in the current period.'),
  rule('opportunities', 'spending', 'decide', 'Money opportunities',
    'A ranked next move: contribution room, debt paydown, rebalancing, a subscription price increase.', false),

  // Deadlines and operations
  rule('compliance.deadlines', 'deadlines', 'do', 'Tax and compliance deadlines',
    'A filing, payment or certificate due within 60 days and not marked done.', false),
  rule('tax-records.missing', 'deadlines', 'fix', 'Missing tax forms',
    'In filing season, a form an issuer sent last year that is not in this year’s archive.'),
  rule('close.month-end', 'deadlines', 'do', 'Month-end close tasks',
    'A step of last month’s business close checklist that is still open.'),
  rule('reimbursements', 'deadlines', 'do', 'Reimbursements and expense reports',
    'An employee reimbursement or owner expense report waiting on approval or payment.'),
  rule('vendor-1099', 'deadlines', 'do', 'Contractor W-9 and 1099 tasks',
    'A contractor over the reporting threshold with a missing W-9, an unfiled 1099-NEC, or an expiring portal link.'),
  rule('jobs.profitability', 'deadlines', 'do', 'Job billing and margins',
    'An active job with unbilled work, an overdue balance, or a margin under 20%.'),
  rule('notifications.other', 'deadlines', 'do', 'Other unread notifications',
    'An unread notification that no more specific rule covers.'),

  // Household and planning
  rule('origin.resilience', 'household', 'decide', 'Household resilience',
    'Insurance, emergency-fund and continuity gaps from the resilience pack.'),
  rule('origin.estate', 'household', 'fix', 'Estate readiness',
    'An estate document or beneficiary record that is missing or out of date.'),
  rule('origin.retirement', 'household', 'decide', 'Retirement income',
    'A retirement income or withdrawal-sequencing item.'),
  rule('origin.education', 'household', 'decide', 'Education savings',
    'An education goal that is off track or needs a decision.'),
  rule('origin.utility', 'household', 'decide', 'Utilities',
    'A utility bill or usage change flagged by the utilities tracker.'),
  rule('origin.vehicle', 'household', 'do', 'Vehicles',
    'A vehicle service, registration or cost item.'),
  rule('origin.rental', 'household', 'do', 'Rental property',
    'A lease, rent or property task.'),
  rule('origin.family', 'household', 'do', 'Family banking',
    'An allowance, chore payout or approval in a child’s ledger.'),
  rule('origin.trip', 'household', 'do', 'Trips',
    'A trip budget or expense item.'),
  rule('origin.giving', 'household', 'decide', 'Charitable giving',
    'A giving plan or documentation item.'),
  rule('origin.farm', 'household', 'do', 'Farm records',
    'A farm production or record-keeping item.'),
];

const RULE_BY_ID = new Map(ACTION_RULES.map(item => [item.id, item]));

const ORIGIN_RULE: Partial<Record<FinancialActionOrigin, string>> = {
  transaction_review: 'review.imported',
  payslip: 'payslips',
  data_health: 'data-health',
  failed_job: 'jobs.failed',
  payment: 'payments.failed',
  comment: 'comments.unresolved',
  opportunity: 'opportunities',
  business_close: 'close.month-end',
  reimbursement: 'reimbursements',
  vendor_1099: 'vendor-1099',
  job_profitability: 'jobs.profitability',
};

const INSIGHT_RULE: Record<string, string> = {
  'category-spike': 'spending.category-spike',
  'new-merchant': 'spending.new-merchant',
  'savings-rate-drop': 'spending.savings-rate',
  'balance-drop': 'spending.balance-drop',
  'net-worth-milestone': 'networth.milestone',
};

const ANOMALY_TITLE_RULE: Record<string, string> = {
  [ANOMALY_NOTIFICATION_TITLES.category_spike]: 'spending.category-spike',
  [ANOMALY_NOTIFICATION_TITLES.first_time_merchant]: 'spending.new-merchant',
  [ANOMALY_NOTIFICATION_TITLES.duplicate_charge]: 'spending.duplicate-charge',
  [ANOMALY_NOTIFICATION_TITLES.amount_outlier]: 'spending.large-charge',
};

type Classifiable = Pick<FinancialAction, 'origin' | 'stableKey' | 'title'> & {
  metadata?: Record<string, unknown>;
  trace?: { evidence?: Array<{ label?: string }> };
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The id of the rule that produced an action. Always resolves to a known rule. */
export function ruleIdForAction(action: Classifiable): string {
  const metadata = action.metadata ?? {};
  const key = action.stableKey;

  // A budget alert is a budget alert whichever detector surfaced it.
  if (text(metadata.budgetGuid) && action.origin !== 'opportunity') return 'budget.alerts';

  switch (action.origin) {
    case 'receipt_inbox':
      return key.endsWith(':ocr') ? 'receipts.unreadable' : 'receipts.unmatched';
    case 'statement_reconciliation':
      return key.startsWith('continuous-close:') ? 'reconcile.stale' : 'statements.unfinished';
    case 'compliance':
      return key.startsWith('tax-records:') ? 'tax-records.missing' : 'compliance.deadlines';
    case 'insight': {
      const kind = text(metadata.insightKind) || text(action.trace?.evidence?.[0]?.label);
      return INSIGHT_RULE[kind] ?? 'notifications.other';
    }
    case 'notification': {
      if (text(metadata.notificationType) === 'spending_anomaly') {
        return ANOMALY_TITLE_RULE[action.title] ?? 'notifications.other';
      }
      if (text(metadata.notificationType) === 'compliance_deadline') return 'compliance.deadlines';
      return 'notifications.other';
    }
    default:
      break;
  }

  const direct = ORIGIN_RULE[action.origin];
  if (direct) return direct;
  const byOrigin = `origin.${action.origin}`;
  return RULE_BY_ID.has(byOrigin) ? byOrigin : 'notifications.other';
}

/**
 * Rules that start switched off: they report something that happened, with
 * nothing to fix, decide or do about it.
 */
const DEFAULT_OFF = new Set(['networth.milestone']);

/** Per-rule on/off choices the owner has made; a rule with no entry uses its default. */
export type RuleOverrides = Record<string, boolean>;

export function isRuleEnabled(id: string, overrides: RuleOverrides): boolean {
  const choice = overrides[id];
  return typeof choice === 'boolean' ? choice : !DEFAULT_OFF.has(id);
}

export function disabledRuleIds(overrides: RuleOverrides): Set<string> {
  return new Set(ACTION_RULES.filter(item => !isRuleEnabled(item.id, overrides)).map(item => item.id));
}

export function getActionRule(id: string): ActionRule {
  return RULE_BY_ID.get(id) ?? RULE_BY_ID.get('notifications.other')!;
}

export function isKnownRuleId(id: unknown): id is string {
  return typeof id === 'string' && RULE_BY_ID.has(id);
}

/** Drop actions whose rule the owner has turned off. */
export function filterDisabledRules<T extends Classifiable>(
  actions: T[],
  disabledRuleIds: ReadonlySet<string>,
): T[] {
  if (disabledRuleIds.size === 0) return actions;
  return actions.filter(action => !disabledRuleIds.has(ruleIdForAction(action)));
}

export interface ActionGroup<T> {
  rule: ActionRule;
  lane: FinancialActionLane;
  /** In the incoming (priority) order. */
  actions: T[];
}

export type LaneEntry<T> =
  | { kind: 'card'; action: T }
  | { kind: 'group'; group: ActionGroup<T> };

/**
 * Lay out one lane: items under a collapsing rule fold into a single group
 * entry once there are COLLAPSE_MIN_ITEMS of them; everything else stays an
 * individual card. An entry takes the position of its first (highest
 * priority) item, so a group holding a critical item still sorts to the top.
 *
 * Grouping is per lane on purpose: an accepted item moves to Do and must not
 * be dragged back into a Decide group.
 */
export function layoutLane<T extends Classifiable & { lane: FinancialActionLane }>(
  actions: T[],
  lane: FinancialActionLane,
  options: { collapse?: boolean } = {},
): LaneEntry<T>[] {
  const inLane = actions.filter(action => action.lane === lane);
  if (options.collapse === false) return inLane.map(action => ({ kind: 'card', action }));

  const byRule = new Map<string, T[]>();
  for (const action of inLane) {
    const id = ruleIdForAction(action);
    byRule.set(id, [...(byRule.get(id) ?? []), action]);
  }

  const entries: LaneEntry<T>[] = [];
  const emitted = new Set<string>();
  for (const action of inLane) {
    const id = ruleIdForAction(action);
    const members = byRule.get(id)!;
    const actionRule = getActionRule(id);
    if (!actionRule.collapse || members.length < COLLAPSE_MIN_ITEMS) {
      entries.push({ kind: 'card', action });
    } else if (!emitted.has(id)) {
      emitted.add(id);
      entries.push({ kind: 'group', group: { rule: actionRule, lane, actions: members } });
    }
  }
  return entries;
}

/** One thing keyboard focus can land on: an individual card, or a collapsed group. */
export interface LaneNavItem<T> {
  /** The action id for a card; `group:<lane>:<ruleId>` for a group. */
  id: string;
  lane: FinancialActionLane;
  entry: LaneEntry<T>;
}

export function groupNavId(lane: FinancialActionLane, ruleId: string): string {
  return `group:${lane}:${ruleId}`;
}

/**
 * Everything the lanes show, in lane order then display order. This is what
 * arrow keys walk and what the focus highlight follows, so a collapsed group
 * is a stop like any card rather than a gap the keyboard skips.
 */
export function laneNavItems<T extends Classifiable & { lane: FinancialActionLane; id: string }>(
  actions: T[],
  lanes: FinancialActionLane[],
): LaneNavItem<T>[] {
  return lanes.flatMap(lane => layoutLane(actions, lane).map(entry => ({
    id: entry.kind === 'card' ? entry.action.id : groupNavId(lane, entry.group.rule.id),
    lane,
    entry,
  })));
}

/** The actions a lane shows as individual cards. */
export function individualCards<T extends Classifiable & { lane: FinancialActionLane }>(
  actions: T[],
  lanes: FinancialActionLane[],
  options: { collapse?: boolean } = {},
): T[] {
  return lanes.flatMap(lane =>
    layoutLane(actions, lane, options).flatMap(entry => entry.kind === 'card' ? [entry.action] : []));
}
