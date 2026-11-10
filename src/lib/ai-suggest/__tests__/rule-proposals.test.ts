import { describe, expect, it } from 'vitest';
import { newNames, ph, unmask, unmaskStrict } from '@/lib/ai-privacy/privacy';
import {
    MAX_RULE_PROPOSALS,
    RULE_MAX_HISTORY_SHARE,
    RULE_SHARE_CHECK_MIN_MATCHES,
    buildRuleMessages,
    buildRulePromptPayload,
    dryRunRule,
    pickRuleCandidates,
    resolveAccountRef,
    ruleKnownNumbers,
    validateRuleProposals,
    type HistoryDescription,
    type RuleTargetAccount,
    type RuleValidationContext,
} from '../rule-proposals';

const ACCOUNTS: RuleTargetAccount[] = [
    { guid: 'e'.repeat(32), path: 'Expenses', name: 'Expenses', type: 'EXPENSE', placeholder: true },
    { guid: 'f'.repeat(32), path: 'Expenses:Food', name: 'Food', type: 'EXPENSE', placeholder: true },
    { guid: '1'.repeat(32), path: 'Expenses:Food:Coffee', name: 'Coffee', type: 'EXPENSE', placeholder: false },
    { guid: '2'.repeat(32), path: 'Expenses:Hardware', name: 'Hardware', type: 'EXPENSE', placeholder: false },
    { guid: '3'.repeat(32), path: 'Income:Salary', name: 'Salary', type: 'INCOME', placeholder: false },
    { guid: '4'.repeat(32), path: 'Assets:Checking', name: 'Checking', type: 'BANK', placeholder: false },
    { guid: '5'.repeat(32), path: 'Expenses:Travel:Coffee', name: 'Coffee', type: 'EXPENSE', placeholder: false },
];

const HISTORY: HistoryDescription[] = [
    { description: 'ZORBLAX COFFEE #12', count: 2, uncategorized: 2 },
    { description: 'ZORBLAX COFFEE #77', count: 1, uncategorized: 0 },
    { description: 'VANTABLACK HARDWARE', count: 1, uncategorized: 1 },
    { description: 'ACME PAYROLL', count: 4, uncategorized: 0 },
    { description: 'NETFLIX.COM', count: 3, uncategorized: 0 },
];
const TOTAL = 100;

function ctx(over: Partial<RuleValidationContext> = {}): RuleValidationContext {
    return {
        unmaskStrict: t => ({ text: t, unknown: [] }),
        unmask: t => t,
        accounts: ACCOUNTS,
        existingRules: [],
        history: HISTORY,
        totalTransactions: TOTAL,
        knownNumbers: [2, 1, 4],
        ...over,
    };
}

const ok = (match: string, account = 'Expenses:Food:Coffee', extra: Record<string, unknown> = {}) => ({ match, account, ...extra });

describe('validateRuleProposals: accepted proposals', () => {
    it('accepts a valid rule with a history preview', () => {
        const r = validateRuleProposals([ok('zorblax coffee', 'Expenses:Food:Coffee', { why: 'A coffee shop.' })], ctx());
        expect(r.dropped).toBe(0);
        expect(r.proposals).toEqual([{
            match: 'zorblax coffee',
            matchType: 'contains',
            accountGuid: '1'.repeat(32),
            accountPath: 'Expenses:Food:Coffee',
            accountType: 'EXPENSE',
            why: 'A coffee shop.',
            matchCount: 3,
            uncategorizedCount: 2,
            share: 0.03,
            samples: ['ZORBLAX COFFEE #12', 'ZORBLAX COFFEE #77'],
        }]);
    });

    it('accepts an INCOME target and an exact match type', () => {
        const r = validateRuleProposals([ok('ACME PAYROLL', 'Income:Salary', { matchType: 'exact' })], ctx());
        expect(r.proposals[0]).toMatchObject({ matchType: 'exact', accountType: 'INCOME', matchCount: 4 });
    });

    it('caps samples at 3, largest first', () => {
        const history = [
            { description: 'shop a', count: 1, uncategorized: 0 },
            { description: 'shop b', count: 5, uncategorized: 0 },
            { description: 'shop c', count: 3, uncategorized: 0 },
            { description: 'shop d', count: 2, uncategorized: 0 },
        ];
        const r = validateRuleProposals([ok('shop')], ctx({ history }));
        expect(r.proposals[0].samples).toEqual(['shop b', 'shop c', 'shop d']);
    });

    it('trims and collapses whitespace in the match and cuts it to 80 characters', () => {
        const long = `  zorblax   coffee ${'x'.repeat(100)}`;
        const r = validateRuleProposals([ok(long)], ctx({ history: [{ description: `zorblax coffee ${'x'.repeat(100)}`, count: 1, uncategorized: 0 }] }));
        expect(r.proposals[0].match.startsWith('zorblax coffee x')).toBe(true);
        expect(r.proposals[0].match.length).toBe(80);
    });
});

