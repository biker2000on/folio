import { describe, expect, it } from 'vitest';
import { detectOpportunities, type OpportunitySignal } from '../opportunity-engine';
import { compareFinancialActions, orderFinancialActions } from '../order';
import {
  annotatePriorityLadder,
  classifyLadderStep,
  computePriorityLadder,
  fundableAmount,
  GATE_SKIPPED_REASON,
  ladderPosition,
  ladderSort,
  parseActionOrderMode,
  priorityLadderOf,
  type LadderFacts,
} from '../priority-ladder';
import type { FinancialAction, FinancialActionCandidate } from '../types';

const AS_OF = '2026-07-01';

function facts(overrides: Partial<LadderFacts> = {}): LadderFacts {
  return {
    asOfDate: AS_OF,
    windowDays: 90,
    cash: 20_000,
    monthlyIncome: 8_000,
    monthlySpending: 5_000,
    cardInterest: 0,
    highAprDebts: [],
    ...overrides,
  };
}

function signal(key: string, overrides: Partial<OpportunitySignal> = {}): OpportunitySignal {
  return {
    key,
    title: `Opportunity ${key}`,
    summary: `Summary ${key}`,
    href: `/tools/${key}`,
    valueLow: 500,
    valueHigh: 1_000,
    impactPeriod: 'annual',
    cashRequired: 0,
    urgency: 60,
    confidence: 0.9,
    liquidityCost: 10,
    reversibility: 80,
    goalAlignment: 70,
    ...overrides,
  };
}

function candidate(pack: string, metadata: Record<string, unknown> = {}): FinancialActionCandidate {
  return {
    stableKey: `opportunity:${pack}:k`,
    lane: 'decide',
    origin: 'opportunity',
    sourceId: `${pack}:k`,
    severity: 'info',
    title: pack,
    summary: pack,
    confidence: 0.9,
    impact: { low: 100, high: 300, period: 'annual' },
    operations: [],
    trace: {
      id: `trace-${pack}`,
      version: 1,
      title: pack,
      summary: pack,
      generatedAt: `${AS_OF}T00:00:00.000Z`,
      asOfDate: AS_OF,
      result: null,
      steps: [],
      evidence: [],
      assumptions: [],
      warnings: [],
    },
    metadata: { opportunityPack: pack, ...metadata },
  };
}

function asAction(item: FinancialActionCandidate, overrides: Partial<FinancialAction> = {}): FinancialAction {
  return {
    ...item,
    id: item.stableKey,
    bookGuid: 'book',
    state: 'open',
    snoozedUntil: null,
    firstSeenAt: `${AS_OF}T00:00:00.000Z`,
    lastSeenAt: `${AS_OF}T00:00:00.000Z`,
    stateChangedAt: `${AS_OF}T00:00:00.000Z`,
    resolvedAt: null,
    ...overrides,
  };
}

describe('priority ladder step classification', () => {
  const position = ladderPosition(facts());

  it.each([
    ['estimated-tax', {}, 1],
    ['debt-vs-cash', { apr: 24 }, 1],
    ['debt-vs-cash', { apr: 7.5 }, 4],
    ['contribution-capacity', {}, 6],
    ['retirement-sequencing', {}, 7],
    ['portfolio', {}, 7],
    ['tax-strategy', {}, 7],
    ['subscriptions', {}, 7],
    ['budget-gaps', {}, 7],
    ['something-new', {}, 7],
  ])('puts %s %o in step %i', (pack, metadata, step) => {
    expect(classifyLadderStep(candidate(pack, metadata), position).step).toBe(step);
  });

  it('puts the saved debt-vs-invest scenarios in step 4', () => {
    const item = { stableKey: 'debt-investment:7:2026-01-01T00:00:00.000Z', metadata: { toolType: 'debt-vs-invest' } };
    expect(classifyLadderStep(item, position).step).toBe(4);
  });

  it('splits the emergency fund into starter and full by the cushion', () => {
    const fund = candidate('emergency-fund', { cash: 3_000, monthlyExpenses: 5_000 });
    expect(classifyLadderStep(fund, ladderPosition(facts({ cash: 3_000 }))).step).toBe(2);
    expect(classifyLadderStep(fund, ladderPosition(facts({ cash: 6_000 }))).step).toBe(5);
    // Without facts the signal's own numbers decide.
    expect(classifyLadderStep(fund, null).step).toBe(2);
    expect(classifyLadderStep(candidate('emergency-fund', { cash: 6_000, monthlyExpenses: 5_000 }), null).step).toBe(5);
  });

  it('moves budget overruns to step 1 when spending is above income', () => {
    const overspending = ladderPosition(facts({ monthlyIncome: 4_000, monthlySpending: 5_000 }));
    expect(classifyLadderStep(candidate('budget-gaps'), overspending).step).toBe(1);
  });
});

