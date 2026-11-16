/**
 * Receipt auto-matching.
 *
 * The receipt inbox ranks candidate transactions and waits for a click. For
 * the common case that is busywork: a utility bill was uploaded, its amount
 * and provider were read off the page, and exactly one payment for that
 * amount exists in the account that utility is always paid from. This module
 * links those without asking, and leaves everything ambiguous in the inbox.
 *
 * `chooseAutoMatch` is the pure decision; `autoMatchReceipts` loads the data,
 * applies it and records why on the receipt (`extracted_data.auto_match`), so
 * a link nobody clicked is still explainable and can be undone from the
 * receipt like any other.
 *
 * A link is made only when exactly one transaction qualifies. Two candidates
 * for the same amount are a question for a person.
 */

import { query } from '@/lib/db';
import { linkReceipt, updateExtractedData } from '@/lib/receipts';
import { scoreVendor } from '@/lib/receipt-matching';
import { sameMerchant } from '@/lib/merchant-identity';
import { MONEY_DISPLAY_EPSILON } from '@/lib/tolerances';
import type { UtilityType } from '@/lib/resilience/types';

export interface AutoMatchReceipt {
  id: number;
  /** Amounts the receipt could have been paid as (amount due, bill total). */
  amounts: number[];
  /** Date printed on the receipt (YYYY-MM-DD), when one was read. */
  date: string | null;
  vendor: string | null;
  /** Set when the receipt parsed as a utility bill. */
  utilityType: UtilityType | null;
  /** Candidates the user already rejected for this receipt. */
  dismissedGuids: string[];
}

export interface AutoMatchCandidate {
  guid: string;
  description: string;
  /** YYYY-MM-DD */
  postDate: string;
  /** Absolute value of every split, in dollars. */
  amounts: number[];
  /** Non-asset accounts the transaction posts to. */
  accounts: Array<{ guid: string; path: string }>;
}

export type AutoMatchReason = 'utility-account' | 'utility-vendor' | 'vendor-date';

export interface AutoMatchDecision {
  guid: string;
  reason: AutoMatchReason;
}

/** A utility bill is paid after it is issued: days before / after the bill date. */
export const UTILITY_WINDOW_DAYS = { before: 5, after: 45 };
/** An ordinary receipt is printed at the moment of the charge. */
export const RECEIPT_WINDOW_DAYS = 3;

const UTILITY_ACCOUNT_WORDS: Record<UtilityType, RegExp> = {
  electric: /electric|power|energy|utilit/i,
  gas: /\bgas\b|natural gas|energy|utilit/i,
  water: /water|sewer|utilit/i,
  propane: /propane|\blp\b|heating|fuel|utilit/i,
};

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

function amountMatches(candidate: AutoMatchCandidate, amounts: number[]): boolean {
  return candidate.amounts.some(value => amounts.some(amount => Math.abs(value - amount) < MONEY_DISPLAY_EPSILON));
}

function vendorMatches(vendor: string | null, description: string): boolean {
  if (!vendor) return false;
  return scoreVendor(vendor, description) > 0 || sameMerchant(vendor, description);
}

/**
 * Pick the one transaction a receipt certainly belongs to, or null.
 *
 * Utility bill: exact amount, posted from 5 days before to 45 days after the
 * bill date, and corroborated by where it was booked (an account this utility
 * type has been paid from before, or one named for it) or by the provider
 * name. Account corroboration is tried first because it survives a bank
 * description that looks nothing like the provider's letterhead.
 *
 * Any other receipt: exact amount, within 3 days, and the vendor matches.
 */
export function chooseAutoMatch(
  receipt: AutoMatchReceipt,
  candidates: AutoMatchCandidate[],
  options: { knownUtilityAccounts?: ReadonlySet<string> } = {},
): AutoMatchDecision | null {
  if (!receipt.date || receipt.amounts.length === 0) return null;
  const receiptDay = dayNumber(receipt.date);
  if (!Number.isFinite(receiptDay)) return null;
  const dismissed = new Set(receipt.dismissedGuids);

  const inWindow = (candidate: AutoMatchCandidate, before: number, after: number) => {
    const offset = dayNumber(candidate.postDate) - receiptDay;
    return offset >= -before && offset <= after;
  };
  const exact = candidates.filter(candidate =>
    !dismissed.has(candidate.guid) && amountMatches(candidate, receipt.amounts));
  const only = (list: AutoMatchCandidate[], reason: AutoMatchReason): AutoMatchDecision | null =>
    list.length === 1 ? { guid: list[0].guid, reason } : null;

  if (receipt.utilityType) {
    const type = receipt.utilityType;
    const window = exact.filter(candidate =>
      inWindow(candidate, UTILITY_WINDOW_DAYS.before, UTILITY_WINDOW_DAYS.after));
    const known = options.knownUtilityAccounts ?? new Set<string>();
    const byAccount = window.filter(candidate => candidate.accounts.some(account =>
      known.has(account.guid) || UTILITY_ACCOUNT_WORDS[type].test(account.path)));
    if (byAccount.length > 0) return only(byAccount, 'utility-account');
    return only(window.filter(candidate => vendorMatches(receipt.vendor, candidate.description)), 'utility-vendor');
  }

  return only(
    exact.filter(candidate =>
      inWindow(candidate, RECEIPT_WINDOW_DAYS, RECEIPT_WINDOW_DAYS)
      && vendorMatches(receipt.vendor, candidate.description)),
    'vendor-date',
  );
}

