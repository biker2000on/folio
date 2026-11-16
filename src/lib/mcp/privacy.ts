/**
 * Summary-mode scrubbing for MCP tool results and inputs. Pure: no database,
 * unit-tested directly. ./shape.ts decides the level (through the AI privacy
 * gate) and calls these.
 *
 * An MCP client is an external cloud model. In summary mode it sees:
 *   - account paths with each segment tokenised ("Expenses:⟨A2⟩:⟨A3⟩"; generic
 *     top-level names stay), payees/descriptions/memos as ⟨M…⟩, holdings as ⟨H…⟩
 *   - money rounded with the gate's roundMoney; counts and percentages kept
 *   - dates as YYYY-MM; month keys kept; 32-hex GUIDs kept (opaque ids)
 *   - Folio's own explanatory strings (sign conventions, notes) verbatim, and
 *     free-text fields (warnings, action titles) scrubbed in place
 * It can pass any token back as a tool argument; unmaskToolArgs swaps exact
 * tokens for the real names before the tool runs.
 */

import {
    isToken,
    numericColumnTreatment,
    ph,
    roundMoney,
    scrubText,
    textColumnKind,
    toMonth,
    tokenizeAccountPath,
    unmaskStrict,
    type Names,
    type TokenKind,
} from '@/lib/ai-privacy/privacy';

/** Folio-authored explanations and period labels ("Jan 2026"): no user data, kept as written. */
const VERBATIM_KEYS = new Set(['signConvention', 'note', 'scope', 'label']);
/** Free text that may name an account or payee mid-sentence: scrubbed in place. */
const PROSE_KEYS = new Set(['title', 'summary', 'warnings', 'valuationWarnings', 'message', 'detail', 'reason']);
/** Counts, scores and fractions: plain numbers, never rounded like money. */
const COUNT_KEYS = new Set([
    'totalMatching', 'totalCategories', 'totalHoldings', 'totalItems', 'totalOccurrences', 'totalLines',
    'includedAccounts', 'activeCount', 'priceIncreaseCount', 'occurrences', 'accounts', 'unpricedHoldings',
    'periodNum', 'gaps', 'elapsedFraction',
    // action_center_items: weekly counts and a 0..1 confidence
    'new', 'resolved', 'automated', 'overdue', 'confidence',
]);
/** Short code values (types, states, cadences): kept. */
const ENUM_KEYS = new Set([
    'type', 'lane', 'severity', 'state', 'cadence', 'status', 'pace', 'period', 'confidence', 'reconciled',
    'currency', 'reportCurrency', 'commodityNamespace', 'kind',
]);
/** Account references: tokenised segment by segment. */
const ACCOUNT_PATH_KEYS = new Set(['path', 'account', 'category']);
/** Token kinds for other name-bearing keys. */
const KIND_BY_KEY: Readonly<Record<string, TokenKind>> = {
    budget: 'Account',
    otherBudgets: 'Account',
    merchant: 'Merchant',
    description: 'Merchant',
    memo: 'Merchant',
    name: 'Merchant',
    symbol: 'Holding',
    commodity: 'Holding',
};

const GUID = /^[0-9a-f]{32}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTH = /^\d{4}-\d{2}$/;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const MAX_DEPTH = 12;

function scrubNumber(key: string, n: number): number {
    if (!Number.isFinite(n)) return n;
    if (COUNT_KEYS.has(key)) return n;
    return numericColumnTreatment(key) === 'keep' ? n : roundMoney(n);
}

function scrubString(key: string, s: string, names: Names): string | number {
    const t = s.trim();
    if (!t) return s;
    if (VERBATIM_KEYS.has(key)) return s;
    if (GUID.test(t)) return s;
    if (ISO_DATE.test(t)) return toMonth(t) ?? s;
    if (MONTH.test(t)) return s;
    if (isToken(t)) return t;
    if (ENUM_KEYS.has(key)) return s;
    if (PROSE_KEYS.has(key)) return scrubText(s, names);
    if (NUMERIC.test(t)) return scrubNumber(key, Number(t));
    if (t.length === 1) return s;
    if (ACCOUNT_PATH_KEYS.has(key)) return tokenizeAccountPath(names, t);
    // A currency code in a commodity column is not a holding; the book's own
    // securities are in the names map already (as Holding tokens) and stay tokens.
    // An ACCOUNT that happens to be named "USD" must not turn the currency into
    // that account's token, so only a Holding token counts here.
    if (KIND_BY_KEY[key] === 'Holding' && CURRENCY_CODE.test(t) && !names.fwd.get(t.toLowerCase())?.startsWith('⟨H')) return s;
    return ph(names, KIND_BY_KEY[key] ?? textColumnKind(key), t);
}

function scrubValue(key: string, v: unknown, names: Names, depth: number): unknown {
    if (v === null || v === undefined || typeof v === 'boolean') return v;
    if (typeof v === 'number') return scrubNumber(key, v);
    if (typeof v === 'bigint') return scrubNumber(key, Number(v));
    if (typeof v === 'string') return scrubString(key, v, names);
    if (v instanceof Date) return toMonth(v);
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(v)) return v.map(item => scrubValue(key, item, names, depth + 1));
    if (typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) out[k] = scrubValue(k, item, names, depth + 1);
        return out;
    }
    return null;
}

/** A tool result as a summary-level MCP client may see it. Pure. */
export function scrubMcpResult(result: unknown, names: Names): unknown {
    return scrubValue('', result, names, 0);
}

/** Free text (a tool error) for a summary-level client: names masked, money rounded, dates to months. */
export function scrubMcpText(text: string, names: Names): string {
    return scrubText(text, names);
}

/**
 * Tool arguments with every exact token swapped for its real name, so the
 * model can drill into "⟨M3⟩" or "Expenses:⟨A2⟩". Unknown tokens are reported
 * (and left in place) so the caller can refuse rather than search for them.
 */
export function unmaskToolArgs(args: unknown, names: Names): { args: unknown; unknown: string[] } {
    const unknown: string[] = [];
    const walk = (v: unknown, depth: number): unknown => {
        if (typeof v === 'string') {
            const r = unmaskStrict(v, names);
            unknown.push(...r.unknown);
            return r.text;
        }
        if (depth > MAX_DEPTH || v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(item => walk(item, depth + 1));
        const out: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) out[k] = walk(item, depth + 1);
        return out;
    };
    return { args: walk(args, 0), unknown: [...new Set(unknown)] };
}
