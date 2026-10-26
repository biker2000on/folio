/**
 * Client half of the reconciled-split guard.
 *
 * The transaction PUT and DELETE routes answer 423 with
 * `code: 'RECONCILED_SPLIT'` when a change would touch a split that has been
 * reconciled against a statement (see
 * `src/lib/services/reconciled-split.service.ts`). Instead of surfacing that
 * as a dead-end error, every ledger surface asks the user whether the split
 * may be unreconciled and, on yes, resends the same request with
 * `unreconcile_protected: true`, which the server honours by writing the
 * touched splits back as 'n' inside the same write.
 *
 * `fetchWithUnreconcile` is that whole loop in one call so each save/delete
 * path stays a one-liner. The confirmation itself is the UI's job
 * (`useUnreconcileConfirm` in `src/components/ui/UnreconcileConfirm.tsx`).
 */

export const RECONCILED_SPLIT_CODE = 'RECONCILED_SPLIT';

/** A split named in a 423 RECONCILED_SPLIT body. */
export interface ReconciledSplitRef {
    guid: string;
    tx_guid: string | null;
    account_guid: string | null;
    account_name: string | null;
    reconcile_state: 'y' | 'f';
}

export interface ReconciledSplitErrorBody {
    error: string;
    code: typeof RECONCILED_SPLIT_CODE;
    splits: ReconciledSplitRef[];
}

/** Narrow a parsed error body to the RECONCILED_SPLIT shape. */
export function isReconciledSplitBody(body: unknown): body is ReconciledSplitErrorBody {
    if (!body || typeof body !== 'object') return false;
    const record = body as Record<string, unknown>;
    return record.code === RECONCILED_SPLIT_CODE && Array.isArray(record.splits);
}

/**
 * Read a 423 RECONCILED_SPLIT body off a response without consuming it, so
 * the caller's own error reader still works when the user declines. Any
 * other status, or a 423 of another kind (period lock), yields null.
 */
export async function readReconciledSplitError(response: Response): Promise<ReconciledSplitErrorBody | null> {
    if (response.status !== 423) return null;
    try {
        const body: unknown = await response.clone().json();
        return isReconciledSplitBody(body) ? body : null;
    } catch {
        return null;
    }
}

/**
 * The accounts a RECONCILED_SPLIT body names, deduplicated and in order, for
 * the confirmation text. Falls back to a count when the server sent no names.
 */
export function describeReconciledAccounts(body: ReconciledSplitErrorBody): string {
    const names = [...new Set(body.splits.map(s => s.account_name).filter((n): n is string => Boolean(n)))];
    if (names.length === 0) {
        const n = body.splits.length;
        return n === 1 ? 'a reconciled split' : `${n} reconciled splits`;
    }
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** True when any named split is frozen rather than merely reconciled. */
export function hasFrozenSplit(body: ReconciledSplitErrorBody): boolean {
    return body.splits.some(s => s.reconcile_state === 'f');
}

/**
 * The same request with the confirmation flag attached: merged into a JSON
 * body when there is one, otherwise appended to the query string (DELETE).
 */
export function withUnreconcileFlag(url: string, init: RequestInit): { url: string; init: RequestInit } {
    if (typeof init.body === 'string') {
        let parsed: unknown;
        try {
            parsed = JSON.parse(init.body);
        } catch {
            parsed = null;
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                url,
                init: { ...init, body: JSON.stringify({ ...(parsed as object), unreconcile_protected: true }) },
            };
        }
    }
    const joiner = url.includes('?') ? '&' : '?';
    return { url: `${url}${joiner}unreconcile_protected=true`, init };
}

export const DECLINED_CODE = 'RECONCILED_SPLIT_DECLINED';

/**
 * The declined outcome, shaped like an API error so the caller's generic
 * error reader renders it. 423 keeps "not saved" semantics without pretending
 * the server refused anything the user did not choose.
 */
export function declinedUnreconcileResponse(message = 'Not saved. The reconciled split was left as it was.'): Response {
    return new Response(
        JSON.stringify({ error: message, code: DECLINED_CODE }),
        { status: 423, headers: { 'Content-Type': 'application/json' } },
    );
}

export interface FetchWithUnreconcileOptions {
    /** Error text when the user declines; defaults to the "not saved" wording. */
    declinedMessage?: string;
}

/**
 * `fetch` with the reconciled-split confirmation loop folded in.
 *
 * On a 423 RECONCILED_SPLIT the `confirm` callback is asked (it opens the
 * dialog and resolves with the user's answer). Yes → the request is resent
 * with the flag and that response is returned. No → a declined 423 is
 * returned so the caller's existing error path reports "not saved". Every
 * other response passes straight through.
 */
export async function fetchWithUnreconcile(
    url: string,
    init: RequestInit,
    confirm: (body: ReconciledSplitErrorBody) => Promise<boolean>,
    options: FetchWithUnreconcileOptions = {},
): Promise<Response> {
    const first = await fetch(url, init);
    const blocked = await readReconciledSplitError(first);
    if (!blocked) return first;
    const ok = await confirm(blocked);
    if (!ok) return declinedUnreconcileResponse(options.declinedMessage);
    const retry = withUnreconcileFlag(url, init);
    return fetch(retry.url, retry.init);
}