interface ReceiptRow {
  id: number;
  ocr_text: string | null;
  extracted_data: Record<string, unknown> | null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function positive(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Link every unlinked receipt that has exactly one certain transaction.
 * Returns the number linked. Safe to call often: it only reads unlinked
 * receipts whose text has been extracted, and never re-links.
 */
export async function autoMatchReceipts(
  bookGuid: string,
  bookAccountGuids: string[],
): Promise<{ examined: number; linked: number }> {
  if (bookAccountGuids.length === 0) return { examined: 0, linked: 0 };
  const receiptResult = await query(
    `SELECT id, ocr_text, extracted_data
       FROM gnucash_web_receipts
      WHERE book_guid = $1
        AND transaction_guid IS NULL
        AND extracted_data IS NOT NULL
        AND extracted_data->>'amount' IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100`,
    [bookGuid],
  );
  const rows = receiptResult.rows as ReceiptRow[];
  if (rows.length === 0) return { examined: 0, linked: 0 };

  // Utilities context: which receipts are utility bills, and which accounts
  // each utility type has been paid from before.
  const { getResilienceProfile } = await import('@/lib/resilience/service');
  const { parseUtilityBillText } = await import('@/lib/resilience/p3-core');
  let bills: Array<{
    type: UtilityType;
    totalCost: number;
    otherCost?: number | null;
    transactionGuid?: string | null;
    receiptId?: number | null;
  }> = [];
  try {
    bills = (await getResilienceProfile(bookGuid, 'utilities')).bills;
  } catch (error) {
    console.warn('Receipt auto-match: utilities profile unavailable:', error);
  }
  const billByReceipt = new Map(bills.flatMap(bill => bill.receiptId ? [[bill.receiptId, bill] as const] : []));

  const knownByType = new Map<UtilityType, Set<string>>();
  const paidBills = bills.filter(bill => bill.transactionGuid || bill.receiptId);
  if (paidBills.length > 0) {
    const accountResult = await query(
      `SELECT x.tx_guid, x.receipt_id, s.account_guid
         FROM (
           SELECT r.transaction_guid AS tx_guid, r.id AS receipt_id
             FROM gnucash_web_receipts r
            WHERE r.book_guid = $1 AND r.id = ANY($2::int[]) AND r.transaction_guid IS NOT NULL
           UNION ALL
           SELECT g AS tx_guid, NULL::int AS receipt_id FROM unnest($3::text[]) AS g
         ) x
         JOIN splits s ON s.tx_guid = x.tx_guid
         JOIN accounts a ON a.guid = s.account_guid
        WHERE a.account_type = 'EXPENSE' AND s.account_guid = ANY($4::text[])`,
      [
        bookGuid,
        paidBills.flatMap(bill => bill.receiptId ? [bill.receiptId] : []),
        paidBills.flatMap(bill => bill.transactionGuid ? [bill.transactionGuid] : []),
        bookAccountGuids,
      ],
    );
    const typeByTx = new Map(paidBills.flatMap(bill => bill.transactionGuid ? [[bill.transactionGuid, bill.type] as const] : []));
    for (const row of accountResult.rows as Array<{ tx_guid: string; receipt_id: number | null; account_guid: string }>) {
      const type = (row.receipt_id !== null ? billByReceipt.get(row.receipt_id)?.type : undefined) ?? typeByTx.get(row.tx_guid);
      if (!type) continue;
      const accounts = knownByType.get(type) ?? new Set<string>();
      accounts.add(row.account_guid);
      knownByType.set(type, accounts);
    }
  }

  const receipts: Array<AutoMatchReceipt & { extracted: Record<string, unknown>; directGuid: string | null }> = [];
  for (const row of rows) {
    const extracted = row.extracted_data ?? {};
    const vendor = typeof extracted.vendor === 'string' ? extracted.vendor.trim() || null : null;
    const date = isoDateOrNull(extracted.date);
    const recorded = billByReceipt.get(row.id);
    const parsed = recorded ?? (row.ocr_text && date
      ? parseUtilityBillText({ receiptId: row.id, date, provider: vendor ?? 'Utility provider', text: row.ocr_text })
      : null);
    const amounts = [
      positive(extracted.amount),
      parsed ? positive(parsed.totalCost + (parsed.otherCost ?? 0)) : null,
      parsed ? positive(parsed.totalCost) : null,
    ].filter((amount): amount is number => amount !== null);
    receipts.push({
      id: row.id,
      amounts: [...new Set(amounts.map(amount => Math.round(amount * 100) / 100))],
      date,
      vendor,
      utilityType: parsed?.type ?? null,
      dismissedGuids: Array.isArray(extracted.dismissed_guids)
        ? extracted.dismissed_guids.filter((guid): guid is string => typeof guid === 'string')
        : [],
      extracted,
      directGuid: recorded?.transactionGuid ?? null,
    });
  }

  const dated = receipts.filter(receipt => receipt.date);
  let candidates: AutoMatchCandidate[] = [];
  if (dated.length > 0) {
    const days = dated.map(receipt => dayNumber(receipt.date!));
    const from = new Date((Math.min(...days) - UTILITY_WINDOW_DAYS.before) * 86_400_000).toISOString().slice(0, 10);
    const to = new Date((Math.max(...days) + UTILITY_WINDOW_DAYS.after) * 86_400_000).toISOString().slice(0, 10);
    const candidateResult = await query(
      `SELECT t.guid, t.description, t.post_date::date::text AS post_date,
              ABS(s.value_num::numeric / NULLIF(s.value_denom, 0))::float8 AS amount,
              a.guid AS account_guid, a.account_type,
              COALESCE(ah.fullname, a.name) AS account_path
         FROM transactions t
         JOIN splits s ON s.tx_guid = t.guid
         JOIN accounts a ON a.guid = s.account_guid
         LEFT JOIN account_hierarchy ah ON ah.guid = a.guid
        WHERE t.post_date >= $1::date AND t.post_date < ($2::date + INTERVAL '1 day')
          AND s.account_guid = ANY($3::text[])
          AND NOT EXISTS (
            SELECT 1 FROM gnucash_web_receipts r
             WHERE r.book_guid = $4 AND r.transaction_guid = t.guid
          )`,
      [from, to, bookAccountGuids, bookGuid],
    );
    const byGuid = new Map<string, AutoMatchCandidate>();
    for (const row of candidateResult.rows as Array<{
      guid: string;
      description: string | null;
      post_date: string;
      amount: number | null;
      account_guid: string;
      account_type: string;
      account_path: string;
    }>) {
      const candidate = byGuid.get(row.guid) ?? {
        guid: row.guid,
        description: row.description ?? '',
        postDate: row.post_date,
        amounts: [],
        accounts: [],
      };
      if (row.amount !== null) candidate.amounts.push(Number(row.amount));
      if (row.account_type === 'EXPENSE') candidate.accounts.push({ guid: row.account_guid, path: row.account_path });
      byGuid.set(row.guid, candidate);
    }
    candidates = [...byGuid.values()];
  }

  let linked = 0;
  const taken = new Set<string>();
  for (const receipt of receipts) {
    const available = candidates.filter(candidate => !taken.has(candidate.guid));
    const decision: { guid: string; reason: string } | null = receipt.directGuid
      ? { guid: receipt.directGuid, reason: 'utility-bill-link' }
      : chooseAutoMatch(receipt, available, {
          knownUtilityAccounts: receipt.utilityType ? knownByType.get(receipt.utilityType) : undefined,
        });
    if (!decision || taken.has(decision.guid)) continue;
    try {
      const result = await linkReceipt(receipt.id, bookGuid, decision.guid);
      if (!result) continue;
      taken.add(decision.guid);
      linked += 1;
      await updateExtractedData(receipt.id, {
        ...receipt.extracted,
        auto_match: {
          transaction_guid: decision.guid,
          reason: decision.reason,
          matched_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.warn(`Receipt auto-match failed for receipt ${receipt.id}:`, error);
    }
  }
  return { examined: receipts.length, linked };
}