describe('validateRuleProposals: every rejection reason', () => {
    const cases: Array<[string, unknown[], string, Partial<RuleValidationContext>?]> = [
        ['malformed (not an object)', ['zorblax'], 'malformed'],
        ['malformed (missing account)', [{ match: 'zorblax' }], 'malformed'],
        ['too short after trimming', [ok('  z ')], 'too-short'],
        ['regex is not offered', [ok('zorb.*', 'Expenses:Food:Coffee', { matchType: 'regex' })], 'invalid-pattern'],
        ['unknown match type', [ok('zorblax', 'Expenses:Food:Coffee', { matchType: 'fuzzy' })], 'invalid-pattern'],
        ['unknown account', [ok('zorblax', 'Expenses:Nope')], 'unknown-account'],
        ['ambiguous bare name', [ok('zorblax', 'Coffee')], 'unknown-account'],
        ['balance-sheet target', [ok('zorblax', 'Assets:Checking')], 'wrong-account-type'],
        ['placeholder target', [ok('zorblax', 'Expenses:Food')], 'placeholder-account'],
        ['duplicate of an existing rule', [ok('Zorblax Coffee')], 'duplicate-rule',
            { existingRules: [{ id: 1, pattern: 'zorblax coffee', matchType: 'contains', priority: 0 }] }],
        ['no history match', [ok('nonexistent merchant')], 'no-history-match'],
        ['existing rules already take every match', [ok('zorblax coffee')], 'covered-by-rule',
            { existingRules: [{ id: 1, pattern: 'zorblax', matchType: 'contains', priority: 0 }] }],
        ['unknown token', [ok('⟨M99⟩')], 'unknown-token',
            { unmaskStrict: t => unmaskStrict(t, newNames()) }],
    ];
    it.each(cases)('drops %s', (_label, raw, reason, over) => {
        const r = validateRuleProposals(raw, ctx(over));
        expect(r.proposals).toEqual([]);
        expect(r.dropped).toBe(1);
        expect(r.reasons).toEqual({ [reason]: 1 });
    });

    it('drops a duplicate within the same reply (case-insensitive)', () => {
        const r = validateRuleProposals([ok('zorblax coffee'), ok('ZORBLAX COFFEE', 'Expenses:Hardware')], ctx());
        expect(r.proposals).toHaveLength(1);
        expect(r.reasons).toEqual({ 'duplicate-proposal': 1 });
    });

    it('treats a non-array reply as nothing', () => {
        expect(validateRuleProposals(undefined, ctx())).toMatchObject({ proposals: [], dropped: 0 });
        expect(validateRuleProposals({ rules: [] }, ctx())).toMatchObject({ proposals: [], dropped: 0 });
    });
});

