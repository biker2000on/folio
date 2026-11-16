import { describe, expect, it } from 'vitest';
import {
    isBankEvent,
    isKnownCloudEndpoint,
    isLikelySelfHostedUrl,
    levelFor,
    mask,
    newNames,
    numericColumnTreatment,
    parsePrivacyMode,
    ph,
    roundMoney,
    scrubRows,
    scrubText,
    textColumnKind,
    unmask,
    unmaskSql,
} from '../privacy';
import { addNamesFromSource } from '../gate';
import { createGatedAi } from '../session';
import { validateGeneratedSql } from '@/lib/ai-query/guardrails';

describe('roundMoney', () => {
    it('rounds to 5 under 100, 10 under 1,000, 100 above', () => {
        expect(roundMoney(73.21)).toBe(75);
        expect(roundMoney(12)).toBe(10);
        expect(roundMoney(987.65)).toBe(990);
        expect(roundMoney(1234.56)).toBe(1200);
        expect(roundMoney(45678.91)).toBe(45700);
        expect(roundMoney(-1234.56)).toBe(-1200);
    });

    it('never rounds a real amount to zero', () => {
        expect(roundMoney(0.4)).toBe(5);
        expect(roundMoney(-2)).toBe(-5);
        expect(roundMoney(0)).toBe(0);
        expect(roundMoney(Number.NaN)).toBe(0);
    });
});

describe('modes and levels', () => {
    it('defaults unknown or missing modes to summary', () => {
        expect(parsePrivacyMode(undefined)).toBe('summary');
        expect(parsePrivacyMode('local')).toBe('summary');
        expect(parsePrivacyMode('off')).toBe('off');
        expect(parsePrivacyMode('full')).toBe('full');
    });

    it('gives full detail only to a self-hosted, non-cloud endpoint', () => {
        expect(levelFor('off', true, 'http://localhost:11434')).toBe('off');
        expect(levelFor('summary', true, 'http://localhost:11434')).toBe('summary');
        expect(levelFor('full', true, 'http://ollama:11434/v1')).toBe('full');
        expect(levelFor('full', false, 'http://ollama:11434/v1')).toBe('summary');
        // A cloud endpoint gets the summary even when someone ticked the box.
        expect(levelFor('full', true, 'https://api.openai.com/v1')).toBe('summary');
    });

    it('suggests self-hosted from the address', () => {
        for (const url of [
            'http://localhost:11434/v1', 'http://127.0.0.1:8080', 'http://[::1]:11434', 'http://10.0.0.5/v1',
            'http://172.20.1.1', 'http://192.168.1.10:11434', 'http://100.70.1.2', 'http://gpu.local/v1',
            'http://box.lan', 'http://llm.internal', 'http://ai.home.arpa', 'ollama:11434', 'http://ollama:11434/v1',
        ]) expect(isLikelySelfHostedUrl(url)).toBe(true);
        for (const url of [
            'https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'http://172.32.0.1', 'http://8.8.8.8',
            'https://llm.example.com', '', null,
        ]) expect(isLikelySelfHostedUrl(url)).toBe(false);
        expect(isKnownCloudEndpoint('https://api.anthropic.com/v1')).toBe(true);
        expect(isKnownCloudEndpoint('http://localhost:11434')).toBe(false);
    });
});

