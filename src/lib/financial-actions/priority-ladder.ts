/**
 * Priority steps: an optional Action Center ordering modeled on the "priority
 * ladder" of mainstream personal-finance guidance. Opportunities are grouped
 * by the step they serve, then ordered by the value the user can actually
 * fund. Contribution-type opportunities pass an affordability gate first, so
 * the Action Center never ranks "max your IRA" above a card charging 24%, or
 * asks for money the user does not have spare.
 *
 * Pure and client-safe: no database, no provenance hashing. The server builds
 * the facts (sources.ts) and the calculation trace (order.ts).
 */
import type {
  CalculationStep,
  EvidenceRef,
  FinancialAction,
  FinancialActionCandidate,
} from './types';

export type ActionOrderMode = 'weighted' | 'ladder';
export const ACTION_ORDER_MODES: readonly ActionOrderMode[] = ['weighted', 'ladder'];
export const DEFAULT_ACTION_ORDER: ActionOrderMode = 'weighted';
/** Per-user preference key in gnucash_web_user_preferences. */
export const ACTION_ORDER_PREFERENCE_KEY = 'action_center.order';

export function parseActionOrderMode(value: unknown): ActionOrderMode {
  return value === 'ladder' || value === 'weighted' ? value : DEFAULT_ACTION_ORDER;
}

export const LADDER_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];
export const LADDER_STEP_LABEL: Record<LadderStep, string> = {
  1: 'Stop the bleeding',
  2: 'Starter emergency fund',
  3: 'Employer match',
  4: 'Pay off debt',
  5: 'Full emergency fund',
  6: 'Tax-advantaged saving',
  7: 'Smaller wins',
};

/** Emergency fund targets, in months of spending. */
export const STARTER_EMERGENCY_FUND_MONTHS = 1;
export const FULL_EMERGENCY_FUND_MONTHS = 3;
/** A non-card debt at or above this APR counts as carried high-interest debt. */
export const HIGH_APR_PERCENT = 10;
/** Card interest below this (over the facts window) is rounding, not a carried balance. */
export const CARD_INTEREST_CARRY_MIN = 1;
/** Funding horizon for a contribution with no deadline (emergency-fund top-ups). */
export const DEFAULT_FUNDING_HORIZON_MONTHS = 12;
/** Never spread a deadline over less than half a month. */
export const MIN_FUNDING_MONTHS = 0.5;
const DAYS_PER_MONTH = 30.4;

/** Opportunity packs that ask the user to put money in. */
const CONTRIBUTION_PACKS = new Set([
  'contribution-capacity',
  'emergency-fund',
  'retirement-sequencing',
]);

/**
 * The real numbers the ladder reads. Built once per materialization from the
 * book; stored with each opportunity so its trace can show them later.
 */
export interface LadderFacts {
  asOfDate: string;
  /** Days of history behind the monthly averages. */
  windowDays: number;
  /** Bank and cash balances now. */
  cash: number;
  /** Average monthly income over the window. */
  monthlyIncome: number;
  /** Average monthly spending over the window (all expense accounts). */
  monthlySpending: number;
  /** Interest charged against credit-card accounts over the window; null when it could not be checked. */
  cardInterest: number | null;
  /** Non-card debts with a balance and a configured APR at or above HIGH_APR_PERCENT. */
  highAprDebts: Array<{ name: string; apr: number; owed: number }>;
}

export interface LadderPosition {
  /** Income minus spending, per month, never below zero. */
  spare: number;
  starterTarget: number;
  fullTarget: number;
  carryingCardInterest: boolean;
  carryingHighAprDebt: boolean;
  /** Cash covers the starter fund. */
  cushion: boolean;
  /** Spending above income on average over the window. */
  overspending: boolean;
}

/** Facts with no cash flow at all are no facts: nothing can be judged from them. */
export function hasUsableFacts(facts: LadderFacts | null | undefined): facts is LadderFacts {
  return !!facts
    && Number.isFinite(facts.cash)
    && Number.isFinite(facts.monthlyIncome)
    && Number.isFinite(facts.monthlySpending)
    && (facts.monthlyIncome > 0 || facts.monthlySpending > 0);
}

