/**
 * AI narrative for the monthly digest.
 *
 * Builds a compact JSON summary of an assembled MonthlyDigest (net-worth
 * change, cash flow, top category deltas, subscription changes, budget
 * status) and asks the configured chat model for a short factual narrative.
 * Returns { narrative } or null on ANY failure — callers treat the narrative
 * as strictly optional and never let it block digest generation.
 *
 * Privacy: the call goes through the AI privacy gate. In summary mode the
 * payload is summarised (names to tokens, money rounded, month as YYYY-MM) and
 * the reply is unmasked. In every mode each currency figure and percentage in
 * the reply must match a number in the payload actually sent; otherwise the
 * narrative is dropped (null), like any other failure.
 *
 * Pure pieces (payload/message builders, reply validation) are exported for
 * unit tests in src/lib/__tests__/digest-narrative.test.ts.
 */

import type { MonthlyDigest } from '@/lib/digest';
import type { AiChatMessage } from '@/lib/ai-query/client';
import { roundMoney, SUMMARY_PROMPT_NOTE } from '@/lib/ai-privacy/privacy';
import { collectKnownNumbers, unsupportedFigures, warnUnsupported } from '@/lib/ai-privacy/number-check';
import type { GatedAi } from '@/lib/ai-privacy/session';

/** Chat function the narrative generator runs on (injectable for tests). */
export type NarrativeAiClient = (messages: AiChatMessage[]) => Promise<string>;

/** Caps keeping the prompt payload compact. */
export const MAX_NARRATIVE_CATEGORIES = 5;
export const MAX_NARRATIVE_SUBSCRIPTIONS = 3;
/** Upper bound on the accepted narrative length (characters). */
export const MAX_NARRATIVE_LENGTH = 1200;

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export interface NarrativePayload {
    month: string;
    currency: string;
    netWorth: { end: number; change: number; changePercent: number };
    cashFlow: { income: number; expenses: number; savingsRate: number };
    topCategories: Array<{ name: string; amount: number; delta: number; percent: number }>;
    subscriptions: {
        new: Array<{ label: string; amount: number }>;
        changed: Array<{ label: string; amount: number; changePercent: number }>;
        stopped: Array<{ label: string; amount: number }>;
    };
    budget: {
        name: string;
        overCount: number;
        underCount: number;
        totalBudgeted: number;
        totalActual: number;
    } | null;
}

/**
 * Reduce a full digest to the compact JSON summary the model sees. Pure.
 * Category and subscription lists are capped so the payload stays small.
 */
export function buildNarrativePayload(digest: MonthlyDigest): NarrativePayload {
    return {
        month: digest.monthLabel,
        currency: digest.currency,
        netWorth: {
            end: round2(digest.netWorth.end),
            change: round2(digest.netWorth.change),
            changePercent: round2(digest.netWorth.changePercent),
        },
        cashFlow: {
            income: round2(digest.cashFlow.income),
            expenses: round2(digest.cashFlow.expenses),
            savingsRate: round2(digest.cashFlow.savingsRate),
        },
        topCategories: digest.topCategories.slice(0, MAX_NARRATIVE_CATEGORIES).map(c => ({
            name: c.name.slice(0, 60),
            amount: round2(c.amount),
            delta: round2(c.delta),
            percent: round2(c.percent),
        })),
        subscriptions: {
            new: digest.subscriptions.new.slice(0, MAX_NARRATIVE_SUBSCRIPTIONS).map(s => ({
                label: s.label.slice(0, 60),
                amount: round2(s.currentAmount),
            })),
            changed: digest.subscriptions.changed.slice(0, MAX_NARRATIVE_SUBSCRIPTIONS).map(s => ({
                label: s.label.slice(0, 60),
                amount: round2(s.currentAmount),
                changePercent: round2(s.changePercent),
            })),
            stopped: digest.subscriptions.stopped.slice(0, MAX_NARRATIVE_SUBSCRIPTIONS).map(s => ({
                label: s.label.slice(0, 60),
                amount: round2(s.currentAmount),
            })),
        },
        budget: digest.budget
            ? {
                name: digest.budget.budgetName.slice(0, 60),
                overCount: digest.budget.rows.filter(r => r.status === 'over').length,
                underCount: digest.budget.rows.filter(r => r.status === 'under').length,
                totalBudgeted: round2(digest.budget.totalBudgeted),
                totalActual: round2(digest.budget.totalActual),
            }
            : null,
    };
}

/** The privacy helpers summarisation needs (a GatedAi satisfies it). */
export type NarrativePrivacy = Pick<GatedAi, 'level' | 'token' | 'unmask'>;

/**
 * The payload as a summary-mode model may see it: category and subscription
 * names as tokens, money rounded, percentages and counts kept, the month as
 * YYYY-MM and the budget unnamed. Pure.
 *
 * Listed field by field, no spread: a new NarrativePayload field fails the
 * type check here until someone decides how to summarise it.
 */
