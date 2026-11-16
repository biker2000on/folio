/**
 * Which Action Center rules are switched on, per user and book.
 *
 * Stored as one JSON preference per book in gnucash_web_user_preferences, so
 * a household book and a business book can mute different things.
 */

import { getPreference, setPreference } from '@/lib/user-preferences';
import {
  disabledRuleIds,
  isKnownRuleId,
  type RuleOverrides,
} from './rules';

function preferenceKey(bookGuid: string): string {
  return `actionCenter.rules:${bookGuid}`;
}

function sanitize(value: unknown): RuleOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const overrides: RuleOverrides = {};
  for (const [id, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (isKnownRuleId(id) && typeof enabled === 'boolean') overrides[id] = enabled;
  }
  return overrides;
}

export async function getRuleOverrides(userId: number, bookGuid: string): Promise<RuleOverrides> {
  return sanitize(await getPreference<unknown>(userId, preferenceKey(bookGuid), {}));
}

export async function getDisabledRuleIds(userId: number, bookGuid: string): Promise<Set<string>> {
  return disabledRuleIds(await getRuleOverrides(userId, bookGuid));
}

export async function setRulesEnabled(
  userId: number,
  bookGuid: string,
  changes: RuleOverrides,
): Promise<RuleOverrides> {
  const next = { ...(await getRuleOverrides(userId, bookGuid)), ...sanitize(changes) };
  await setPreference(userId, preferenceKey(bookGuid), next);
  return next;
}
