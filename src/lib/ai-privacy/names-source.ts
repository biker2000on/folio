// src/lib/ai-privacy/names-source.ts

/**
 * Loads the real names a summary-mode model must not see, for a set of
 * accounts (one book, or the authorised family graph). Read-only queries; the
 * result only ever feeds the in-memory names map in ./gate.ts and is never
 * persisted or logged.
 *
 * Vendors/customers are not loaded: GnuCash's business tables carry no book
 * column, and no gated payload includes them today. A path that starts sending
 * them gets placeholders on first sight through ph()/scrubRows().
 */

import { query } from '@/lib/db';

export interface NamesSource {
    accounts: Array<{ name: string | null; fullname: string | null }>;
    /** Transaction descriptions over ~400 days, largest spend first. */
    descriptions: Array<{ description: string }>;
    commodities: Array<{ mnemonic: string | null; fullname: string | null }>;
}

const DESCRIPTION_LIMIT = 2000;

export async function loadNamesSource(accountGuids: string[]): Promise<NamesSource> {
    if (accountGuids.length === 0) return { accounts: [], descriptions: [], commodities: [] };
    const [accounts, descriptions, commodities] = await Promise.all([
        query(
            `SELECT name, fullname FROM account_hierarchy
             WHERE guid = ANY($1::text[])
             ORDER BY fullname`,
            [accountGuids],
        ),
        query(
            `SELECT t.description
             FROM transactions t
             JOIN splits s ON s.tx_guid = t.guid
             WHERE s.account_guid = ANY($1::text[])
               AND t.post_date >= NOW() - INTERVAL '400 days'
               AND t.description IS NOT NULL AND btrim(t.description) <> ''
             GROUP BY t.description
             ORDER BY SUM(ABS(s.value_num::numeric / NULLIF(s.value_denom, 0))) DESC NULLS LAST, t.description
             LIMIT ${DESCRIPTION_LIMIT}`,
            [accountGuids],
        ),
        query(
            `SELECT DISTINCT c.mnemonic, c.fullname
             FROM accounts a
             JOIN commodities c ON c.guid = a.commodity_guid
             WHERE a.guid = ANY($1::text[])
               AND c.namespace NOT IN ('CURRENCY', 'template')
             ORDER BY c.mnemonic`,
            [accountGuids],
        ),
    ]);
    return {
        accounts: accounts.rows as NamesSource['accounts'],
        descriptions: descriptions.rows as NamesSource['descriptions'],
        commodities: commodities.rows as NamesSource['commodities'],
    };
}
