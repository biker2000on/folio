import { describe, expect, it } from 'vitest';
import {
    MerchantHistory,
    merchantKey,
    merchantLead,
    merchantStem,
    sameMerchant,
    stemsMatch,
} from '../merchant-identity';

describe('merchantKey', () => {
    it('drops per-charge order codes after a marketplace prefix', () => {
        expect(merchantKey('AMAZON MKTPL*DL5XR0X03')).toBe('amazon');
        expect(merchantKey('AMAZON MKTPL*BC6S71270')).toBe('amazon');
        expect(merchantKey('Amazon.com*G40XX4E63')).toBe('amazon');
        expect(merchantKey('Airbnb * Hmxsnnk5hr Airbnb.com Ca')).toBe('airbnb');
    });

    it('cuts bank-appended memo fields after a tilde', () => {
        expect(merchantKey('CALDWELL COUNTY UTILITY~ Future Amount: 46.55 ~ Tran: ACHDW'))
            .toBe('caldwell county utility');
        expect(merchantKey('CALDWELL COUNTY UTILITY')).toBe('caldwell county utility');
    });

    it('cuts labelled references and letter-only identifiers', () => {
        expect(merchantKey('Spectrum Ref: QWRTPLK')).toBe('spectrum');
        expect(merchantKey('Blue Ridge Energy Conf# ABCDEFGH')).toBe('blue ridge energy');
        expect(merchantKey('Duke Energy PPD ID: 9bd1f3a2')).toBe('duke energy');
        expect(merchantKey('City Water deadbeefcafe')).toBe('city water');
        expect(merchantKey('Propane Co XKCDQ')).toBe('propane');
    });

    it('strips card-processor prefixes and payment filler', () => {
        expect(merchantKey('SQ *Blue Bottle Coffee')).toBe('blue bottle coffee');
        expect(merchantKey('PAYPAL *SPOTIFY')).toBe('spotify');
        expect(merchantKey('DUKEENERGY BILL PAY')).toBe('dukeenergy');
        expect(merchantKey('CARDMEMBER SVC ONLINE PMT')).toBe('cardmember svc');
    });

    it('drops store numbers, phone numbers and a trailing state code', () => {
        expect(merchantKey('Wm Supercenter #1064 Lenoir Nc')).toBe('wm supercenter lenoir');
        expect(merchantKey('Wf *wayfair2891494910 866-263-8325 Ma')).toBe('wf wayfair');
        expect(merchantKey('Med*mdacc Pharmacy R2 713-792-2991 Tx')).toBe('med mdacc pharmacy');
    });

    it('keeps short all-consonant brand names', () => {
        expect(merchantKey('CVS Pharmacy 4471')).toBe('cvs pharmacy');
        expect(merchantKey('BP 9921 Hickory NC')).toBe('bp hickory');
    });

    it('returns an empty key when only codes remain', () => {
        expect(merchantKey('#12345 99-00')).toBe('');
        expect(merchantKey('')).toBe('');
        expect(merchantKey(null)).toBe('');
    });
});

describe('same-merchant relation', () => {
    it('matches a bill whose only difference is its ID', () => {
        expect(sameMerchant(
            'CALDWELL COUNTY UTILITY~ Future Amount: 46.55 ~ Tran: ACHDW',
            'CALDWELL COUNTY UTILITY~ Future Amount: 35.5 ~ Tran: ACHDW',
        )).toBe(true);
        expect(sameMerchant('AMAZON MKTPL*DL5XR0X03', 'AMAZON MKTPL*UT9ID20O3')).toBe(true);
    });

    it('matches a bank payee against a hand-typed description', () => {
        expect(sameMerchant('DUKEENERGY BILL PAY', 'Duke Energy')).toBe(true);
        expect(sameMerchant('Rural King', 'Rural King 1ton pelletized lime')).toBe(true);
        expect(sameMerchant('Amazon order - shelf brackets', 'AMAZON MKTPL*BB14R7WR1')).toBe(true);
    });

    it('matches the same chain in a different town', () => {
        expect(sameMerchant('Wm Supercenter #1064 Lenoir Nc', 'Wm Supercenter #2210 Hickory Nc')).toBe(true);
    });

    it('keeps genuinely different merchants apart', () => {
        expect(sameMerchant('Rural King', 'Tractor Supply')).toBe(false);
        expect(sameMerchant('Shell Oil 5544', 'Sheetz 221')).toBe(false);
        // A generic first word is not an identity.
        expect(sameMerchant('First National Bank', 'First Data Merchant')).toBe(false);
        expect(sameMerchant('Check North Supply', 'Check Paid')).toBe(false);
    });

    it('treats only a distinctive first word as a lead', () => {
        expect(merchantLead('amazon mktpl')).toBe('amazon');
        expect(merchantLead('county water')).toBe('');
        expect(merchantLead('bp hickory')).toBe('');
    });

    it('never prefix-matches a very short stem', () => {
        expect(stemsMatch('bp', 'bpproducts')).toBe(false);
        expect(stemsMatch('bp', 'bp')).toBe(true);
        expect(stemsMatch('', '')).toBe(false);
    });

    it('builds the stem from the first two words', () => {
        expect(merchantStem('caldwell county utility')).toBe('caldwellcounty');
        expect(merchantStem('spotify')).toBe('spotify');
    });
});

describe('MerchantHistory', () => {
    it('reports the earliest sighting across related stems', () => {
        const history = new MerchantHistory();
        history.add('Rural King', '2024-03-02');
        history.add('Rural King 1ton pelletized lime', '2026-07-21');
        history.add('AMAZON MKTPL*DL5XR0X03', '2025-01-10');

        expect(history.firstSeen(merchantKey('Rural King fence posts'))).toBe('2024-03-02');
        // A shorter key finds the longer one that extends it.
        expect(history.firstSeen('amazon')).toBe('2025-01-10');
        expect(history.firstSeen('tractor supply')).toBeNull();
    });

    it('keeps the earliest date when a merchant is added twice', () => {
        const history = new MerchantHistory();
        history.add('Spotify', '2026-05-01');
        history.add('PAYPAL *SPOTIFY', '2023-02-01');
        history.add('Spotify', '2026-06-01');
        expect(history.firstSeen('spotify')).toBe('2023-02-01');
        expect(history.size).toBe(1);
    });

    it('ignores descriptions with no payee', () => {
        const history = new MerchantHistory();
        history.add('#1234', '2026-01-01');
        expect(history.size).toBe(0);
    });
});
