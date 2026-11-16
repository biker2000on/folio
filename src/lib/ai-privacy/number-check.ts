// src/lib/ai-privacy/number-check.ts

/**
 * Code-verified AI numbers.
 *
 * A model may round a figure the code gave it ("about $3,300" for $3,323), but it
 * may never bring a new one. This module pulls every currency figure and every
 * percentage out of model text and checks each against the numbers the code
 * actually sent to the model. Plain counts, years and days are not checked:
 * they carry no currency or percent marker.
 *
 * Tolerances (absolute values are compared, so a sign flip is not a failure):
 *   money:   within 5% relative or $1 absolute
 *   percent: within 0.5 points or 5% relative
 *
 * Pure: no imports, safe for client and server.
 */

export type FigureKind = 'money' | 'percent';

export interface Figure {
    kind: FigureKind;
    /** Absolute value, with k/M/B suffixes applied. */
    value: number;
    /** Signed value as written (negative for "-$5" or "($5)"). */
    signed: number;
    /** The matched text. */
    raw: string;
    index: number;
    /** Currency prefix/suffix as written ("$", "USD"), '' for bare k/M figures. */
    currency: string;
    /** True when the figure was written with a k/M/B/thousand/million suffix. */
    scaled: boolean;
}

export const MONEY_RELATIVE_TOLERANCE = 0.05;
export const MONEY_ABSOLUTE_TOLERANCE = 1;
export const PERCENT_RELATIVE_TOLERANCE = 0.05;
export const PERCENT_ABSOLUTE_TOLERANCE = 0.5;

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?`;
const CURRENCY_PREFIX = String.raw`US\$|CA\$|C\$|A\$|AU\$|NZ\$|[$£€¥]|(?:USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY)\s?`;
const CODE_SUFFIX = String.raw`USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY`;
const SCALE_WITH_CURRENCY = String.raw`(?:\s?(k|K|mm|MM|m|M|bn|b|B|thousand|million|billion)(?![A-Za-z]))?`;

/** "$1,234.56", "-$5", "($5)", "$3.3k", "USD 1,200", "$1.2 million". */
const MONEY_PREFIXED = new RegExp(
    String.raw`(\()?(?:([-−–])\s?)?(${CURRENCY_PREFIX})\s?([-−–])?${NUM}${SCALE_WITH_CURRENCY}(\))?`,
    'g',
);
/** "1,234.56 USD". */
const MONEY_CODE_SUFFIX = new RegExp(String.raw`(\()?([-−–])?${NUM}\s?(${CODE_SUFFIX})\b(\))?`, 'g');
/** Bare scaled figures with no currency marker: "3.3k", "1.2M", "2 million". */
const MONEY_BARE_SCALED = new RegExp(
    String.raw`(?<![\w.,$£€¥])([-−–])?(\d+(?:\.\d+)?)(?:(k|K|M|bn)(?![A-Za-z])|\s(thousand|million|billion)\b)`,
    'g',
);
/** "12%", "12.5 percent", "3 percentage points", "-4 pct". */
const PERCENT = new RegExp(
    String.raw`(?<![\w.])([-−–+])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|percent\b|per cent\b|percentage points?\b|pct\b)`,
    'gi',
);

function scaleOf(s: string | undefined): number {
    if (!s) return 1;
    const t = s.toLowerCase();
    if (t === 'k' || t === 'thousand') return 1e3;
    if (t === 'm' || t === 'mm' || t === 'million') return 1e6;
    if (t === 'b' || t === 'bn' || t === 'billion') return 1e9;
    return 1;
}

function toNumber(intPart: string, frac: string | undefined): number {
    return Number(intPart.replace(/,/g, '') + (frac ?? ''));
}

interface Hit extends Figure {
    end: number;
}

function collect(text: string): Hit[] {
    const hits: Hit[] = [];
    for (const m of text.matchAll(MONEY_PREFIXED)) {
        const [raw, open, sign1, currency, sign2, intPart, frac, scale, close] = m;
        const value = toNumber(intPart, frac) * scaleOf(scale);
        const negative = !!(sign1 || sign2 || (open && close));
        // A lone "(" or ")" belongs to the surrounding prose, not the figure.
        let start = m.index!;
        let text0 = raw;
        if (open && !close) { start += 1; text0 = text0.slice(1); }
        if (close && !open) text0 = text0.slice(0, -1);
        hits.push({
            kind: 'money', value, signed: negative ? -value : value, raw: text0, index: start,
            end: start + text0.length, currency: currency.trim(), scaled: !!scale,
        });
    }
    for (const m of text.matchAll(MONEY_CODE_SUFFIX)) {
        const [raw, open, sign, intPart, frac, code, close] = m;
        const value = toNumber(intPart, frac);
        const negative = !!(sign || (open && close));
        let start = m.index!;
        let text0 = raw;
        if (open && !close) { start += 1; text0 = text0.slice(1); }
        if (close && !open) text0 = text0.slice(0, -1);
        hits.push({
            kind: 'money', value, signed: negative ? -value : value, raw: text0, index: start,
            end: start + text0.length, currency: code, scaled: false,
        });
    }
    for (const m of text.matchAll(MONEY_BARE_SCALED)) {
        const [raw, sign, n, short, word] = m;
        const value = Number(n) * scaleOf(short ?? word);
        hits.push({
            kind: 'money', value, signed: sign ? -value : value, raw, index: m.index!,
            end: m.index! + raw.length, currency: '', scaled: true,
        });
    }
    for (const m of text.matchAll(PERCENT)) {
        const [raw, sign, intPart, frac] = m;
        const value = toNumber(intPart, frac);
        const negative = sign === '-' || sign === '−' || sign === '–';
        hits.push({
            kind: 'percent', value, signed: negative ? -value : value, raw, index: m.index!,
            end: m.index! + raw.length, currency: '', scaled: false,
        });
    }
    // Earliest first; at the same start the longest match wins; overlaps drop.
    hits.sort((a, b) => a.index - b.index || b.end - a.end);
    const out: Hit[] = [];
    let lastEnd = -1;
    for (const h of hits) {
        if (h.index < lastEnd) continue;
        out.push(h);
        lastEnd = h.end;
    }
    return out;
}

/** Every currency figure and percentage in `text`, in order. */
export function extractFigures(text: string): Figure[] {
    if (typeof text !== 'string' || !text) return [];
    return collect(text).map(({ end: _end, ...f }) => f);
}

/**
 * Replace every money figure in `text` (same detection as extractFigures) with
 * `fn(figure)`. Used to round amounts in free text going to a model.
 */
export function replaceMoneyFigures(text: string, fn: (f: Figure) => string): string {
    const hits = collect(text).filter(h => h.kind === 'money');
    if (hits.length === 0) return text;
    let out = '';
    let last = 0;
    for (const h of hits) {
        out += text.slice(last, h.index) + fn(h);
        last = h.end;
    }
    return out + text.slice(last);
}

const PLAIN_NUMBER = /(?<![\w.])-?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(k|K|M)?(?![\w])/g;

function pushFromString(s: string, out: number[]): void {
    for (const f of extractFigures(s)) out.push(f.value);
    for (const m of s.matchAll(PLAIN_NUMBER)) {
        const n = toNumber(m[1], m[2]) * scaleOf(m[3]);
        if (Number.isFinite(n)) out.push(Math.abs(n));
    }
}

/**
 * Every number in what was sent to the model: numeric fields, numeric strings,
 * and figures inside text. Walks values only, never object keys. Pass exactly
 * the payload the model saw (after any summary rounding).
 */
export function collectKnownNumbers(...sources: unknown[]): number[] {
    const out: number[] = [];
    const seen = new Set<unknown>();
    const walk = (v: unknown, depth: number): void => {
        if (v === null || v === undefined || depth > 12) return;
        if (typeof v === 'number') {
            if (Number.isFinite(v)) out.push(Math.abs(v));
            return;
        }
        if (typeof v === 'bigint') {
            out.push(Math.abs(Number(v)));
            return;
        }
        if (typeof v === 'string') {
            pushFromString(v, out);
            return;
        }
        if (typeof v !== 'object' || v instanceof Date) return;
        if (seen.has(v)) return;
        seen.add(v);
        // Prisma Decimal and friends.
        const maybe = v as { toNumber?: () => number };
        if (typeof maybe.toNumber === 'function') {
            const n = maybe.toNumber();
            if (Number.isFinite(n)) out.push(Math.abs(n));
            return;
        }
        const values = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
        for (const item of values) walk(item, depth + 1);
    };
    for (const s of sources) walk(s, 0);
    return out;
}

/** Whether one figure is backed by some known number. */
export function isFigureSupported(f: Figure, known: readonly number[]): boolean {
    const n = f.value;
    for (const raw of known) {
        const k = Math.abs(raw);
        const tol = f.kind === 'money'
            ? Math.max(MONEY_ABSOLUTE_TOLERANCE, k * MONEY_RELATIVE_TOLERANCE)
            : Math.max(PERCENT_ABSOLUTE_TOLERANCE, k * PERCENT_RELATIVE_TOLERANCE);
        if (Math.abs(n - k) <= tol) return true;
    }
    return false;
}

/** The figures in `text` that no known number backs. Empty means the text passes. */
export function unsupportedFigures(text: string, known: readonly number[]): Figure[] {
    return extractFigures(text).filter(f => !isFigureSupported(f, known));
}

/** True when every currency figure and percentage in `text` is backed by `known`. */
export function figuresSupported(text: string, known: readonly number[]): boolean {
    return unsupportedFigures(text, known).length === 0;
}

/**
 * Log a rejection so thresholds can be tuned later. Logs the path and the
 * offending figures only (numbers, never names or the surrounding text).
 */
export function warnUnsupported(path: string, figures: readonly Figure[]): void {
    console.warn(
        `[ai-privacy] number check rejected model text on ${path}: unsupported ${figures
            .map(f => `${f.kind}=${f.raw.trim()}`)
            .join(', ')}`,
    );
}