export function summarizeNarrativePayload(
    p: NarrativePayload,
    month: string,
    token: NarrativePrivacy['token'],
): NarrativePayload {
    const r = roundMoney;
    return {
        month,
        currency: p.currency,
        netWorth: { end: r(p.netWorth.end), change: r(p.netWorth.change), changePercent: p.netWorth.changePercent },
        cashFlow: { income: r(p.cashFlow.income), expenses: r(p.cashFlow.expenses), savingsRate: p.cashFlow.savingsRate },
        topCategories: p.topCategories.map(c => ({
            name: token('Account', c.name),
            amount: r(c.amount),
            delta: r(c.delta),
            percent: c.percent,
        })),
        subscriptions: {
            new: p.subscriptions.new.map(s => ({ label: token('Merchant', s.label), amount: r(s.amount) })),
            changed: p.subscriptions.changed.map(s => ({
                label: token('Merchant', s.label),
                amount: r(s.amount),
                changePercent: s.changePercent,
            })),
            stopped: p.subscriptions.stopped.map(s => ({ label: token('Merchant', s.label), amount: r(s.amount) })),
        },
        budget: p.budget
            ? {
                name: 'your budget',
                overCount: p.budget.overCount,
                underCount: p.budget.underCount,
                totalBudgeted: r(p.budget.totalBudgeted),
                totalActual: r(p.budget.totalActual),
            }
            : null,
    };
}

/** The payload the model gets at a given privacy level. Pure. */
export function narrativePayloadFor(digest: MonthlyDigest, privacy?: NarrativePrivacy): NarrativePayload {
    const payload = buildNarrativePayload(digest);
    return privacy && privacy.level === 'summary'
        ? summarizeNarrativePayload(payload, digest.month, privacy.token)
        : payload;
}

/** Build the chat messages for the narrative call. Pure. */
export function buildNarrativeMessages(
    digest: MonthlyDigest,
    payload: NarrativePayload = buildNarrativePayload(digest),
    summary = false,
): AiChatMessage[] {
    const system = [
        'You write a short narrative summary of a personal monthly financial digest.',
        'Rules:',
        '- 3 to 5 sentences, plain prose, no markdown, no bullet points.',
        '- Strictly factual: every number must come from the provided data. Do not invent figures.',
        '- Quote amounts and percentages exactly as given; do not add, subtract or derive new ones (the reply is checked).',
        '- No advice, no hype, no exclamation marks, no second-person coaching ("you should...").',
        '- Mention the net worth change, the cash-flow picture, and the most notable category or subscription movement.',
        `- Amounts are in ${payload.currency}.`,
        ...(summary ? ['', SUMMARY_PROMPT_NOTE] : []),
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

/**
 * Validate/normalize a model reply into a usable narrative string.
 * Returns null when the reply is empty, JSON-ish, or absurdly long. Pure.
 */
export function sanitizeNarrative(raw: string): string | null {
    if (typeof raw !== 'string') return null;
    const text = raw
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    if (!text) return null;
    // A JSON blob or markdown heading means the model ignored instructions.
    if (text.startsWith('{') || text.startsWith('[') || text.startsWith('#')) return null;
    if (text.length > MAX_NARRATIVE_LENGTH) return text.slice(0, MAX_NARRATIVE_LENGTH).trim();
    return text;
}

/**
 * Generate the digest narrative via the provided chat client.
 * Returns { narrative } on success, null on ANY failure (bad reply, network
 * error, timeout, a figure the payload does not back) — never throws.
 *
 * @param privacy the gated session's helpers; omitted means full detail.
 */
export async function generateDigestNarrative(
    digestData: MonthlyDigest,
    aiClient: NarrativeAiClient,
    privacy?: NarrativePrivacy,
): Promise<{ narrative: string } | null> {
    try {
        const summary = privacy?.level === 'summary';
        const payload = narrativePayloadFor(digestData, privacy);
        const reply = await aiClient(buildNarrativeMessages(digestData, payload, summary));
        const narrative = sanitizeNarrative(reply);
        if (!narrative) return null;
        // Known numbers are exactly what was sent (after summary rounding).
        const bad = unsupportedFigures(narrative, collectKnownNumbers(payload));
        if (bad.length > 0) {
            warnUnsupported('digest-narrative', bad);
            return null;
        }
        return { narrative: privacy ? privacy.unmask(narrative) : narrative };
    } catch {
        return null;
    }
}

/**
 * The digest narrative through the AI privacy gate. Null when AI is not
 * configured, the user's mode is off, or anything fails. Never throws.
 */
export async function generateGatedDigestNarrative(
    digestData: MonthlyDigest,
    opts: { userId: number; bookGuid: string },
): Promise<{ narrative: string } | null> {
    try {
        const { openGatedAi } = await import('@/lib/ai-privacy/gate');
        const { getAccountGuidsForBook } = await import('@/lib/book-scope');
        const gate = await openGatedAi({
            userId: opts.userId,
            path: 'digest-narrative',
            accountGuids: () => getAccountGuidsForBook(opts.bookGuid),
        });
        if (!gate.ok) return null;
        const { ai } = gate;
        return await generateDigestNarrative(
            digestData,
            messages => ai.chat(messages, { maxTokens: 500, timeoutMs: 20000 }),
            ai,
        );
    } catch (error) {
        console.error('Digest: narrative generation failed:', error);
        return null;
    }
}
