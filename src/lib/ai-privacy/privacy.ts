// src/lib/ai-privacy/privacy.ts

/**
 * "AI and your data": what an analysis model may see.
 *
 * Three modes, chosen per user in Settings → AI:
 *   off      no model call at all on the gated analysis paths
 *   summary  the default: names become placeholder tokens, money is rounded,
 *            dates become YYYY-MM
 *   full     full detail, but ONLY for an endpoint the user marked as running on
 *            their own hardware. A cloud endpoint always gets the summary.
 *
 * Document extraction (receipts, payslips, statements, documents) is exempt and
 * never goes through this module; see ./registry.ts.
 *
 * Pure: no server imports, so the settings UI can use the mode copy and the
 * self-hosted heuristic, and tests can run it directly. The names map built here
 * lives in server memory only (./gate.ts); it is never persisted or logged.
 */

import { replaceMoneyFigures } from './number-check';

export type PrivacyMode = 'off' | 'summary' | 'full';
/** What one model call gets: nothing, a summary, or full detail. */
export type PrivacyLevel = 'off' | 'summary' | 'full';

export const PRIVACY_MODES: readonly PrivacyMode[] = ['off', 'summary', 'full'];
export const DEFAULT_PRIVACY_MODE: PrivacyMode = 'summary';

export const PRIVACY_MODE_OPTIONS: ReadonlyArray<{ value: PrivacyMode; label: string; what: string }> = [
    { value: 'off', label: 'Off', what: 'No AI analysis. Ask your books, the digest summary and insight rewording stay off.' },
    { value: 'summary', label: 'Summary only', what: 'The model gets rounded amounts, months instead of dates, and placeholders instead of names.' },
    { value: 'full', label: 'Full detail on my own hardware', what: 'An endpoint on your own hardware gets full detail. Any other endpoint still gets the summary only.' },
];

/** Summary only is the default for everyone, including configs saved before the setting existed. */
export function parsePrivacyMode(value: unknown): PrivacyMode {
    return value === 'off' || value === 'full' ? value : 'summary';
}

/* ------------------------------------------------------------------ */
/* Self-hosted endpoint detection                                      */
/* ------------------------------------------------------------------ */

/** Hosted AI providers. Never treated as self-hosted, whatever the checkbox says. */
const KNOWN_CLOUD_SUFFIXES = [
    'openai.com', 'anthropic.com', 'openrouter.ai', 'googleapis.com', 'groq.com',
    'together.xyz', 'together.ai', 'mistral.ai', 'deepseek.com', 'x.ai', 'azure.com',
    'cohere.ai', 'cohere.com', 'fireworks.ai', 'perplexity.ai', 'deepinfra.com',
    'amazonaws.com', 'cerebras.ai', 'novita.ai', 'huggingface.co',
];

function hostOf(baseUrl: string | null | undefined): string | null {
    if (!baseUrl || typeof baseUrl !== 'string') return null;
    const raw = baseUrl.trim();
    if (!raw) return null;
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
        return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    } catch {
        return null;
    }
}

function ipv4(host: string): number[] | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every(p => p >= 0 && p <= 255) ? parts : null;
}

