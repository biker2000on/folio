/**
 * The journal's inline split editor: "balance with this split" on every
 * real row while the rows do not balance (button and `b`), mirroring the
 * transaction modal.
 */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Split } from '@/lib/types';
import EditableSplitRows, { type EditableSplitRowsHandle } from '../EditableSplitRows';
import type { AccountTransaction } from '@/components/AccountLedger';

vi.mock('@/contexts/UserPreferencesContext', () => ({
    useUserPreferences: () => ({ balanceReversal: 'none', dateFormat: 'MM/DD/YYYY', defaultTaxRate: 0 }),
}));
vi.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../cells/AccountCell', () => ({
    AccountCell: (props: { value: string; onChange: (guid: string, name: string) => void }) => (
        <input aria-label="Account" value={props.value} onChange={e => props.onChange(e.target.value, e.target.value)} />
    ),
}));

const CASH_GUID = 'cash0000000000000000000000000001';
const GROCERIES_GUID = 'groc0000000000000000000000000001';

function makeSplit(overrides: Partial<Split>): Split {
    return {
        guid: 'split000000000000000000000000001',
        tx_guid: 'tx00000000000000000000000000001',
        account_guid: CASH_GUID,
        memo: '',
        action: '',
        reconcile_state: 'n',
        reconcile_date: null,
        value_num: 0,
        value_denom: 100,
        quantity_num: 0,
        quantity_denom: 100,
        lot_guid: null,
        ...overrides,
    };
}

const CASH_SPLIT = makeSplit({
    account_guid: CASH_GUID, account_name: 'Checking', account_fullname: 'Assets:Checking',
    value_num: -5000, quantity_num: -5000, value_decimal: '-50.00', quantity_decimal: '-50.00', commodity_mnemonic: 'USD',
});
const GROCERIES_SPLIT = makeSplit({
    guid: 'split000000000000000000000000002',
    account_guid: GROCERIES_GUID, account_name: 'Groceries', account_fullname: 'Expenses:Groceries',
    value_num: 5000, quantity_num: 5000, value_decimal: '50.00', quantity_decimal: '50.00', commodity_mnemonic: 'USD',
});

const transaction = {
    guid: 'tx00000000000000000000000000001',
    currency_guid: 'usd0000000000000000000000000001',
    post_date: new Date('2026-10-20T00:00:00Z'),
    description: 'Market',
    splits: [CASH_SPLIT, GROCERIES_SPLIT],
    running_balance: '0',
    account_split_value: '-50.00',
    commodity_mnemonic: 'USD',
    account_split_guid: CASH_SPLIT.guid,
    account_split_reconcile_state: 'n',
} as AccountTransaction;

function renderRows(focusedColumnIndex = 3) {
    const ref = createRef<EditableSplitRowsHandle>();
    render(
        <table><tbody>
            <EditableSplitRows
                ref={ref}
                transaction={transaction}
                accountGuid={CASH_GUID}
                columns={6}
                isActive={true}
                focusedSplitIndex={0}
                focusedColumnIndex={focusedColumnIndex}
            />
        </tbody></table>,
    );
    return ref;
}

const balanceButtons = () => screen.queryAllByRole('button', { name: 'Balance with this split' });

describe('journal split rows — balance with this split', () => {
    it('shows no balance button while the rows balance', () => {
        renderRows();
        expect(balanceButtons()).toHaveLength(0);
    });

    it('offers it on every real row once unbalanced, and clicking balances that row', () => {
        const ref = renderRows();
        // Row 0 (Checking) is focused: its credit box shows 50.00.
        const credit = screen.getByDisplayValue('50.00') as HTMLInputElement;
        fireEvent.change(credit, { target: { value: '20' } });

        expect(balanceButtons()).toHaveLength(2); // the two real rows, not the placeholder

        fireEvent.click(balanceButtons()[0]);

        const payload = ref.current!.getSplitPayload();
        expect(payload.reduce((sum, s) => sum + s.value_num / s.value_denom, 0)).toBe(0);
        expect(payload.find(s => s.account_guid === CASH_GUID)!.value_num).toBe(-5000);
        expect(balanceButtons()).toHaveLength(0);
    });

    it('`b` in the focused amount box balances that row', () => {
        const ref = renderRows();
        const credit = screen.getByDisplayValue('50.00') as HTMLInputElement;
        fireEvent.change(credit, { target: { value: '20' } });

        fireEvent.keyDown(credit, { key: 'b' });

        const payload = ref.current!.getSplitPayload();
        expect(payload.find(s => s.account_guid === CASH_GUID)!.value_num).toBe(-5000);
    });
});