export function ladderPosition(facts: LadderFacts): LadderPosition {
  const spare = Math.max(0, facts.monthlyIncome - facts.monthlySpending);
  const month = Math.max(0, facts.monthlySpending);
  const starterTarget = month * STARTER_EMERGENCY_FUND_MONTHS;
  return {
    spare,
    starterTarget,
    fullTarget: month * FULL_EMERGENCY_FUND_MONTHS,
    carryingCardInterest: (facts.cardInterest ?? 0) >= CARD_INTEREST_CARRY_MIN,
    carryingHighAprDebt: facts.highAprDebts.length > 0,
    cushion: facts.cash >= starterTarget,
    overspending: facts.monthlySpending > facts.monthlyIncome,
  };
}

export function formatLadderMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

type LadderSubject = Pick<FinancialActionCandidate, 'stableKey' | 'origin' | 'metadata' | 'dueDate' | 'impact'>;

/** The opportunity pack an action came from, or the debt-vs-invest source. */
export function ladderPackOf(action: Pick<FinancialActionCandidate, 'stableKey' | 'metadata'>): string | null {
  const pack = action.metadata?.opportunityPack;
  if (typeof pack === 'string' && pack) return pack;
  if (action.metadata?.toolType === 'debt-vs-invest' || action.stableKey.startsWith('debt-investment:')) {
    return 'debt-investment';
  }
  const match = action.stableKey.match(/^opportunity:([^:]+):/);
  return match ? match[1] : null;
}