describe('validateRuleProposals: dry-run share cap', () => {
    const many = (n: number): HistoryDescription[] => [{ description: 'PAYMENT THANK YOU', count: n, uncategorized: 0 }];

    it(`drops a rule matching more than ${RULE_MAX_HISTORY_SHARE * 100}% of transactions`, () => {
        const r = validateRuleProposals([ok('payment')], ctx({ history: many(21), totalTransactions: 100 }));
        expect(r.reasons).toEqual({ 'too-broad': 1 });
    });

    it('keeps a rule at exactly the cap', () => {
        const r = validateRuleProposals([ok('payment')], ctx({ history: many(20), totalTransactions: 100 }));
        expect(r.proposals).toHaveLength(1);
        expect(r.proposals[0].share).toBe(0.2);
    });

    it(`does not apply the cap at or below ${RULE_SHARE_CHECK_MIN_MATCHES} matches (small books)`, () => {
        const r = validateRuleProposals([ok('payment')], ctx({ history: many(RULE_SHARE_CHECK_MIN_MATCHES), totalTransactions: 20 }));
        expect(r.proposals).toHaveLength(1);
        const over = validateRuleProposals([ok('payment')], ctx({ history: many(RULE_SHARE_CHECK_MIN_MATCHES + 1), totalTransactions: 20 }));
        expect(over.reasons).toEqual({ 'too-broad': 1 });
    });

    it('counts only what existing rules do not already take', () => {
        const history = [
            { description: 'zorblax coffee downtown', count: 4, uncategorized: 1 },
            { description: 'zorblax coffee airport', count: 2, uncategorized: 2 },
        ];
        const r = validateRuleProposals([ok('zorblax coffee')], ctx({
            history,
            existingRules: [{ id: 1, pattern: 'airport', matchType: 'contains', priority: 0 }],
        }));
        expect(r.proposals[0]).toMatchObject({ matchCount: 4, uncategorizedCount: 1, samples: ['zorblax coffee downtown'] });
    });
});

describe('validateRuleProposals: cap and why', () => {
    it(`keeps at most ${MAX_RULE_PROPOSALS} and counts the rest`, () => {
        const history = Array.from({ length: 30 }, (_, i) => ({ description: `merchant ${String.fromCharCode(97 + (i % 26))}${i}`, count: 1, uncategorized: 0 }));
        const raw = history.map(h => ok(h.description));
        const r = validateRuleProposals(raw, ctx({ history, totalTransactions: 1000 }));
        expect(r.proposals).toHaveLength(MAX_RULE_PROPOSALS);
        expect(r.reasons).toEqual({ 'over-cap': 10 });
        expect(r.dropped).toBe(10);
    });

    it('drops a why that brings a figure the payload never had, keeps the rule', () => {
        const r = validateRuleProposals([ok('zorblax coffee', 'Expenses:Food:Coffee', { why: 'You spend $412 a month here.' })], ctx());
        expect(r.proposals[0].why).toBeNull();
        expect(r.whyDropped).toBe(1);
        expect(r.failedFigures.map(f => f.raw)).toEqual(['$412']);
    });

    it('keeps a why with no figures and unmasks it', () => {
        const names = newNames();
        const t = ph(names, 'Merchant', 'Zorblax Coffee');
        const r = validateRuleProposals([ok('zorblax coffee', 'Expenses:Food:Coffee', { why: `${t} is a café.` })], ctx({ unmask: s => unmask(s, names) }));
        expect(r.proposals[0].why).toBe('Zorblax Coffee is a café.');
    });

    it('ignores a non-string why', () => {
        const r = validateRuleProposals([ok('zorblax coffee', 'Expenses:Food:Coffee', { why: 42 })], ctx());
        expect(r.proposals[0].why).toBeNull();
        expect(r.whyDropped).toBe(0);
    });
});

describe('validateRuleProposals: unmasking (summary mode)', () => {
    it('turns merchant and account tokens back into real text before every check', () => {
        const names = newNames();
        const m = ph(names, 'Merchant', 'zorblax coffee');
        const food = ph(names, 'Account', 'Food');
        const coffee = ph(names, 'Account', 'Coffee');
        const r = validateRuleProposals(
            [{ match: m, account: `Expenses:${food}:${coffee}` }],
            ctx({ unmaskStrict: t => unmaskStrict(t, names), unmask: t => unmask(t, names) }),
        );
        expect(r.dropped).toBe(0);
        expect(r.proposals[0]).toMatchObject({ match: 'zorblax coffee', accountPath: 'Expenses:Food:Coffee', matchCount: 3 });
    });

    it('refuses a reply whose token the server never issued instead of guessing', () => {
        const names = newNames();
        ph(names, 'Merchant', 'zorblax coffee');
        const r = validateRuleProposals(
            [{ match: '⟨M1⟩', account: 'Expenses:⟨A42⟩' }],
            ctx({ unmaskStrict: t => unmaskStrict(t, names) }),
        );
        expect(r.reasons).toEqual({ 'unknown-token': 1 });
    });
});

