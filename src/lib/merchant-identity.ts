/**
 * Merchant identity.
 *
 * Bank feeds decorate the payee with things that change on every charge: an
 * order code ("AMAZON MKTPL*DL5XR0X03"), a trailing memo ("CALDWELL COUNTY
 * UTILITY~ Future Amount: 46.55 ~ Tran: ACHDW"), a confirmation or invoice
 * number, a phone number, a store number. Matching on the full description
 * therefore sees a brand-new merchant on every bill.
 *
 * Two levels, both pure and client-safe:
 *
 *  - `merchantKey(description)`  the grouping key: the payee with processor
 *    prefixes, memo tails, reference codes and filler words removed, cut to
 *    its first three words.
 *  - `keysMatch` + `MerchantHistory`  the looser "have I paid these people
 *    before?" relation used by first-time-merchant checks. Two descriptions
 *    are the same merchant when their stems (first two words, spaces removed)
 *    are equal or one is a prefix of the other, or when they share a
 *    distinctive first word. So "DUKEENERGY BILL PAY" matches a hand-typed
 *    "Duke Energy", "Rural King 1ton pelletized lime" matches "Rural King",
 *    and "Amazon order - brackets" matches "AMAZON MKTPL*BB14R7WR1".
 *
 * The relation deliberately errs toward "seen before": a missed new-merchant
 * alert costs nothing, a false one trains the reader to ignore the whole feed.
 */

/** Card processors that prefix the real payee: "SQ *BLUE BOTTLE", "PAYPAL *SPOTIFY". */
const PROCESSOR_PREFIX = /^\s*(?:sq|tst|sp|pp|py|paypal|ic|dd|sumup|zettle|clover|toast|fsp|cke)\s*\*\s*/;

/**
 * A labelled reference ("Ref: 8841", "Conf# AB12", "Tran: ACHDW", "Future
 * Amount: 46.55") ends the payee: everything from the label on is memo.
 */
const LABELLED_TAIL = new RegExp(
    '\\b(?:ref(?:erence)?|conf(?:irmation)?|trace|tran(?:s(?:action)?)?|txn|id|inv(?:oice)?|order|'
    + 'acct|account|auth|check|chk|ck|ppd id|web id|future amount|memo|des|indn)\\s*(?:#|:|no\\b\\.?)\\s*.*$',
);

/** Words that describe the payment channel, not who was paid. */
const FILLER = new Set([
    'payment', 'payments', 'pmt', 'pymt', 'paymt', 'bill', 'billpay', 'pay', 'epay', 'online', 'autopay',
    'auto', 'purchase', 'pos', 'debit', 'card', 'ach', 'web', 'ppd', 'ccd', 'recurring', 'withdrawal',
    'inc', 'llc', 'ltd', 'co', 'corp', 'the', 'thank', 'you', 'www', 'com', 'net', 'org', 'http', 'https',
]);

const US_STATES = new Set([
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky',
    'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd',
    'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
]);

/**
 * First words too common to identify anyone: "First National Bank" and
 * "First Data" are different payees, "Amazon order" and "Amazon Mktpl" are not.
 */
const GENERIC_LEAD = new Set([
    'first', 'north', 'south', 'east', 'west', 'united', 'american', 'america', 'national', 'state',
    'city', 'county', 'town', 'village', 'general', 'great', 'little', 'green', 'white', 'black',
    'golden', 'royal', 'mountain', 'valley', 'carolina', 'southern', 'northern', 'eastern', 'western',
    'central', 'saint', 'check', 'transfer', 'cash', 'monthly', 'annual', 'online', 'mobile',
    'direct', 'capital', 'family', 'premier', 'advance', 'advanced', 'quality', 'express',
]);

const KEY_WORDS = 3;
const STEM_WORDS = 2;
/** Shortest stem allowed to match another by prefix ("shell" yes, "bp" only exactly). */
const MIN_PREFIX_STEM = 5;
/** Shortest first word that can identify a merchant on its own. */
const MIN_LEAD = 5;

/** True for a token that reads as a generated code rather than a word. */
function looksLikeCode(token: string): boolean {
    if (/\d/.test(token)) return true;
    // A UUID fragment or hash: long and hex-only ("deadbeefcafe").
    if (token.length >= 8 && /^[0-9a-f]+$/.test(token)) return true;
    // No vowels in five or more letters ("achdw", "xkcdq") is an identifier,
    // not a name. Short all-consonant tokens ("cvs", "bp", "wm") are brands.
    if (token.length >= 5 && !/[aeiouy]/.test(token)) return true;
    return false;
}

/**
 * Reduce a transaction description to a merchant grouping key.
 * Returns '' when nothing that names a payee remains.
 */