function numberMeta(action: Pick<FinancialActionCandidate, 'metadata'>, key: string): number | null {
  const value = action.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface LadderStepResult {
  step: LadderStep;
  reason: string;
}

/**
 * Which step an opportunity serves. Facts refine two packs: debt (card
 * interest is step 1, other debt step 4) and the emergency fund (starter vs
 * full). Without facts the action's own numbers decide.
 */
export function classifyLadderStep(
  action: Pick<FinancialActionCandidate, 'stableKey' | 'metadata'>,
  position: LadderPosition | null,
): LadderStepResult {
  const pack = ladderPackOf(action);
  switch (pack) {
    case 'estimated-tax':
      return { step: 1, reason: 'An estimated-tax shortfall builds IRS underpayment interest. Paying on time stops it.' };
    case 'debt-vs-cash': {
      const apr = numberMeta(action, 'apr');
      if (apr !== null && apr >= HIGH_APR_PERCENT) {
        return { step: 1, reason: `This debt charges ${apr.toFixed(2)}% APR, at or above the ${HIGH_APR_PERCENT}% high-interest line.` };
      }
      return { step: 4, reason: apr !== null ? `This debt charges ${apr.toFixed(2)}% APR, below the ${HIGH_APR_PERCENT}% high-interest line.` : 'Paying off debt.' };
    }
    case 'debt-investment':
      return { step: 4, reason: 'A saved debt-or-invest decision about paying off debt.' };
    case 'emergency-fund': {
      if (position) {
        return position.cushion
          ? { step: 5, reason: `Cash already covers the ${STARTER_EMERGENCY_FUND_MONTHS}-month starter fund; this grows it to ${FULL_EMERGENCY_FUND_MONTHS} months.` }
          : { step: 2, reason: `Cash is below the ${STARTER_EMERGENCY_FUND_MONTHS}-month starter fund.` };
      }
      const cash = numberMeta(action, 'cash');
      const monthly = numberMeta(action, 'monthlyExpenses');
      if (cash !== null && monthly !== null && cash >= monthly * STARTER_EMERGENCY_FUND_MONTHS) {
        return { step: 5, reason: `Cash already covers the ${STARTER_EMERGENCY_FUND_MONTHS}-month starter fund; this grows it to ${FULL_EMERGENCY_FUND_MONTHS} months.` };
      }
      return { step: 2, reason: `Cash is below the ${STARTER_EMERGENCY_FUND_MONTHS}-month starter fund.` };
    }
    case 'contribution-capacity':
      return { step: 6, reason: 'Unused tax-advantaged contribution room.' };
    case 'budget-gaps':
      return position?.overspending
        ? { step: 1, reason: 'Spending is above income, so budget overruns are where money leaks.' }
        : { step: 7, reason: position ? 'Spending is within income; a budget overrun is a smaller win.' : 'A budget overrun. Spending versus income is unknown.' };
    case 'retirement-sequencing':
      return { step: 7, reason: 'A retirement-income timing choice; it does not ask for new money.' };
    case 'portfolio':
      return { step: 7, reason: 'A portfolio tweak.' };
    case 'tax-strategy':
      return { step: 7, reason: 'A tax-strategy tweak on existing holdings.' };
    case 'subscriptions':
      return { step: 7, reason: 'A recurring-charge cleanup.' };
    default:
      return { step: 7, reason: 'Not tied to an earlier step.' };
  }
}

export type LadderGateStatus = 'not_applicable' | 'skipped' | 'clear' | 'capped' | 'blocked';

export interface LadderGate {
  status: LadderGateStatus;
  /** Short text for the card. Null when nothing limits the action. */
  message: string | null;
  /** Why the gate did or did not apply, for the trace. */
  reason: string;
  need: number | null;
  fundable: number | null;
  months: number | null;
  perMonth: number | null;
  spare: number | null;
  blockedBy?: 'card_interest' | 'high_apr_debt' | 'starter_fund';
}

export const GATE_SKIPPED_REASON = 'No cash-flow facts, so nothing is gated.';

export function isContributionAction(action: Pick<FinancialActionCandidate, 'stableKey' | 'metadata'>): boolean {
  const pack = ladderPackOf(action);
  return pack !== null && CONTRIBUTION_PACKS.has(pack) && (numberMeta(action, 'cashRequired') ?? 0) > 0;
}

/** Months from asOf to a YYYY-MM-DD deadline, floored at MIN_FUNDING_MONTHS. */
export function monthsUntil(asOfDate: string, dueDate: string): number {
  const days = (Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${asOfDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days)) return DEFAULT_FUNDING_HORIZON_MONTHS;
  return Math.max(MIN_FUNDING_MONTHS, days / DAYS_PER_MONTH);
}

/**
 * The affordability gate: how much of `need` the user can really put in by
 * the deadline. Card interest and the starter fund come first; after them,
 * spare money each month plus cash above the full emergency fund.
 */
export function fundableAmount(
  input: { need: number; dueDate?: string | null; step: LadderStep },
  facts: LadderFacts | null,
  money: (value: number) => string = formatLadderMoney,
): LadderGate {
  const need = Math.max(0, input.need);
  if (!hasUsableFacts(facts)) {
    return { status: 'skipped', message: null, reason: GATE_SKIPPED_REASON, need, fundable: need, months: null, perMonth: null, spare: null };
  }
  const position = ladderPosition(facts);
  const months = input.dueDate ? monthsUntil(facts.asOfDate, input.dueDate) : DEFAULT_FUNDING_HORIZON_MONTHS;
  const perMonth = need / months;
  const base = { need, months, perMonth, spare: position.spare };
  const horizon = input.dueDate
    ? `${months.toFixed(1)} months until the ${input.dueDate.slice(0, 10)} deadline`
    : `no deadline, so a ${DEFAULT_FUNDING_HORIZON_MONTHS}-month horizon`;

  // The starter fund itself is never held behind card interest or itself.
  if (input.step > 2) {
    if (position.carryingCardInterest) {
      return {
        ...base,
        status: 'blocked',
        blockedBy: 'card_interest',
        fundable: 0,
        message: 'Pay off card interest first.',
        reason: `${money(facts.cardInterest ?? 0)} of card interest was charged in the last ${facts.windowDays} days. Interest costs more than this earns.`,
      };
    }
    if (position.carryingHighAprDebt) {
      const names = facts.highAprDebts.map(debt => `${debt.name} at ${debt.apr.toFixed(2)}%`).join(', ');
      return {
        ...base,
        status: 'blocked',
        blockedBy: 'high_apr_debt',
        fundable: 0,
        message: 'Pay off high-interest debt first.',
        reason: `High-interest debt still has a balance: ${names}.`,
      };
    }
    if (!position.cushion) {
      return {
        ...base,
        status: 'blocked',
        blockedBy: 'starter_fund',
        fundable: 0,
        message: `Build your ${money(position.starterTarget)} starter fund first.`,
        reason: `Cash is ${money(facts.cash)}, below the ${money(position.starterTarget)} starter fund (${STARTER_EMERGENCY_FUND_MONTHS} month of spending).`,
      };
    }
  }

  const surplusCash = Math.max(0, facts.cash - position.fullTarget);
  const cap = position.spare * months + surplusCash;
  const fundable = Math.min(need, cap);
  if (fundable < need - 1) {
    return {
      ...base,
      status: 'capped',
      fundable,
      message: `Needs about ${money(perMonth)} a month; you have about ${money(position.spare)} spare.`,
      reason: `Spare cash covers ${money(fundable)} of ${money(need)}: ${money(position.spare)} a month over ${horizon}${surplusCash > 0 ? `, plus ${money(surplusCash)} of cash above the full emergency fund` : ''}.`,
    };
  }
  return {
    ...base,
    status: 'clear',
    fundable,
    message: null,
    reason: `Spare cash covers all ${money(need)}: ${money(position.spare)} a month over ${horizon}${surplusCash > 0 ? `, plus ${money(surplusCash)} of cash above the full emergency fund` : ''}.`,
  };
}

export interface PriorityLadderInfo {
  version: 1;
  step: LadderStep;
  stepLabel: string;
  stepReason: string;
  pack: string | null;
  gate: LadderGate;
  /** Value used to order within a step: the impact midpoint scaled by the fundable share. */
  value: number;
  facts: LadderFacts | null;
}

function impactMidpoint(action: Pick<FinancialActionCandidate, 'impact'>): number {
  if (!action.impact) return 0;
  return Math.max(0, (action.impact.low + action.impact.high) / 2);
}

export function computePriorityLadder(action: LadderSubject, facts: LadderFacts | null): PriorityLadderInfo {
  const usable = hasUsableFacts(facts) ? facts : null;
  const position = usable ? ladderPosition(usable) : null;
  const { step, reason } = classifyLadderStep(action, position);
  const gate: LadderGate = isContributionAction(action)
    ? fundableAmount({ need: numberMeta(action, 'cashRequired') ?? 0, dueDate: action.dueDate, step }, usable)
    : {
        status: 'not_applicable',
        message: null,
        reason: 'This does not ask you to put money in, so the gate does not apply.',
        need: null,
        fundable: null,
        months: null,
        perMonth: null,
        spare: position?.spare ?? null,
      };
  const share = gate.need && gate.need > 0 && gate.fundable !== null ? gate.fundable / gate.need : 1;
  return {
    version: 1,
    step,
    stepLabel: LADDER_STEP_LABEL[step],
    stepReason: reason,
    pack: ladderPackOf(action),
    gate,
    value: Math.round(impactMidpoint(action) * share * 100) / 100,
    facts: usable,
  };
}

/** Stamp every opportunity with its step and gate so the trace can be rebuilt later. */
export function annotatePriorityLadder<T extends FinancialActionCandidate>(actions: T[], facts: LadderFacts | null): T[] {
  return actions.map(action => action.origin !== 'opportunity'
    ? action
    : { ...action, metadata: { ...action.metadata, priorityLadder: computePriorityLadder(action, facts) } });
}

function isPriorityLadderInfo(value: unknown): value is PriorityLadderInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as Partial<PriorityLadderInfo>;
  return info.version === 1
    && typeof info.step === 'number'
    && (LADDER_STEPS as readonly number[]).includes(info.step)
    && typeof info.value === 'number'
    && !!info.gate && typeof info.gate === 'object';
}

