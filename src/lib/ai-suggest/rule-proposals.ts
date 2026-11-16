/**
 * AI rule suggestions: the pure half (prompt payload and validation).
 *
 * The model proposes, this code validates, and nothing is saved until the
 * user clicks Apply on the Rules page (which calls the ordinary rule-creation
 * route). Every proposal is checked here against the book itself:
 *
 *   - the match is at least 2 characters and a valid pattern for its match type
 *     (validateRuleFields, the same check the create route runs)
 *   - the target account is in the book, EXPENSE or INCOME, and not a placeholder
 *   - it does not duplicate an existing rule, and existing rules do not already
 *     take every transaction it would match
 *   - a dry run over the book's history matches at least one transaction and
 *     does not sweep up more than RULE_MAX_HISTORY_SHARE of them
 *   - at most MAX_RULE_PROPOSALS survive; the rest are counted, not shown
 *
 * Invalid proposals are dropped silently and counted by reason. A `why` whose
 * figures the payload does not back is dropped (the proposal stays).
 *
 * No database or server imports: unit-tested directly.
 */

import {
    derivePattern,
    matchRule,
    normalizeDescription,
    validateRuleFields,
    type CategorizationRule,
    type MatchType,
} from '@/lib/categorization-rules-core';
import { collectKnownNumbers, unsupportedFigures, type Figure } from '@/lib/ai-privacy/number-check';
import { SUMMARY_PROMPT_NOTE, tokenizeAccountPath, type Names } from '@/lib/ai-privacy/privacy';
import type { AiChatMessage } from '@/lib/ai-query/client';

/** At most this many proposals are returned. */
export const MAX_RULE_PROPOSALS = 20;
/** At most this many raw proposals are looked at (bounds the dry-run work). */
export const MAX_RULE_PROPOSALS_SCANNED = 60;
/** A match shorter than this (after trimming) would match almost anything. */
export const MIN_RULE_MATCH_LENGTH = 2;
/** Longer matches are cut to this length. */
export const MAX_RULE_MATCH_LENGTH = 80;
/** A rule matching more than this share of all book transactions is implausible. */
export const RULE_MAX_HISTORY_SHARE = 0.2;
/**
 * The share cap applies once a rule matches more than this many transactions,
 * so a small book's one busy merchant is not rejected for being 30% of 20.
 */
export const RULE_SHARE_CHECK_MIN_MATCHES = 10;
/** Sample descriptions shown per proposal. */
export const RULE_PREVIEW_SAMPLES = 3;
/** Descriptions and accounts sent to the model. */
export const MAX_RULE_PROMPT_DESCRIPTIONS = 80;
export const MAX_RULE_PROMPT_ACCOUNTS = 200;
export const MAX_WHY_LENGTH = 240;

/** Match types the AI may propose. Regex is not offered: a model-written regex runs over every description. */
const AI_MATCH_TYPES: readonly MatchType[] = ['contains', 'exact'];

export type RuleDropReason =
    | 'malformed'
    | 'unknown-token'
    | 'too-short'
    | 'invalid-pattern'
    | 'unknown-account'
    | 'wrong-account-type'
    | 'placeholder-account'
    | 'duplicate-rule'
    | 'duplicate-proposal'
    | 'covered-by-rule'
    | 'no-history-match'
    | 'too-broad'
    | 'over-cap';

/** A book account a rule could target (or that the model might name). */
export interface RuleTargetAccount {
    guid: string;
    /** Book-relative path, e.g. "Expenses:Food:Groceries". */
    path: string;
    name: string;
    type: string;
    placeholder: boolean;
}

/** One distinct payee text in the book's history and how many transactions carry it. */
export interface HistoryDescription {
    description: string;
    count: number;
    /** Transactions with this payee sitting on an Imbalance/Orphan/Uncategorized account. */
    uncategorized: number;
}

/** A description group the model is asked about. */
export interface RuleCandidate {
    /** The text the model sees (a token in summary mode) and may use as the match. */
    text: string;
    count: number;
    uncategorized: boolean;
}