/** True for a hosted AI provider's address (api.openai.com, openrouter.ai, ...). */
export function isKnownCloudEndpoint(baseUrl: string | null | undefined): boolean {
    const host = hostOf(baseUrl);
    if (!host) return false;
    return KNOWN_CLOUD_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`));
}

/**
 * A guess at whether an endpoint runs on the user's own hardware, from its
 * address alone: localhost, loopback, private and CGNAT ranges, .local / .lan /
 * .internal / .home.arpa names, and single-label names such as `ollama:11434`.
 * Only a suggestion for the settings checkbox; the stored flag is the user's.
 */
export function isLikelySelfHostedUrl(baseUrl: string | null | undefined): boolean {
    const host = hostOf(baseUrl);
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    const v4 = ipv4(host);
    if (v4) {
        const [a, b] = v4;
        return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254) || (a === 0 && v4.every(p => p === 0));
    }
    if (host.includes(':')) {
        // IPv6: loopback, unique-local fc00::/7, link-local fe80::/10.
        return host === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
    }
    if (['.local', '.lan', '.internal', '.home.arpa', '.localdomain'].some(s => host.endsWith(s))) return true;
    return !host.includes('.');
}

/**
 * The level one model call gets. `full` only when the user chose it AND marked
 * the endpoint as their own hardware AND the address is not a known cloud
 * provider. Everything else that is not `off` is `summary`.
 */
export function levelFor(mode: PrivacyMode, selfHosted: boolean, baseUrl?: string | null): PrivacyLevel {
    if (mode === 'off') return 'off';
    if (mode === 'full' && selfHosted && !isKnownCloudEndpoint(baseUrl)) return 'full';
    return 'summary';
}

/* ------------------------------------------------------------------ */
/* Rounding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Under 100 to the nearest 5, 100 to 1,000 to the nearest 10, above 1,000 to
 * the nearest 100. Never rounds a real amount down to zero.
 */
export function roundMoney(n: number): number {
    const a = Math.abs(n);
    if (!Number.isFinite(n) || a === 0) return 0;
    const step = a < 100 ? 5 : a < 1000 ? 10 : 100;
    return Math.round(n / step) * step || Math.sign(n) * step;
}

/** YYYY-MM from a date-ish value. */
export function toMonth(d: string | Date | null | undefined): string | null {
    if (!d) return null;
    if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
    const iso = /^(\d{4})-(\d{2})/.exec(d);
    return iso ? `${iso[1]}-${iso[2]}` : null;
}

/* ------------------------------------------------------------------ */
/* Placeholder tokens                                                  */
/* ------------------------------------------------------------------ */

// Tokens, not words: a model shortens "Merchant 1, 2 and 3" to "Merchants 1 and
// 3", but it writes a bracketed token out whole.
export type TokenKind = 'Merchant' | 'Account' | 'Holding' | 'Vendor';

export interface Names {
    /** lower-cased, whitespace-collapsed real name -> token */
    fwd: Map<string, string>;
    /** token -> real name as first seen */
    back: Map<string, string>;
    n: Record<TokenKind, number>;
    /** Bumped on every new token so the mask regex can be cached. */
    version: number;
}

const LETTER: Record<TokenKind, string> = { Merchant: 'M', Account: 'A', Holding: 'H', Vendor: 'V' };
/** What an unknown token reads as, so a stray one never reaches the screen. */
const GENERIC: Record<string, string> = { M: 'a merchant', A: 'an account', H: 'a holding', V: 'a vendor' };

export function newNames(): Names {
    return { fwd: new Map(), back: new Map(), n: { Merchant: 0, Account: 0, Holding: 0, Vendor: 0 }, version: 0 };
}

const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The placeholder for a real name, made on first sight. A name keeps its first placeholder whatever kind asks later. */
export function ph(names: Names, kind: TokenKind, real: string | null | undefined): string {
    if (typeof real !== 'string' || !real.trim()) return `unnamed ${kind.toLowerCase()}`;
    const k = key(real);
    const had = names.fwd.get(k);
    if (had) return had;
    const token = `⟨${LETTER[kind]}${++names.n[kind]}⟩`;
    names.fwd.set(k, token);
    names.back.set(token, real.trim());
    names.version++;
    return token;
}

/** True for text that is already a token. */
export const isToken = (s: string) => /^⟨[MAHV]\d+⟩$/.test(s);

// Bank events are not companies: "Interest charged" or "Transfer" get no
// placeholder, because masking a common word would mangle every sentence that
// uses it ("my mortgage payment" -> "my mortgage ⟨M7⟩").
const BANK_EVENT = /\b(interest|intrst|dividends?|fees?|overdraft|nsf|transfers?|payments?|autopay|deposits?|withdrawals?|refunds?|taxes|tax|paycheck|payroll|salary|opening balance|balance)\b/i;
/** True for a description that names a bank event, not a merchant. */
export function isBankEvent(name: string | null | undefined): boolean {
    return typeof name === 'string' && BANK_EVENT.test(name) && name.trim().split(/\s+/).length <= 3;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const maskCache = new WeakMap<Names, { version: number; re: RegExp | null }>();

function maskRegex(names: Names): RegExp | null {
    const hit = maskCache.get(names);
    if (hit && hit.version === names.version) return hit.re;
    const reals = [...names.fwd.keys()].filter(r => r.length >= 3).sort((a, b) => b.length - a.length);
    const re = reals.length
        ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${reals.map(r => esc(r).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
        : null;
    maskCache.set(names, { version: names.version, re });
    return re;
}

/** Real names (3+ characters) to placeholders, longest first. For text going to a model. */
export function mask(text: string, names: Names): string {
    if (typeof text !== 'string' || !text) return text;
    const re = maskRegex(names);
    if (!re) return text;
    re.lastIndex = 0;
    return text.replace(re, m => names.fwd.get(key(m)) ?? m);
}

const ISO_DATE = /\b(\d{4})-(\d{2})-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const US_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

/** Dates in free text to YYYY-MM. */
export function scrubDates(text: string): string {
    return text
        .replace(ISO_DATE, (_m, y: string, mo: string) => `${y}-${mo}`)
        .replace(US_DATE, (_m, mo: string, _d: string, y: string) => `${y}-${mo.padStart(2, '0')}`);
}

/** Every money figure in free text rounded with roundMoney ("about" added when the value moved). */
export function roundMoneyInText(text: string): string {
    return replaceMoneyFigures(text, f => {
        const rounded = roundMoney(f.value);
        const n = rounded.toLocaleString('en-US');
        const money = !f.currency ? n : /^[A-Z]{3}$/.test(f.currency) ? `${f.currency} ${n}` : `${f.currency}${n}`;
        const signed = f.signed < 0 ? `-${money}` : money;
        return rounded === f.value && !f.scaled ? signed : `about ${signed}`;
    });
}

/** mask(), plus every money amount rounded and every date reduced to YYYY-MM. For free text going to a model. */
export function scrubText(text: string, names: Names): string {
    if (typeof text !== 'string' || !text) return text;
    return roundMoneyInText(scrubDates(mask(text, names)));
}

// A token, or several in one bracket ("⟨M1, M3⟩", "⟨M1 and 3⟩"). Unicode angle
// brackets always; ASCII "<M1>" only when the token is known.
const TOKEN = /([⟨〈‹<])\s*([MAHV]\s*\d+(?:\s*(?:,|&|\band\b|\bor\b)\s*(?:[MAHV]\s*)?\d+)*)\s*([⟩〉›>])/g;
const STRAY = /[⟨〈]\s*([MAHV])\s*\d+\s*[⟩〉]?/g;

function swapTokens(text: string, names: Names): string {
    return text.replace(TOKEN, (all, open: string, body: string) => {
        let letter = '';
        let unknownAscii = false;
        const out = body.replace(/([MAHV]\s*)?(\d+)/g, (_m, l: string | undefined, d: string) => {
            letter = l?.trim() ?? letter;
            const real = names.back.get(`⟨${letter}${d}⟩`);
            if (real) return real;
            if (open === '<') unknownAscii = true;
            return GENERIC[letter] ?? 'an item';
        });
        return unknownAscii ? all : out;
    }).replace(STRAY, (_m, l: string) => GENERIC[l] ?? 'an item');
}

// "Groceries (Groceries)": a name repeated in brackets right after itself. Drops the bracket.
function dedupe(text: string): string {
    return text.replace(/[ \t]\(([^()\n]{1,80})\)/g, (all, inner: string, at: number) => {
        const words = inner.trim().split(/\s+/).length;
        const prior = text.slice(0, at).split(/\s+/).filter(Boolean).slice(-words).join(' ').replace(/^[^\p{L}\p{N}]+/u, '');
        return prior.toLowerCase() === inner.trim().toLowerCase() ? '' : all;
    });
}

/**
 * Placeholders back to real names. Runs on the server before a reply reaches
 * the user. Tolerates mangled tokens; an unknown token becomes a generic phrase.
 */
export function unmask(text: string, names: Names): string {
    if (typeof text !== 'string' || !text) return text;
    return dedupe(swapTokens(text, names));
}

/* ------------------------------------------------------------------ */
/* SQL: tokens back to real names, safely quoted                       */
/* ------------------------------------------------------------------ */

const SQL_TOKEN = /[⟨〈]\s*([MAHV])\s*(\d+)\s*[⟩〉]/g;
const sqlEscape = (s: string) => s.replace(/'/g, "''");

/**
 * Replace tokens in model-written SQL with the real names BEFORE guardrail
 * validation. Inside a single-quoted literal the name is spliced in with quotes
 * doubled; outside one the token becomes a quoted literal of its own. Either
 * way no real name can break out of a string literal. Unknown tokens are left
 * alone (the guardrails or the query then reject or match nothing).
 */
export function unmaskSql(sql: string, names: Names): string {
    if (typeof sql !== 'string' || !sql) return sql;
    let out = '';
    let i = 0;
    let inLiteral = false;
    let segStart = 0;
    const flush = (end: number) => {
        const seg = sql.slice(segStart, end);
        out += seg.replace(SQL_TOKEN, (all, l: string, d: string) => {
            const real = names.back.get(`⟨${l}${d}⟩`);
            if (real === undefined) return all;
            return inLiteral ? sqlEscape(real) : `'${sqlEscape(real)}'`;
        });
        segStart = end;
    };
    while (i < sql.length) {
        if (sql[i] === "'") {
            if (inLiteral && sql[i + 1] === "'") {
                i += 2; // escaped quote inside a literal
                continue;
            }
            flush(i);
            inLiteral = !inLiteral;
            out += "'";
            i += 1;
            segStart = i;
            continue;
        }
        i += 1;
    }
    flush(sql.length);
    return out;
}

/* ------------------------------------------------------------------ */
/* Result rows                                                         */
/* ------------------------------------------------------------------ */

const GUID = /^[0-9a-f]{32}$/i;
const ENUM_LIKE = /^[A-Z][A-Z0-9_]{1,24}$/;
/** GnuCash account types: safe to show, and the model needs them. */
const ACCOUNT_TYPES = new Set([
    'ASSET', 'BANK', 'CASH', 'CREDIT', 'LIABILITY', 'STOCK', 'MUTUAL', 'CURRENCY', 'INCOME', 'EXPENSE',
    'EQUITY', 'RECEIVABLE', 'PAYABLE', 'ROOT', 'TRADING',
]);
/** Columns whose all-caps values are codes, not names (an all-caps description like "COSTCO" is a name). */
const ENUM_COLUMN_WORDS = new Set([
    'type', 'kind', 'currency', 'status', 'state', 'code', 'namespace', 'flag', 'reconcile', 'reconciled',
    'cadence', 'frequency', 'sign', 'direction',
]);
function isEnumValue(column: string, s: string): boolean {
    if (!ENUM_LIKE.test(s)) return false;
    if (ACCOUNT_TYPES.has(s)) return true;
    return wordsOf(column).some(w => ENUM_COLUMN_WORDS.has(w));
}
const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;
const DATE_STRING = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const PCT_WORDS = new Set(['pct', 'percent', 'percentage', 'ratio', 'rate', 'share']);
const MONEY_WORDS = new Set([
    'amount', 'amt', 'total', 'sum', 'balance', 'bal', 'value', 'val', 'spend', 'spent', 'spending',
    'income', 'expense', 'expenses', 'cost', 'costs', 'price', 'net', 'avg', 'average', 'mean', 'paid',
    'payment', 'payments', 'gain', 'gains', 'loss', 'losses', 'budget', 'budgeted', 'actual', 'debit',
    'credit', 'monthly', 'yearly', 'annual', 'max', 'min', 'median', 'outflow', 'inflow', 'revenue',
    'profit', 'worth', 'quantity', 'qty', 'shares', 'principal', 'interest', 'fee', 'fees', 'deposit',
    'deposits', 'withdrawal', 'withdrawals', 'contribution', 'contributions', 'basis', 'proceeds',
]);
const KEEP_WORDS = new Set([
    'count', 'cnt', 'n', 'num', 'number', 'year', 'yr', 'month', 'mon', 'day', 'days', 'week', 'weeks',
    'months', 'years', 'quarter', 'qtr', 'rank', 'depth', 'level', 'age', 'period', 'dow', 'hour',
    'transactions', 'txns', 'occurrences', 'times', 'splits', 'accounts', 'id',
]);

function wordsOf(column: string): string[] {
    return column
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** How a numeric column is summarised: kept (counts, percentages, years) or rounded (money). */
export function numericColumnTreatment(column: string): 'keep' | 'round' {
    const words = wordsOf(column);
    if (words.some(w => PCT_WORDS.has(w))) return 'keep';
    if (words.some(w => MONEY_WORDS.has(w))) return 'round';
    if (words.some(w => KEEP_WORDS.has(w))) return 'keep';
    return 'round';
}

/** The token kind for a text column, from its name. */
export function textColumnKind(column: string): TokenKind {
    const words = wordsOf(column);
    if (words.some(w => ['account', 'accounts', 'acct', 'fullname', 'category', 'categories', 'parent', 'bucket'].includes(w))) return 'Account';
    if (words.some(w => ['commodity', 'mnemonic', 'security', 'holding', 'ticker', 'symbol', 'stock', 'fund', 'cusip'].includes(w))) return 'Holding';
    if (words.some(w => ['vendor', 'customer', 'client', 'supplier', 'employer'].includes(w))) return 'Vendor';
    return 'Merchant';
}

function scrubValue(column: string, v: unknown, names: Names, depth: number): unknown {
    if (v === null || v === undefined || typeof v === 'boolean') return v;
    if (v instanceof Date) return toMonth(v);
    if (typeof v === 'bigint') v = Number(v);
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return v;
        return numericColumnTreatment(column) === 'keep' ? v : roundMoney(v);
    }
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return v;
        if (GUID.test(s)) return v; // opaque; needed for drill-down links
        if (NUMERIC_STRING.test(s)) return scrubValue(column, Number(s), names, depth);
        if (DATE_STRING.test(s)) return toMonth(s);
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        if (s.length === 1 || isEnumValue(column, s)) return v; // EXPENSE, a currency code, reconcile flags
        if (isToken(s)) return s;
        return ph(names, textColumnKind(column), s);
    }
    if (typeof v === 'object') {
        const maybe = v as { toNumber?: () => number };
        if (typeof maybe.toNumber === 'function') return scrubValue(column, maybe.toNumber(), names, depth);
        if (depth > 6) return null;
        if (Array.isArray(v)) return v.map(item => scrubValue(column, item, names, depth + 1));
        const out: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) out[k] = scrubValue(k, item, names, depth + 1);
        return out;
    }
    return null;
}

/**
 * Result rows as a summary-mode model may see them: text columns become tokens,
 * money columns are rounded, count/percent/year-like columns are kept, dates
 * become YYYY-MM, 32-hex GUIDs are kept (opaque, and needed for drill-down
 * links). Column names are the model's own aliases and are kept.
 */
export function scrubRows(rows: ReadonlyArray<Record<string, unknown>>, names: Names): Record<string, unknown>[] {
    return rows.map(row => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = scrubValue(k, v, names, 0);
        return out;
    });
}

/* ------------------------------------------------------------------ */
/* Prompt note                                                         */
/* ------------------------------------------------------------------ */

export const SUMMARY_PROMPT_NOTE = [
    'Privacy: the user chose summary mode.',
    'Names are placeholder tokens: ⟨M1⟩ a merchant or payee, ⟨A1⟩ an account or category, ⟨H1⟩ a holding, ⟨V1⟩ a vendor or customer.',
    'Folio swaps the real names back in before the user sees your reply, so never guess a real name.',
    '- Copy each token exactly, brackets included, every time you mean it. In a list write every token in full: "⟨M1⟩, ⟨M2⟩ and ⟨M3⟩".',
    "- Write a token once. Don't repeat its type or a name in brackets after it.",
    "- Amounts are rounded and dates are reduced to months. Say amounts are about, and don't claim more precision than you have.",
].join('\n');