/** The stored annotation, or one computed now without facts (rows from before the ladder, or sources not annotated). */
export function priorityLadderOf(action: LadderSubject): PriorityLadderInfo {
  const stored = action.metadata?.priorityLadder;
  return isPriorityLadderInfo(stored) ? stored : computePriorityLadder(action, null);
}

/**
 * Only open decisions are ranked by the ladder. Fix and Do items, and other
 * Decide items (household resilience, comments, job profitability), keep the
 * canonical severity-first order: the ladder has no opinion on them.
 */
export function isLadderRanked(action: Pick<FinancialAction, 'origin' | 'lane'>): boolean {
  return action.origin === 'opportunity' && action.lane === 'decide';
}

/** Step first, then fundable value. Zero means "tied"; the caller breaks ties. */
export function compareLadderInfo(left: PriorityLadderInfo, right: PriorityLadderInfo): number {
  return left.step - right.step || right.value - left.value;
}

/** Sort a list of ladder items by step, then value (broke's ladderSort). */
export function ladderSort<T extends LadderSubject>(actions: T[]): T[] {
  return [...actions].sort((a, b) => compareLadderInfo(priorityLadderOf(a), priorityLadderOf(b)) || a.stableKey.localeCompare(b.stableKey));
}

export const LADDER_ASSUMPTIONS = [
  `Spare cash is average monthly income minus spending over the facts window.`,
  `Folio does not tag essential spending, so all spending sets the emergency fund targets (${STARTER_EMERGENCY_FUND_MONTHS} month starter, ${FULL_EMERGENCY_FUND_MONTHS} months full).`,
  `Card interest is interest or finance charges posted against credit-card accounts.`,
  `Non-card debt counts as high-interest at ${HIGH_APR_PERCENT}% APR or more, from the Debt Payoff planner.`,
];