describe('helpers', () => {
    it('resolveAccountRef: guid, path (any case), path suffix, unique name', () => {
        expect(resolveAccountRef('1'.repeat(32), ACCOUNTS)?.path).toBe('Expenses:Food:Coffee');
        expect(resolveAccountRef('expenses:hardware', ACCOUNTS)?.name).toBe('Hardware');
        expect(resolveAccountRef('Food:Coffee', ACCOUNTS)?.guid).toBe('1'.repeat(32));
        expect(resolveAccountRef('Salary', ACCOUNTS)?.type).toBe('INCOME');
        expect(resolveAccountRef('Coffee', ACCOUNTS)).toBeNull(); // two accounts named Coffee
        expect(resolveAccountRef('  ', ACCOUNTS)).toBeNull();
    });

    it('dryRunRule uses the import-time matcher (case-insensitive contains, exact)', () => {
        expect(dryRunRule('zorblax', 'contains', HISTORY).map(h => h.description)).toEqual(['ZORBLAX COFFEE #12', 'ZORBLAX COFFEE #77']);
        expect(dryRunRule('netflix.com', 'exact', HISTORY)).toHaveLength(1);
        expect(dryRunRule('netflix', 'exact', HISTORY)).toHaveLength(0);
    });

    it('pickRuleCandidates leaves out what rules and learned suggestions cover, uncategorised first', () => {
        const candidates = pickRuleCandidates(
            HISTORY,
            [{ id: 1, pattern: 'netflix', matchType: 'contains', priority: 0 }],
            ['acme payroll'],
        );
        // The derived pattern drops the store-number tail, like the learned suggestions.
        expect(candidates.map(c => c.text)).toEqual(['ZORBLAX COFFEE', 'VANTABLACK HARDWARE']);
        expect(candidates[0]).toMatchObject({ count: 3, uncategorized: true });
        expect(candidates[1]).toMatchObject({ count: 1, uncategorized: true });
    });

    it('buildRulePromptPayload: summary sends tokens, never names; full sends text', () => {
        const names = newNames();
        const privacy = { level: 'summary' as const, names, token: (_k: 'Merchant', real: string) => ph(names, 'Merchant', real) };
        const payload = buildRulePromptPayload(
            [{ text: 'Zorblax Coffee', count: 3, uncategorized: true }],
            [{ path: 'Expenses:Food:Coffee', type: 'EXPENSE' }],
            privacy,
        );
        expect(payload).toEqual({
            descriptions: [{ d: '⟨M1⟩', n: 3, uncategorized: true }],
            accounts: [{ a: 'Expenses:⟨A1⟩:⟨A2⟩', t: 'EXPENSE' }],
        });
        const text = buildRuleMessages(payload, true).map(m => m.content).join('\n');
        expect(text).not.toContain('Zorblax');
        expect(text).not.toContain('Coffee');
        expect(text).toContain('placeholder tokens');
        expect(ruleKnownNumbers(payload)).toContain(3);

        const full = buildRulePromptPayload(
            [{ text: 'Zorblax Coffee', count: 3, uncategorized: false }],
            [{ path: 'Expenses:Food:Coffee', type: 'EXPENSE' }],
            { level: 'full', names: null, token: (_k, r) => r },
        );
        expect(full.descriptions[0]).toEqual({ d: 'Zorblax Coffee', n: 3 });
        expect(full.accounts[0].a).toBe('Expenses:Food:Coffee');
    });
});