describe('affordability gate', () => {
  it('blocks a contribution while card interest is carried', () => {
    const gate = fundableAmount({ need: 7_000, dueDate: '2026-12-31', step: 6 }, facts({ cardInterest: 84.5 }));
    expect(gate).toMatchObject({ status: 'blocked', blockedBy: 'card_interest', fundable: 0, message: 'Pay off card interest first.' });
    expect(gate.reason).toContain('$85 of card interest');
  });

  it('blocks a contribution while a high-APR loan has a balance', () => {
    const gate = fundableAmount(
      { need: 7_000, dueDate: '2026-12-31', step: 6 },
      facts({ highAprDebts: [{ name: 'Personal loan', apr: 13.5, owed: 4_000 }] }),
    );
    expect(gate).toMatchObject({ status: 'blocked', blockedBy: 'high_apr_debt', fundable: 0 });
    expect(gate.reason).toContain('Personal loan at 13.50%');
  });

  it('blocks a contribution with no starter cushion', () => {
    const gate = fundableAmount({ need: 7_000, dueDate: '2026-12-31', step: 6 }, facts({ cash: 1_200 }));
    expect(gate).toMatchObject({ status: 'blocked', blockedBy: 'starter_fund', fundable: 0, message: 'Build your $5,000 starter fund first.' });
  });

  it('caps a contribution at spare cash until the deadline', () => {
    // 6 months to 2026-12-31, $500 spare a month, $12k cash under the $15k full fund.
    const gate = fundableAmount(
      { need: 7_000, dueDate: '2026-12-31', step: 6 },
      facts({ cash: 12_000, monthlyIncome: 5_500, monthlySpending: 5_000 }),
    );
    expect(gate.status).toBe('capped');
    expect(gate.fundable).toBeCloseTo(500 * (183 / 30.4), 0);
    expect(gate.message).toBe('Needs about $1,163 a month; you have about $500 spare.');
  });

  it('counts cash above the full emergency fund toward the cap', () => {
    const gate = fundableAmount(
      { need: 7_000, dueDate: '2026-12-31', step: 6 },
      facts({ cash: 20_000, monthlyIncome: 5_500, monthlySpending: 5_000 }),
    );
    // $5,000 above the $15,000 full fund plus ~$3,010 of spare cash covers it.
    expect(gate).toMatchObject({ status: 'clear', fundable: 7_000, message: null });
  });

  it('leaves an affordable contribution unblocked', () => {
    const gate = fundableAmount({ need: 2_000, dueDate: '2026-12-31', step: 6 }, facts());
    expect(gate).toMatchObject({ status: 'clear', fundable: 2_000, message: null });
  });

  it('skips the gate when facts are missing or empty', () => {
    for (const missing of [null, facts({ monthlyIncome: 0, monthlySpending: 0 })]) {
      const gate = fundableAmount({ need: 7_000, dueDate: '2026-12-31', step: 6 }, missing);
      expect(gate).toMatchObject({ status: 'skipped', fundable: 7_000, message: null, reason: GATE_SKIPPED_REASON });
    }
  });

  it('never holds the starter fund behind card interest or itself', () => {
    const gate = fundableAmount({ need: 12_000, step: 2 }, facts({ cash: 1_000, cardInterest: 50, monthlyIncome: 5_200 }));
    expect(gate.status).toBe('capped');
    expect(gate.months).toBe(12);
    expect(gate.fundable).toBe(2_400);
  });
});

describe('priority ladder annotation', () => {
  it('stamps only opportunities and scales value by the fundable share', () => {
    const contribution = candidate('contribution-capacity', { cashRequired: 7_000 });
    contribution.dueDate = '2026-12-31';
    const other = { ...candidate('x'), origin: 'resilience' as const, metadata: {} };
    const [annotated, untouched] = annotatePriorityLadder(
      [contribution, other],
      facts({ cash: 12_000, monthlyIncome: 5_500, monthlySpending: 5_000 }),
    );
    expect(untouched.metadata).toEqual({});
    const info = priorityLadderOf(annotated);
    expect(info.step).toBe(6);
    expect(info.gate.status).toBe('capped');
    expect(info.value).toBeCloseTo(200 * (info.gate.fundable! / 7_000), 1);
  });

  it('marks the gate not applicable when nothing is put in', () => {
    const info = computePriorityLadder(candidate('subscriptions'), facts());
    expect(info.gate.status).toBe('not_applicable');
    expect(info.value).toBe(200);
  });

  it('falls back to a fact-free annotation for rows stored before the ladder', () => {
    const info = priorityLadderOf(candidate('contribution-capacity', { cashRequired: 7_000 }));
    expect(info.facts).toBeNull();
    expect(info.gate.status).toBe('skipped');
  });

  it('sorts by step, then value', () => {
    const small = candidate('subscriptions');
    const big = { ...candidate('portfolio'), impact: { low: 1_000, high: 3_000, period: 'annual' as const } };
    const debt = candidate('debt-vs-cash', { apr: 22 });
    expect(ladderSort([small, big, debt]).map(item => item.title)).toEqual(['debt-vs-cash', 'portfolio', 'subscriptions']);
  });
});