describe('mask / unmask', () => {
    const build = () => {
        const names = newNames();
        ph(names, 'Merchant', 'Zorblax Coffee Roasters');
        ph(names, 'Merchant', "O'Malley's Pub");
        ph(names, 'Account', 'Groceries');
        ph(names, 'Account', 'Expenses:Groceries');
        ph(names, 'Holding', 'VT');
        return names;
    };

    it('gives a name one token whatever kind asks later, and keeps tokens stable', () => {
        const names = build();
        expect(ph(names, 'Merchant', 'zorblax coffee   roasters')).toBe('⟨M1⟩');
        expect(ph(names, 'Account', 'Zorblax Coffee Roasters')).toBe('⟨M1⟩');
        expect(ph(names, 'Account', 'Groceries')).toBe('⟨A1⟩');
    });

    it('masks whole names case-insensitively, longest first', () => {
        const names = build();
        expect(mask('Spent at ZORBLAX COFFEE ROASTERS on Expenses:Groceries and Groceries', names))
            .toBe('Spent at ⟨M1⟩ on ⟨A2⟩ and ⟨A1⟩');
        // Not inside other words; names under 3 characters are left alone.
        expect(mask('GroceriesPlus and VT', names)).toBe('GroceriesPlus and VT');
    });

    it('restores names, tolerating mangled and grouped tokens', () => {
        const names = build();
        expect(unmask('You went to ⟨M1⟩ twice.', names)).toBe('You went to Zorblax Coffee Roasters twice.');
        expect(unmask('See ⟨ M1 ⟩ and 〈A1〉.', names)).toBe('See Zorblax Coffee Roasters and Groceries.');
        expect(unmask('Both ⟨M1, M2⟩.', names)).toBe("Both Zorblax Coffee Roasters, O'Malley's Pub.");
        expect(unmask('Known ASCII <A1> works.', names)).toBe('Known ASCII Groceries works.');
    });

    it('never leaves a raw token on screen', () => {
        const names = build();
        expect(unmask('Paid ⟨M99⟩ and ⟨H7⟩.', names)).toBe('Paid a merchant and a holding.');
        expect(unmask('Cut off ⟨A42', names)).toBe('Cut off an account');
        // An unknown ASCII "token" is ordinary text and stays.
        expect(unmask('x <M99> y', names)).toBe('x <M99> y');
    });

    it('drops a name repeated in brackets after itself', () => {
        const names = build();
        expect(unmask('Spent at ⟨A1⟩ (Groceries) this month.', names)).toBe('Spent at Groceries this month.');
    });
});

describe('scrubText', () => {
    it('masks names, rounds money and reduces dates', () => {
        const names = newNames();
        ph(names, 'Merchant', 'Vantablack Hardware Emporium');
        expect(scrubText('First charge of $987.65 from "Vantablack Hardware Emporium" on 2026-10-14, 33% up.', names))
            .toBe('First charge of about $990 from "⟨M1⟩" on 2026-10, 33% up.');
        expect(scrubText('Crossed $25,000 and fell -$1,234.56.', names)).toBe('Crossed $25,000 and fell about -$1,200.');
    });
});

describe('unmaskSql', () => {
    const names = newNames();
    ph(names, 'Merchant', 'Zorblax Coffee Roasters');
    ph(names, 'Merchant', "O'Malley's Pub");
    ph(names, 'Merchant', "x' OR '1'='1");

    it('splices names into string literals with quotes doubled', () => {
        expect(unmaskSql("SELECT 1 FROM book_transactions WHERE description ILIKE '%⟨M1⟩%'", names))
            .toBe("SELECT 1 FROM book_transactions WHERE description ILIKE '%Zorblax Coffee Roasters%'");
        expect(unmaskSql("WHERE description = '⟨M2⟩'", names)).toBe("WHERE description = 'O''Malley''s Pub'");
    });

    it('quotes a token found outside a literal', () => {
        expect(unmaskSql('WHERE description = ⟨M2⟩', names)).toBe("WHERE description = 'O''Malley''s Pub'");
    });

    it('cannot be used to break out of a literal', () => {
        const sql = unmaskSql("SELECT t.description FROM book_transactions t WHERE t.description = '⟨M3⟩' LIMIT 5", names);
        expect(sql).toBe("SELECT t.description FROM book_transactions t WHERE t.description = 'x'' OR ''1''=''1' LIMIT 5");
        // The unmasked statement still goes through the unchanged guardrails.
        expect(validateGeneratedSql(sql).ok).toBe(true);
    });

    it('keeps escaped quotes and unknown tokens intact', () => {
        expect(unmaskSql("WHERE a = 'it''s ⟨M1⟩' AND b = '⟨M99⟩'", names))
            .toBe("WHERE a = 'it''s Zorblax Coffee Roasters' AND b = '⟨M99⟩'");
    });
});

