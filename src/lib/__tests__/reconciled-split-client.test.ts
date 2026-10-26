import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DECLINED_CODE,
    describeReconciledAccounts,
    fetchWithUnreconcile,
    isReconciledSplitBody,
    readReconciledSplitError,
    withUnreconcileFlag,
    type ReconciledSplitErrorBody,
} from '../reconciled-split-client';

const blocked: ReconciledSplitErrorBody = {
    error: 'Cannot edit this transaction: split 1 on Checking is reconciled.',
    code: 'RECONCILED_SPLIT',
    splits: [
        { guid: '1'.repeat(32), tx_guid: 't'.repeat(32), account_guid: 'a'.repeat(32), account_name: 'Checking', reconcile_state: 'y' },
    ],
};

function json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isReconciledSplitBody / readReconciledSplitError', () => {
    it('recognises the 423 RECONCILED_SPLIT shape and nothing else', () => {
        expect(isReconciledSplitBody(blocked)).toBe(true);
        expect(isReconciledSplitBody({ error: 'Period locked', code: 'PERIOD_LOCKED' })).toBe(false);
        expect(isReconciledSplitBody(null)).toBe(false);
    });

    it('reads the body without consuming the response', async () => {
        const res = json(blocked, 423);
        expect(await readReconciledSplitError(res)).toEqual(blocked);
        // Still readable by the caller's own error path.
        expect((await res.json()).code).toBe('RECONCILED_SPLIT');
    });

    it('is null for another 423 or any other status', async () => {
        expect(await readReconciledSplitError(json({ error: 'locked', code: 'PERIOD_LOCKED' }, 423))).toBeNull();
        expect(await readReconciledSplitError(json(blocked, 409))).toBeNull();
        expect(await readReconciledSplitError(new Response('<html>', { status: 423 }))).toBeNull();
    });
});

describe('describeReconciledAccounts', () => {
    it('names the accounts once each, joined for prose', () => {
        const two = { ...blocked, splits: [blocked.splits[0], { ...blocked.splits[0], guid: '2'.repeat(32), account_name: 'Savings' }, blocked.splits[0]] };
        expect(describeReconciledAccounts(blocked)).toBe('Checking');
        expect(describeReconciledAccounts(two)).toBe('Checking and Savings');
    });

    it('falls back to a count when names are missing', () => {
        const unnamed = { ...blocked, splits: [{ ...blocked.splits[0], account_name: null }] };
        expect(describeReconciledAccounts(unnamed)).toBe('a reconciled split');
    });
});

describe('withUnreconcileFlag', () => {
    it('merges the flag into a JSON body', () => {
        const out = withUnreconcileFlag('/api/transactions/x', { method: 'PUT', body: JSON.stringify({ description: 'd' }) });
        expect(out.url).toBe('/api/transactions/x');
        expect(JSON.parse(out.init.body as string)).toEqual({ description: 'd', unreconcile_protected: true });
    });

    it('appends a query param when there is no body (DELETE)', () => {
        expect(withUnreconcileFlag('/api/transactions/x', { method: 'DELETE' }).url).toBe('/api/transactions/x?unreconcile_protected=true');
        expect(withUnreconcileFlag('/api/transactions/x?original_enter_date=null', { method: 'DELETE' }).url)
            .toBe('/api/transactions/x?original_enter_date=null&unreconcile_protected=true');
    });
});

describe('fetchWithUnreconcile', () => {
    it('passes any non-RECONCILED_SPLIT response straight through without asking', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }, 200));
        vi.stubGlobal('fetch', fetchMock);
        const confirm = vi.fn();

        const res = await fetchWithUnreconcile('/api/transactions/x', { method: 'PUT', body: '{}' }, confirm);

        expect(res.status).toBe(200);
        expect(confirm).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('asks on 423 RECONCILED_SPLIT and resends with the flag on yes', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(json(blocked, 423))
            .mockResolvedValueOnce(json({ guid: 'x' }, 200));
        vi.stubGlobal('fetch', fetchMock);
        const confirm = vi.fn().mockResolvedValue(true);

        const res = await fetchWithUnreconcile(
            '/api/transactions/x',
            { method: 'PUT', body: JSON.stringify({ description: 'd' }) },
            confirm,
        );

        expect(res.status).toBe(200);
        expect(confirm).toHaveBeenCalledWith(blocked);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [, retryInit] = fetchMock.mock.calls[1];
        expect(JSON.parse(retryInit.body)).toEqual({ description: 'd', unreconcile_protected: true });
    });

    it('returns a declined 423 with the caller\'s wording on no, and does not resend', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(json(blocked, 423));
        vi.stubGlobal('fetch', fetchMock);

        const res = await fetchWithUnreconcile(
            '/api/transactions/x?original_enter_date=null',
            { method: 'DELETE' },
            async () => false,
            { declinedMessage: 'Not deleted.' },
        );
        const body = await res.json();

        expect(res.status).toBe(423);
        expect(body).toEqual({ error: 'Not deleted.', code: DECLINED_CODE });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
