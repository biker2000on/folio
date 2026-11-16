import { describe, expect, it } from 'vitest';
import {
    collectKnownNumbers,
    extractFigures,
    figuresSupported,
    replaceMoneyFigures,
    unsupportedFigures,
} from '../number-check';

describe('extractFigures', () => {
    it('finds plain, grouped and decimal dollar amounts', () => {
        const f = extractFigures('Spent $1,234.56 and $5, then $10000.');
        expect(f.map(x => [x.kind, x.value])).toEqual([
            ['money', 1234.56],
            ['money', 5],
            ['money', 10000],
        ]);
    });

    it('applies k / M / million suffixes, with or without a currency symbol', () => {
        const f = extractFigures('About $3.3k, then 1.2M, $2 million and 4k.');
        expect(f.map(x => x.value)).toEqual([3300, 1_200_000, 2_000_000, 4000]);
    });

    it('reads negative and parenthesised amounts as absolute values with a sign', () => {
        const f = extractFigures('Down -$250 and ($1,000.00) and −$7.');
        expect(f.map(x => x.value)).toEqual([250, 1000, 7]);
        expect(f.map(x => x.signed)).toEqual([-250, -1000, -7]);
    });

    it('handles currency codes and other symbols', () => {
        const f = extractFigures('Paid USD 1,200 and 300 EUR and £45.10 and €9.');
        expect(f.map(x => x.value)).toEqual([1200, 300, 45.1, 9]);
    });

    it('finds percentages in several spellings', () => {
        const f = extractFigures('Up 12%, down 3.5 percent, and 2 percentage points.');
        expect(f.map(x => [x.kind, x.value])).toEqual([
            ['percent', 12],
            ['percent', 3.5],
            ['percent', 2],
        ]);
    });

    it('ignores plain counts, years, days and placeholder tokens', () => {
        expect(extractFigures('In 2026 you made 14 purchases over 30 days at ⟨M1⟩ and ⟨A12⟩.')).toEqual([]);
    });

    it('does not read a lone bracket of the prose as part of the figure', () => {
        const [f] = extractFigures('(about $50');
        expect(f.raw).toBe('$50');
        expect(f.signed).toBe(50);
    });
});

describe('figure support', () => {
    const known = [1234.56, 31.25, 8000];

    it('accepts figures within 5% or $1 of a known number', () => {
        expect(figuresSupported('About $1,200 spent', known)).toBe(true); // within 5%
        expect(figuresSupported('Exactly $1,235.10', known)).toBe(true);
        expect(figuresSupported('$3.3k', [3323])).toBe(true);
        expect(figuresSupported('$0.50 fee', [0])).toBe(true); // within $1
    });

    it('compares absolute values so income shown positive passes', () => {
        expect(figuresSupported('Income was $8,000', [-8000])).toBe(true);
        expect(figuresSupported('Down -$1,234.56', known)).toBe(true);
    });

    it('rejects a figure the code never gave', () => {
        const bad = unsupportedFigures('You spent $1,234.56 and saved $2,000.', known);
        expect(bad.map(b => b.value)).toEqual([2000]);
        expect(figuresSupported('That is $1,500.', known)).toBe(false);
    });

    it('checks percentages within half a point or 5%', () => {
        expect(figuresSupported('Savings rate 31%', known)).toBe(true);
        expect(figuresSupported('Savings rate 31.7%', known)).toBe(true);
        expect(figuresSupported('Savings rate 33%', known)).toBe(false);
        expect(figuresSupported('Up 0.4%', [0])).toBe(true);
    });

    it('passes text with no figures, even with nothing known', () => {
        expect(figuresSupported('A quiet month.', [])).toBe(true);
        expect(figuresSupported('A $5 month.', [])).toBe(false);
    });
});

describe('collectKnownNumbers', () => {
    it('walks numbers, numeric strings and figures in text, never keys', () => {
        const known = collectKnownNumbers({
            total: -1234.56,
            count: 3,
            label: 'Paid $45.10 on 2 cards',
            nested: [{ v: '987.65' }],
            big: BigInt(42),
            decimal: { toNumber: () => 7.5 },
            1999: 'key is not a number we sent',
        });
        expect(known).toEqual(expect.arrayContaining([1234.56, 3, 45.1, 2, 987.65, 42, 7.5]));
        expect(known).not.toContain(1999);
    });
});

describe('replaceMoneyFigures', () => {
    it('replaces only money figures', () => {
        expect(replaceMoneyFigures('From $1,234.56 to 12% and $5.', f => `[${f.value}]`)).toBe('From [1234.56] to 12% and [5].');
    });
});