export interface RuleProposal {
    match: string;
    matchType: MatchType;
    accountGuid: string;
    accountPath: string;
    accountType: string;
    why: string | null;
    /** Past transactions it would take (excluding ones existing rules already take). */
    matchCount: number;
    /** Of those, how many sit on an Imbalance/Orphan/Uncategorized account today. */
    uncategorizedCount: number;
    /** Share of all book transactions the pattern matches (0..1). */
    share: number;
    samples: string[];
}

export interface RuleValidationContext {
    /** Exact-token unmask for text that will be used (match, account). Identity in full mode. */
    unmaskStrict: (text: string) => { text: string; unknown: string[] };
    /** Lenient unmask for text that will be shown (why). Identity in full mode. */
    unmask: (text: string) => string;
    accounts: readonly RuleTargetAccount[];
    existingRules: ReadonlyArray<Pick<CategorizationRule, 'pattern' | 'matchType' | 'priority' | 'id'>>;
    history: readonly HistoryDescription[];
    /** Every transaction in the book (the share denominator). */
    totalTransactions: number;
    /** Numbers in the payload the model saw. */
    knownNumbers: readonly number[];
}

export interface RuleValidationResult {
    proposals: RuleProposal[];
    dropped: number;
    reasons: Partial<Record<RuleDropReason, number>>;
    /** Proposals kept whose `why` was dropped by the number check. */
    whyDropped: number;
    /** The figures that failed, for a log line (numbers only). */
    failedFigures: Figure[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function asRule(pattern: string, matchType: MatchType, extra: Partial<CategorizationRule> = {}): CategorizationRule {
    return {
        id: 0,
        bookGuid: '',
        pattern,
        matchType,
        accountGuid: '',
        priority: 0,
        enabled: true,
        hitCount: 0,
        lastHitAt: null,
        createdAt: new Date(0),
        ...extra,
    };
}

/**
 * The account a model reference names: a guid, a full path (case-insensitive),
 * a path missing its top level, or a unique bare name. Null when nothing or
 * more than one account matches.
 */
export function resolveAccountRef<T extends { guid: string; path: string; name: string }>(
    ref: string,
    accounts: readonly T[],
): T | null {
    const r = ref.trim();
    if (!r) return null;
    const lower = r.toLowerCase();
    if (/^[0-9a-f]{32}$/i.test(r)) return accounts.find(a => a.guid.toLowerCase() === lower) ?? null;
    const byPath = accounts.filter(a => a.path.toLowerCase() === lower);
    if (byPath.length === 1) return byPath[0];
    const bySuffix = accounts.filter(a => a.path.toLowerCase().endsWith(`:${lower}`));
    if (bySuffix.length === 1) return bySuffix[0];
    const byName = accounts.filter(a => a.name.toLowerCase() === lower);
    return byName.length === 1 ? byName[0] : null;
}

/** History descriptions a rule would match, with the import-time matcher. */
export function dryRunRule(
    pattern: string,
    matchType: MatchType,
    history: readonly HistoryDescription[],
): HistoryDescription[] {
    const rule = [asRule(pattern, matchType)];
    return history.filter(h => matchRule(rule, h.description) !== null);
}

function cleanWhy(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const t = raw.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, MAX_WHY_LENGTH) : null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validate the model's `rules` array against the book. Pure. See the module
 * comment for the checks; every rejection is counted under its reason.
 */
export function validateRuleProposals(raw: unknown, ctx: RuleValidationContext): RuleValidationResult {
    const reasons: Partial<Record<RuleDropReason, number>> = {};
    const drop = (r: RuleDropReason) => {
        reasons[r] = (reasons[r] ?? 0) + 1;
    };
    const proposals: RuleProposal[] = [];
    const failedFigures: Figure[] = [];
    let whyDropped = 0;

    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_RULE_PROPOSALS_SCANNED) {
        for (let i = MAX_RULE_PROPOSALS_SCANNED; i < list.length; i++) drop('over-cap');
    }
    const existing = ctx.existingRules.map(r => asRule(r.pattern, r.matchType, { id: r.id, priority: r.priority }));
    const seen = new Set<string>();
    const accountByGuid = new Map(ctx.accounts.map(a => [a.guid, a]));

    for (const item of list.slice(0, MAX_RULE_PROPOSALS_SCANNED)) {
        if (!item || typeof item !== 'object') {
            drop('malformed');
            continue;
        }
        const p = item as Record<string, unknown>;
        if (typeof p.match !== 'string' || typeof p.account !== 'string') {
            drop('malformed');
            continue;
        }
        const matchType: MatchType = p.matchType === undefined || p.matchType === null ? 'contains' : (p.matchType as MatchType);
        if (!AI_MATCH_TYPES.includes(matchType)) {
            drop('invalid-pattern');
            continue;
        }

        const um = ctx.unmaskStrict(p.match);
        const ua = ctx.unmaskStrict(p.account);
        if (um.unknown.length > 0 || ua.unknown.length > 0) {
            drop('unknown-token');
            continue;
        }
        const match = um.text.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE_MATCH_LENGTH).trim();
        if (match.length < MIN_RULE_MATCH_LENGTH) {
            drop('too-short');
            continue;
        }
        if (validateRuleFields({ pattern: match, matchType }) !== null) {
            drop('invalid-pattern');
            continue;
        }

        const resolved = resolveAccountRef(ua.text, ctx.accounts);
        const account = resolved ? accountByGuid.get(resolved.guid) : undefined;
        if (!account) {
            drop('unknown-account');
            continue;
        }
        if (account.type !== 'EXPENSE' && account.type !== 'INCOME') {
            drop('wrong-account-type');
            continue;
        }
        if (account.placeholder) {
            drop('placeholder-account');
            continue;
        }

        const key = `${matchType}\u0000${match.toLowerCase()}`;
        if (ctx.existingRules.some(r => r.matchType === matchType && r.pattern.trim().toLowerCase() === match.toLowerCase())) {
            drop('duplicate-rule');
            continue;
        }
        if (seen.has(key)) {
            drop('duplicate-proposal');
            continue;
        }

        // Dry run over history, with the same matcher imports use.
        const hits = dryRunRule(match, matchType, ctx.history);
        const rawCount = hits.reduce((s, h) => s + h.count, 0);
        if (rawCount === 0) {
            drop('no-history-match');
            continue;
        }
        const share = ctx.totalTransactions > 0 ? rawCount / ctx.totalTransactions : 1;
        if (rawCount > RULE_SHARE_CHECK_MIN_MATCHES && share > RULE_MAX_HISTORY_SHARE) {
            drop('too-broad');
            continue;
        }
        // What an existing rule already takes stays with that rule.
        const fresh = existing.length > 0 ? hits.filter(h => matchRule(existing, h.description) === null) : hits;
        if (fresh.length === 0) {
            drop('covered-by-rule');
            continue;
        }

        if (proposals.length >= MAX_RULE_PROPOSALS) {
            drop('over-cap');
            continue;
        }
        seen.add(key);

        let why = cleanWhy(p.why);
        if (why) {
            const bad = unsupportedFigures(why, ctx.knownNumbers);
            if (bad.length > 0) {
                failedFigures.push(...bad);
                why = null;
                whyDropped++;
            } else {
                why = ctx.unmask(why);
            }
        }

        const sorted = [...fresh].sort((a, b) => b.count - a.count || a.description.localeCompare(b.description));
        proposals.push({
            match,
            matchType,
            accountGuid: account.guid,
            accountPath: account.path,
            accountType: account.type,
            why,
            matchCount: fresh.reduce((s, h) => s + h.count, 0),
            uncategorizedCount: fresh.reduce((s, h) => s + h.uncategorized, 0),
            share,
            samples: sorted.slice(0, RULE_PREVIEW_SAMPLES).map(h => h.description),
        });
    }