describe('scrubRows', () => {
    it('tokens text, rounds money, keeps counts/percents/years/GUIDs, reduces dates', () => {
        const names = newNames();
        const guid = 'a'.repeat(32);
        const [row] = scrubRows([{
            account_guid: guid,
            account_name: 'Zephyrine Credit Union Checking',
            description: 'Zorblax Coffee Roasters',
            total_spent: '1234.56',
            monthly_total: 987.65,
            txn_count: 17,
            pct_of_total: 12.34,
            year: 2026,
            post_date: '2026-10-14T00:00:00.000Z',
            when: new Date('2026-09-03T12:00:00Z'),
            account_type: 'EXPENSE',
            memo: null,
            hidden: false,
            commodity: 'QXZT',
            payee: 'COSTCO',
            currency: 'USD',
        }], names);
        expect(row).toEqual({
            account_guid: guid,
            account_name: '⟨A1⟩',
            description: '⟨M1⟩',
            total_spent: 1200,
            monthly_total: 990,
            txn_count: 17,
            pct_of_total: 12.34,
            year: 2026,
            post_date: '2026-10',
            when: '2026-09',
            account_type: 'EXPENSE',
            memo: null,
            hidden: false,
            commodity: '⟨H1⟩',
            payee: '⟨M2⟩',
            currency: 'USD',
        });
    });

    it('classifies columns by word, not substring', () => {
        expect(numericColumnTreatment('monthly_total')).toBe('round');
        expect(numericColumnTreatment('month')).toBe('keep');
        expect(numericColumnTreatment('percent_of_total')).toBe('keep');
        expect(numericColumnTreatment('numTransactions')).toBe('keep');
        expect(numericColumnTreatment('mystery')).toBe('round');
        expect(textColumnKind('parent_account')).toBe('Account');
        expect(textColumnKind('ticker')).toBe('Holding');
        expect(textColumnKind('vendor_name')).toBe('Vendor');
        expect(textColumnKind('payee')).toBe('Merchant');
    });
});

describe('names map from a book', () => {
    it('skips generic top-level accounts and bank events', () => {
        const names = addNamesFromSource(newNames(), {
            accounts: [
                { name: 'Expenses', fullname: 'Expenses' },
                { name: 'Groceries', fullname: 'Expenses:Groceries' },
            ],
            descriptions: [{ description: 'Zorblax Coffee Roasters' }, { description: 'Transfer' }, { description: 'Interest charged' }],
            commodities: [{ mnemonic: 'QXZT', fullname: 'Quixotic Total Market' }],
        });
        expect([...names.back.values()]).toEqual([
            'Groceries', 'Expenses:Groceries', 'Zorblax Coffee Roasters', 'QXZT', 'Quixotic Total Market',
        ]);
        expect(isBankEvent('Online Payment')).toBe(true);
        expect(isBankEvent('Zorblax Coffee Roasters')).toBe(false);
        expect(mask('my mortgage payment', names)).toBe('my mortgage payment');
    });
});

describe('createGatedAi', () => {
    it('masks user and assistant content in summary mode as a safety net, never the system prompt', async () => {
        const names = newNames();
        ph(names, 'Merchant', 'Zorblax Coffee Roasters');
        const sent: string[] = [];
        const ai = createGatedAi({
            path: 'ask',
            level: 'summary',
            config: { provider: 'custom', base_url: 'http://x', api_key: null, model: 'm', enabled: true },
            names,
            chatFn: async (_c, messages) => {
                sent.push(...messages.map(m => m.content));
                return 'ok';
            },
        });
        await ai.chat([
            { role: 'system', content: 'About Zorblax Coffee Roasters' },
            { role: 'user', content: 'Zorblax Coffee Roasters?' },
        ]);
        expect(sent).toEqual(['About Zorblax Coffee Roasters', '⟨M1⟩?']);
    });

    it('is an identity in full mode', () => {
        const ai = createGatedAi({
            path: 'ask',
            level: 'full',
            config: { provider: 'custom', base_url: 'http://x', api_key: null, model: 'm', enabled: true },
            names: null,
            chatFn: async () => 'ok',
        });
        expect(ai.mask('Zorblax $1,234.56')).toBe('Zorblax $1,234.56');
        expect(ai.scrubRows([{ total: 1234.56 }])).toEqual([{ total: 1234.56 }]);
        expect(ai.token('Merchant', 'Zorblax')).toBe('Zorblax');
    });
});
