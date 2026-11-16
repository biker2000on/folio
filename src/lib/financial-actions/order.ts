import { createCalculationTrace } from '@/lib/provenance';
import {
  compareLadderInfo,
  isLadderRanked,
  ladderTraceInput,
  priorityLadderOf,
  type ActionOrderMode,
} from './priority-ladder';
import type { FinancialAction } from './types';

const SEVERITY_RANK: Record<FinancialAction['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function compareWeighted(left: FinancialAction, right: FinancialAction): number {
  const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severity !== 0) return severity;

  const score = (right.score?.total ?? 0) - (left.score?.total ?? 0);
  if (score !== 0) return score;

  if (left.dueDate !== right.dueDate) {
    if (left.dueDate === null || left.dueDate === undefined) return 1;
    if (right.dueDate === null || right.dueDate === undefined) return -1;
    return left.dueDate.localeCompare(right.dueDate);
  }

  const firstSeen = right.firstSeenAt.localeCompare(left.firstSeenAt);
  if (firstSeen !== 0) return firstSeen;

  const stableKey = left.stableKey.localeCompare(right.stableKey);
  if (stableKey !== 0) return stableKey;

  const book = left.bookGuid.localeCompare(right.bookGuid);
  if (book !== 0) return book;

  return left.id.localeCompare(right.id);
}

/**
 * Canonical Action Center ordering. The stable key is the final tiebreaker so
 * identical-priority actions never shuffle between requests or family books.
 *
 * In `ladder` mode, open opportunities in the Decide lane come first, ordered
 * by priority step and then fundable value; every other action keeps the
 * weighted order after them. The page renders lanes separately, so in
 * practice the ladder reorders only the Decide lane's opportunities.
 */
export function compareFinancialActions(
  left: FinancialAction,
  right: FinancialAction,
  mode: ActionOrderMode = 'weighted',
): number {
  if (mode === 'ladder') {
    const leftRanked = isLadderRanked(left);
    const rightRanked = isLadderRanked(right);
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    if (leftRanked) {
      const ladder = compareLadderInfo(priorityLadderOf(left), priorityLadderOf(right));
      if (ladder !== 0) return ladder;
    }
  }
  return compareWeighted(left, right);
}

/**
 * Sort actions for a mode. In ladder mode each ladder-ranked action also
 * carries its step annotation and a trace that explains the step and the
 * affordability gate instead of the weighted score.
 */
export function orderFinancialActions(
  actions: FinancialAction[],
  mode: ActionOrderMode = 'weighted',
): FinancialAction[] {
  const prepared = mode === 'ladder'
    ? actions.map(action => {
        if (!isLadderRanked(action)) return action;
        const info = priorityLadderOf(action);
        return {
          ...action,
          metadata: { ...action.metadata, priorityLadder: info },
          trace: createCalculationTrace(ladderTraceInput(action, info)),
        };
      })
    : [...actions];
  return prepared.sort((left, right) => compareFinancialActions(left, right, mode));
}