export interface LadderTraceInput {
  namespace: string;
  identity: unknown;
  title: string;
  summary: string;
  asOfDate?: string;
  formula: string;
  result: number;
  unit: 'count';
  range?: { low: number; high: number };
  steps: CalculationStep[];
  evidence: EvidenceRef[];
  assumptions: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

function gateResultText(gate: LadderGate): string {
  if (gate.status === 'blocked' || gate.status === 'capped') return gate.message ?? gate.reason;
  if (gate.status === 'clear') return 'Fully fundable';
  if (gate.status === 'skipped') return 'Skipped';
  return 'Does not apply';
}

/** Input for createCalculationTrace explaining the step and the gate. */
export function ladderTraceInput(action: FinancialAction, info: PriorityLadderInfo): LadderTraceInput {
  const facts = info.facts;
  const position = facts ? ladderPosition(facts) : null;
  const factInputs: Record<string, number | string | boolean | null> = facts && position
    ? {
        cash: Math.round(facts.cash),
        monthlyIncome: Math.round(facts.monthlyIncome),
        monthlySpending: Math.round(facts.monthlySpending),
        spare: Math.round(position.spare),
        starterTarget: Math.round(position.starterTarget),
        fullTarget: Math.round(position.fullTarget),
        cardInterest: facts.cardInterest === null ? null : Math.round(facts.cardInterest * 100) / 100,
        highAprDebts: facts.highAprDebts.length,
        windowDays: facts.windowDays,
      }
    : { facts: 'unavailable' };
  const midpoint = impactMidpoint(action);
  const share = info.gate.need && info.gate.need > 0 && info.gate.fundable !== null ? info.gate.fundable / info.gate.need : 1;
  const steps: CalculationStep[] = [
    {
      key: 'ladder-step',
      label: `Step ${info.step}: ${info.stepLabel}`,
      inputs: { pack: info.pack, ...factInputs },
      result: info.stepReason,
    },
    {
      key: 'affordability-gate',
      label: 'Affordability gate',
      formula: info.gate.status === 'not_applicable' || info.gate.status === 'skipped'
        ? undefined
        : 'fundable = min(need, spare a month × months to deadline + cash above full fund)',
      inputs: {
        status: info.gate.status,
        need: info.gate.need === null ? null : Math.round(info.gate.need),
        months: info.gate.months === null ? null : Math.round(info.gate.months * 10) / 10,
        perMonth: info.gate.perMonth === null ? null : Math.round(info.gate.perMonth),
        spare: info.gate.spare === null ? null : Math.round(info.gate.spare),
        reason: info.gate.reason,
      },
      result: gateResultText(info.gate),
    },
    {
      key: 'ladder-value',
      label: 'Value used to order within the step',
      formula: '(low estimate + high estimate) / 2 × fundable share',
      inputs: {
        low: action.impact?.low ?? null,
        high: action.impact?.high ?? null,
        midpoint: Math.round(midpoint * 100) / 100,
        fundableShare: Math.round(share * 1000) / 1000,
      },
      result: info.value,
    },
  ];
  const warnings = [...action.trace.warnings];
  if (info.gate.status === 'skipped') warnings.push(`The affordability gate was skipped: ${info.gate.reason}`);
  return {
    namespace: 'opportunity-ladder',
    identity: { stableKey: action.stableKey, step: info.step, gate: info.gate.status, value: info.value },
    title: `Why this is in step ${info.step}: ${info.stepLabel}`,
    summary: info.gate.message ? `${action.summary} ${info.gate.message}` : action.summary,
    asOfDate: facts?.asOfDate ?? action.trace.asOfDate,
    formula: 'order = priority step, then fundable value',
    result: info.step,
    unit: 'count',
    range: action.impact ? { low: action.impact.low, high: action.impact.high } : undefined,
    steps,
    evidence: action.trace.evidence,
    assumptions: [...LADDER_ASSUMPTIONS, ...action.trace.assumptions],
    warnings,
    metadata: {
      ...action.trace.metadata,
      priorityLadder: info,
      weightedScore: action.score?.total ?? null,
      weightedTraceId: action.trace.id,
    },
  };
}