export function merchantKey(description: string | null | undefined): string {
    if (!description) return '';
    let text = description.toLowerCase();
    // "~" separates the payee from bank-appended memo fields.
    const tilde = text.indexOf('~');
    if (tilde > 0) text = text.slice(0, tilde);
    text = text
        .replace(PROCESSOR_PREFIX, '')
        .replace(LABELLED_TAIL, '')
        // A name with an order number glued on: "wayfair2891494910" -> "wayfair".
        .replace(/([a-z]{4,})\d{4,}\b/g, '$1');

    const tokens = text
        .replace(/['’]/g, '')
        .split(/[^a-z0-9&]+/)
        .filter(token => token.length > 0 && token !== '&')
        .filter(token => !looksLikeCode(token) && !FILLER.has(token))
        // "Airbnb * Hmxsnnk5hr Airbnb.com" names the payee twice.
        .filter((token, index, all) => all.indexOf(token) === index);

    // "... Lenoir NC": the trailing state code is location, not payee. Only
    // dropped when a name is still left in front of it.
    if (tokens.length >= 2 && US_STATES.has(tokens[tokens.length - 1])) tokens.pop();

    return tokens.slice(0, KEY_WORDS).join(' ');
}

/** The comparison form of a merchant key: its first two words, no spaces. */
export function merchantStem(key: string): string {
    return key.split(' ').filter(Boolean).slice(0, STEM_WORDS).join('');
}

/** The first word of a key when it is distinctive enough to name the merchant alone. */
export function merchantLead(key: string): string {
    const lead = key.split(' ', 1)[0] ?? '';
    return lead.length >= MIN_LEAD && !GENERIC_LEAD.has(lead) ? lead : '';
}

/** Whether two stems name the same merchant (equal, or one extends the other). */
export function stemsMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= MIN_PREFIX_STEM && long.startsWith(short);
}

/** Whether two merchant keys name the same merchant. */
export function keysMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (stemsMatch(merchantStem(a), merchantStem(b))) return true;
    const lead = merchantLead(a);
    return lead !== '' && lead === merchantLead(b);
}

/** Whether two raw descriptions name the same merchant. */
export function sameMerchant(a: string, b: string): boolean {
    return keysMatch(merchantKey(a), merchantKey(b));
}

/**
 * Earliest sighting of every merchant, with the same-merchant relation applied
 * on lookup.
 *
 * Feed it every description the book has ever recorded (the imported payee and
 * the user's renamed description both), then ask `firstSeen` for the earliest
 * date any same-merchant description appeared.
 */
export class MerchantHistory {
    private readonly byStem = new Map<string, string>();
    private readonly byLead = new Map<string, string>();
    private sorted: string[] | null = null;

    /** Record a sighting. `date` is an ISO date (YYYY-MM-DD); later dates never overwrite earlier ones. */
    add(description: string | null | undefined, date: string): void {
        this.addKey(merchantKey(description), date);
    }

    addKey(key: string, date: string): void {
        const stem = merchantStem(key);
        if (!stem) return;
        const current = this.byStem.get(stem);
        if (current === undefined) {
            this.byStem.set(stem, date);
            this.sorted = null;
        } else if (date < current) {
            this.byStem.set(stem, date);
        }
        const lead = merchantLead(key);
        if (lead) {
            const seen = this.byLead.get(lead);
            if (seen === undefined || date < seen) this.byLead.set(lead, date);
        }
    }

    /** Number of distinct merchant stems recorded. */
    get size(): number {
        return this.byStem.size;
    }

    /** Earliest ISO date a same-merchant description was seen, or null when never. */
    firstSeen(key: string): string | null {
        const stem = merchantStem(key);
        if (!stem) return null;
        let best = this.byStem.get(stem) ?? null;
        const consider = (date: string | undefined) => {
            if (date !== undefined && (best === null || date < best)) best = date;
        };
        const lead = merchantLead(key);
        if (lead) consider(this.byLead.get(lead));
        // Shorter stems this one extends ("ruralkingpelletized" -> "ruralking").
        for (let length = MIN_PREFIX_STEM; length < stem.length; length++) {
            consider(this.byStem.get(stem.slice(0, length)));
        }
        // Longer stems that extend this one ("spotify" -> "spotifypremium").
        if (stem.length >= MIN_PREFIX_STEM) {
            const sorted = this.sorted ??= [...this.byStem.keys()].sort();
            let low = 0;
            let high = sorted.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (sorted[mid] < stem) low = mid + 1; else high = mid;
            }
            for (let index = low; index < sorted.length && sorted[index].startsWith(stem); index++) {
                consider(this.byStem.get(sorted[index]));
            }
        }
        return best;
    }
}