    const dropped = Object.values(reasons).reduce((s, n) => s + (n ?? 0), 0);
    return { proposals, dropped, reasons, whyDropped, failedFigures };
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

/**
 * Description groups the existing rules and the deterministic learned
 * suggestions leave uncovered: rare (under 3), mixed (no 80% majority) or
 * uncategorised descriptions. Grouped like the learned suggestions (digits
 * stripped), represented by their derived pattern, uncategorised first, then
 * most frequent. Pure.
 */
export function pickRuleCandidates(
    history: readonly HistoryDescription[],
    existingRules: ReadonlyArray<Pick<CategorizationRule, 'pattern' | 'matchType' | 'priority' | 'id'>>,
    learnedPatterns: readonly string[],
): RuleCandidate[] {
    const existing = existingRules.map(r => asRule(r.pattern, r.matchType, { id: r.id, priority: r.priority }));
    const learned = learnedPatterns.map((pattern, i) => asRule(pattern, 'contains', { id: -(i + 1) }));
    const groups = new Map<string, { samples: string[]; count: number; uncategorized: number }>();
    for (const h of history) {
        if (existing.length > 0 && matchRule(existing, h.description)) continue;
        if (learned.length > 0 && matchRule(learned, h.description)) continue;
        const norm = normalizeDescription(h.description);
        if (!norm) continue;
        const g = groups.get(norm) ?? { samples: [], count: 0, uncategorized: 0 };
        g.samples.push(h.description);
        g.count += h.count;
        g.uncategorized += h.uncategorized;
        groups.set(norm, g);
    }
    return [...groups.entries()]
        .map(([norm, g]) => ({
            text: derivePattern(g.samples, norm),
            count: g.count,
            uncategorized: g.uncategorized > 0,
        }))
        .sort((a, b) => Number(b.uncategorized) - Number(a.uncategorized) || b.count - a.count || a.text.localeCompare(b.text))
        .slice(0, MAX_RULE_PROMPT_DESCRIPTIONS);
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/** The privacy helpers the payload builder needs (a GatedAi satisfies it). */
export interface RulePromptPrivacy {
    level: 'summary' | 'full';
    names: Names | null;
    token: (kind: 'Merchant', real: string) => string;
}

export interface RulePromptPayload {
    descriptions: Array<{ d: string; n: number; uncategorized?: true }>;
    accounts: Array<{ a: string; t: string }>;
}

/**
 * The payload the model sees. In summary mode descriptions become merchant
 * tokens and each account path segment an account token (generic top-level
 * names such as "Expenses" stay). Counts are kept. Pure.
 */
export function buildRulePromptPayload(
    candidates: readonly RuleCandidate[],
    accounts: ReadonlyArray<Pick<RuleTargetAccount, 'path' | 'type'>>,
    privacy: RulePromptPrivacy,
): RulePromptPayload {
    const summary = privacy.level === 'summary' && privacy.names;
    return {
        descriptions: candidates.slice(0, MAX_RULE_PROMPT_DESCRIPTIONS).map(c => ({
            d: summary ? privacy.token('Merchant', c.text) : c.text,
            n: c.count,
            ...(c.uncategorized ? { uncategorized: true as const } : {}),
        })),
        accounts: accounts.slice(0, MAX_RULE_PROMPT_ACCOUNTS).map(a => ({
            a: summary ? tokenizeAccountPath(privacy.names!, a.path) : a.path,
            t: a.type,
        })),
    };
}

/** Chat messages for the rule suggestion call. Pure. */
export function buildRuleMessages(payload: RulePromptPayload, summary: boolean): AiChatMessage[] {
    const system = [
        'You suggest categorization rules for a personal bookkeeping app.',
        'A rule says: when an imported transaction description contains `match`, file it under `account`.',
        'You get transaction descriptions (d) with how many transactions carry each (n), marked uncategorized when they',
        'sit in an Imbalance or Orphan account today, and the expense and income accounts (a) with their type (t).',
        'Reply with ONLY a JSON object: { "rules": [{ "match": string, "account": string, "why": string }] }.',
        '- `account` must be copied exactly from the accounts list.',
        '- `match` should be the shortest text that identifies the merchant, copied from a description.',
        '- Only propose a rule when the account is a clear fit. Skip descriptions you are unsure about.',
        '- Never propose a match that would catch unrelated merchants (e.g. "pay", "the", "inc").',
        '- `why` is optional: one short plain sentence. Do not include amounts.',
        `- At most ${MAX_RULE_PROPOSALS} rules.`,
        ...(summary
            ? [
                '',
                SUMMARY_PROMPT_NOTE,
                '- When a description is a token, use the whole token as `match`.',
            ]
            : []),
    ].join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

/** Numbers in the payload the model saw (for the why check). Pure. */
export function ruleKnownNumbers(payload: RulePromptPayload): number[] {
    return collectKnownNumbers(payload);
}
