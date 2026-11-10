/**
 * Categorization rule matching: the pure half of the rules engine.
 *
 * No database imports, so validators (the AI rule suggestions in
 * src/lib/ai-suggest/) and tests can use the exact import-time semantics
 * without Prisma. src/lib/services/categorization.service.ts re-exports all of
 * this; existing imports from the service keep working.
 */

export type MatchType = 'contains' | 'exact' | 'regex';

export const MATCH_TYPES: readonly MatchType[] = ['contains', 'exact', 'regex'] as const;

export function isMatchType(value: unknown): value is MatchType {
  return typeof value === 'string' && (MATCH_TYPES as readonly string[]).includes(value);
}

/**
 * Validate the mutable rule fields shared by the create and update API routes.
 * Returns an error message or null when valid. Fields left undefined are skipped.
 */
export function validateRuleFields(fields: {
  pattern?: unknown;
  matchType?: unknown;
  priority?: unknown;
}): string | null {
  if (fields.pattern !== undefined) {
    if (typeof fields.pattern !== 'string' || !fields.pattern.trim()) {
      return 'pattern must be a non-empty string';
    }
  }
  if (fields.matchType !== undefined && !isMatchType(fields.matchType)) {
    return "matchType must be one of: 'contains', 'exact', 'regex'";
  }
  if (fields.matchType === 'regex' && typeof fields.pattern === 'string') {
    try {
      new RegExp(fields.pattern, 'i');
    } catch {
      return 'pattern is not a valid regular expression';
    }
  }
  if (fields.priority !== undefined) {
    if (typeof fields.priority !== 'number' || !Number.isInteger(fields.priority)) {
      return 'priority must be an integer';
    }
  }
  return null;
}

export interface CategorizationRule {
  id: number;
  bookGuid: string;
  pattern: string;
  matchType: MatchType;
  accountGuid: string;
  priority: number;
  enabled: boolean;
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  /** Full account path from the account_hierarchy view (list queries only). */
  accountName?: string | null;
}

/**
 * Pure matcher. Case-insensitive for all match types.
 * - 'contains': substring match
 * - 'exact': full-string match (both sides trimmed)
 * - 'regex': case-insensitive RegExp; an invalid regex never matches
 * Higher priority wins; ties broken by lower id (older rule).
 * Disabled rules never match.
 */
export function matchRule(
  rules: CategorizationRule[],
  description: string,
): CategorizationRule | null {
  const desc = (description || '').trim();
  if (!desc) return null;
  const descLower = desc.toLowerCase();

  const candidates = rules.filter(rule => {
    if (!rule.enabled) return false;
    const pattern = (rule.pattern || '').trim();
    if (!pattern) return false;

    switch (rule.matchType) {
      case 'contains':
        return descLower.includes(pattern.toLowerCase());
      case 'exact':
        return descLower === pattern.toLowerCase();
      case 'regex':
        try {
          return new RegExp(pattern, 'i').test(desc);
        } catch {
          return false; // invalid regex never matches
        }
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id - b.id;
  });

  return candidates[0];
}

/** Lowercase, strip digit runs, collapse whitespace. Used to group history. */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive a usable 'contains' pattern from the raw (lowercased) sample
 * descriptions of a group: the longest common prefix, trimmed of trailing
 * digits/punctuation. Falls back to the normalized description when the
 * prefix is too short to be meaningful.
 */
export function derivePattern(samples: string[], normalized: string): string {
  const cleaned = samples.map(s => s.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    let prefix = cleaned[0];
    for (const s of cleaned.slice(1)) {
      let i = 0;
      const max = Math.min(prefix.length, s.length);
      while (i < max && prefix[i] === s[i]) i++;
      prefix = prefix.slice(0, i);
      if (!prefix) break;
    }
    // Trim trailing digits, separators, and dangling punctuation
    prefix = prefix.replace(/[\s0-9#*\-_.,:;/\\]+$/g, '').trim();
    if (prefix.length >= 4) return prefix;
  }
  return normalized;
}