describe('Action Center order modes', () => {
  // A maxed-out-IRA suggestion outscores card payoff on the weighted formula.
  const opportunities = annotatePriorityLadder(detectOpportunities({
    asOfDate: AS_OF,
    contributionCapacity: [signal('ira', { valueLow: 2_000, valueHigh: 5_000, urgency: 95, cashRequired: 7_000, dueDate: '2026-12-31' })],
    debtPaydown: signal('card', { valueLow: 100, valueHigh: 200, urgency: 10, metadata: { apr: 24 } }),
    subscriptions: [signal('streaming', { valueLow: 50, valueHigh: 100 })],
  }), facts({ cardInterest: 120 })).map(item => asAction(item));
  const fixItem = asAction({ ...candidate('fix'), stableKey: 'fix:1', lane: 'fix', origin: 'data_health', severity: 'critical', metadata: {} });
  const resilience = asAction({ ...candidate('res'), stableKey: 'resilience:1', origin: 'resilience', severity: 'critical', metadata: {} });

  it('parses the stored preference, defaulting to weighted', () => {
    expect(parseActionOrderMode('ladder')).toBe('ladder');
    expect(parseActionOrderMode('weighted')).toBe('weighted');
    expect(parseActionOrderMode('nonsense')).toBe('weighted');
    expect(parseActionOrderMode(undefined)).toBe('weighted');
  });

  it('keeps the weighted order by default', () => {
    const sorted = [...opportunities].sort(compareFinancialActions);
    expect(sorted[0].stableKey).toBe('opportunity:contribution-capacity:ira');
    expect(orderFinancialActions(opportunities).map(item => item.stableKey))
      .toEqual(sorted.map(item => item.stableKey));
  });

  it('ranks card payoff above the IRA in ladder mode, other items after', () => {
    const ordered = orderFinancialActions([resilience, fixItem, ...opportunities], 'ladder');
    expect(ordered.map(item => item.stableKey)).toEqual([
      'opportunity:debt-vs-cash:card',
      'opportunity:contribution-capacity:ira',
      'opportunity:subscriptions:streaming',
      'fix:1',
      'resilience:1',
    ]);
  });

  it('explains the step and the gate in the ladder trace', () => {
    const ordered = orderFinancialActions(opportunities, 'ladder');
    const ira = ordered.find(item => item.stableKey === 'opportunity:contribution-capacity:ira')!;
    expect(ira.trace.title).toBe('Why this is in step 6: Tax-advantaged saving');
    expect(ira.trace.summary).toContain('Pay off card interest first.');
    const gateStep = ira.trace.steps.find(step => step.key === 'affordability-gate')!;
    expect(gateStep.result).toBe('Pay off card interest first.');
    expect(gateStep.inputs.status).toBe('blocked');
    expect(ira.trace.id).not.toBe(opportunities.find(item => item.stableKey === ira.stableKey)!.trace.id);

    const weighted = orderFinancialActions(opportunities, 'weighted');
    expect(weighted.find(item => item.stableKey === ira.stableKey)!.trace.title).toMatch(/^Why this opportunity is ranked/);
  });

  it('says in the trace when the gate was skipped', () => {
    const stale = asAction(candidate('contribution-capacity', { cashRequired: 7_000 }));
    const [ordered] = orderFinancialActions([stale], 'ladder');
    expect(ordered.trace.warnings).toContain(`The affordability gate was skipped: ${GATE_SKIPPED_REASON}`);
  });

  it('does not ladder-rank accepted opportunities in the Do lane', () => {
    const accepted = { ...opportunities[0], lane: 'do' as const, state: 'accepted' as const };
    const [ordered] = orderFinancialActions([accepted], 'ladder');
    expect(ordered.trace.id).toBe(accepted.trace.id);
  });
});
