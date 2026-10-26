/**
 * Advanced (multiple splits) mode, GnuCash-register style:
 *  - the ledger's own account is seeded on the first line, and that seed is
 *    part of the pristine baseline (switching modes is not an edit);
 *  - a partial Simple entry carries over when switching;
 *  - while the rows do not balance, a trailing placeholder row shows the
 *    amount still needed, and picking an account there adds the balancing
 *    split (the placeholder then disappears);
 *  - every real row has "balance with this split" (button and `b`);
 *  - ArrowUp/ArrowDown walk a column.
 */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionForm, type TransactionFormHandle } from '../TransactionForm';

vi.mock('@/components/ui/AccountSelector', () => ({
    AccountSelector: (props: {
        value: string;
        onChange: (guid: string, name: string) => void;
        placeholder?: string;
        onArrowUp?: () => void;
        onArrowDown?: () => void;
    }) => (
        <input
            aria-label={`account:${props.placeholder}`}
            value={props.value}
            onChange={e => props.onChange(e.target.value, `Account ${e.target.value.slice(0, 4)}`)}
            onKeyDown={e => {
                if (e.key === 'ArrowDown') props.onArrowDown?.();
                if (e.key === 'ArrowUp') props.onArrowUp?.();
            }}
        />
    ),
}));

vi.mock('@/components/ui/DescriptionAutocomplete', () => ({
    DescriptionAutocomplete: (props: { value: string; onChange: (v: string) => void }) => (
        <input aria-label="Description" value={props.value} onChange={e => props.onChange(e.target.value)} />
    ),
}));

const CHECKING = 'bbb0000000000000000000000000001';
const GROCERIES = 'ccc0000000000000000000000000001';
const FUEL = 'ddd0000000000000000000000000001';
const USD = 'usd0000000000000000000000000001';

vi.mock('@/lib/hooks/useAccounts', () => ({
    useAccounts: () => ({
        data: [
            { guid: 'bbb0000000000000000000000000001', name: 'Checking', fullname: 'Assets:Checking', commodity_guid: 'usd0000000000000000000000000001', commodity_mnemonic: 'USD', commodity_scu: 100 },
            { guid: 'ccc0000000000000000000000000001', name: 'Groceries', fullname: 'Expenses:Groceries', commodity_guid: 'usd0000000000000000000000000001', commodity_mnemonic: 'USD', commodity_scu: 100 },
            { guid: 'ddd0000000000000000000000000001', name: 'Fuel', fullname: 'Expenses:Fuel', commodity_guid: 'usd0000000000000000000000000001', commodity_mnemonic: 'USD', commodity_scu: 100 },
        ],
        isLoading: false,
    }),
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
    useUserPreferences: () => ({ defaultTaxRate: 0, dateFormat: 'MM/DD/YYYY' }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/hooks/useFormKeyboardShortcuts', () => ({ useFormKeyboardShortcuts: () => {} }));
vi.mock('@/lib/hooks/useKeyboardShortcut', () => ({ useKeyboardShortcut: () => {} }));

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/accounts/') && url.endsWith('/info')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ commodity_guid: USD }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ guid: USD, mnemonic: 'USD' }]) });
    }));
});

function renderAdvanced(props: { defaultFromAccount?: string; defaultToAccount?: string } = {}) {
    const ref = createRef<TransactionFormHandle>();
    render(<TransactionForm ref={ref} onSave={vi.fn()} onCancel={() => {}} defaultCurrencyGuid={USD} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Advanced (Multiple Splits)' }));
    return ref;
}

const realAccountInputs = () => screen.getAllByLabelText('account:Select account...') as HTMLInputElement[];
const placeholderAccountInput = () => screen.queryByLabelText('account:Add a split...') as HTMLInputElement | null;
const debits = () => screen.getAllByPlaceholderText('Debit') as HTMLInputElement[];
const credits = () => screen.getAllByPlaceholderText('Credit') as HTMLInputElement[];

describe('seeding', () => {
    it('puts the ledger account on the first row and the preset destination on the second', () => {
        renderAdvanced({ defaultFromAccount: CHECKING, defaultToAccount: GROCERIES });
        const accounts = realAccountInputs();
        expect(accounts[0].value).toBe(CHECKING);
        expect(accounts[1].value).toBe(GROCERIES);
    });

    it('does not count the seed, or the switch itself, as an edit', () => {
        const ref = renderAdvanced({ defaultFromAccount: CHECKING });
        expect(ref.current!.isDirty()).toBe(false);
    });

    it('carries a partial Simple entry (amount + from account) into the first row', () => {
        const ref = createRef<TransactionFormHandle>();
        render(<TransactionForm ref={ref} onSave={vi.fn()} onCancel={() => {}} defaultCurrencyGuid={USD} defaultFromAccount={CHECKING} />);
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '42' } });
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Advanced (Multiple Splits)' }));

        expect(realAccountInputs()[0].value).toBe(CHECKING);
        expect(credits()[0].value).toBe('42.00');
        expect(debits()[0].value).toBe('');
        // Typed work survived, so this IS an edit now.
        expect(ref.current!.isDirty()).toBe(true);
    });
});

describe('placeholder balancing row', () => {
    it('is absent while the rows balance and appears with the amount still needed', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        expect(placeholderAccountInput()).toBeNull();

        fireEvent.change(credits()[0], { target: { value: '100' } });

        const placeholder = placeholderAccountInput();
        expect(placeholder).not.toBeNull();
        // The placeholder is the last row: its Debit box carries the 100 still needed.
        expect(debits()[debits().length - 1].value).toBe('100.00');
    });

    it('picking an account on it adds the balancing split and the placeholder goes away', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        const realRowsBefore = realAccountInputs().length;

        fireEvent.change(placeholderAccountInput()!, { target: { value: GROCERIES } });

        expect(placeholderAccountInput()).toBeNull();
        const accounts = realAccountInputs();
        expect(accounts).toHaveLength(realRowsBefore + 1);
        expect(accounts[accounts.length - 1].value).toBe(GROCERIES);
        expect(debits()[debits().length - 1].value).toBe('100.00');
    });

    it('typing an amount on it starts a row from that amount instead', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });

        fireEvent.change(debits()[debits().length - 1], { target: { value: '60' } });

        // 60 of the 100 is now a real row; 40 remains on a fresh placeholder.
        const realDebits = debits().slice(0, -1);
        expect(realDebits[realDebits.length - 1].value).toBe('60');
        expect(placeholderAccountInput()).not.toBeNull();
        expect(debits()[debits().length - 1].value).toBe('40.00');
    });

    it('is a shared row in the dirty check only once promoted', () => {
        const ref = renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        expect(ref.current!.isDirty()).toBe(true);
    });
});

describe('balance with this split', () => {
    it('offers the button only while unbalanced, and sets the row to the balancing amount', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        expect(screen.queryAllByRole('button', { name: 'Balance with this split' })).toHaveLength(0);

        fireEvent.change(credits()[0], { target: { value: '100' } });
        fireEvent.change(realAccountInputs()[1], { target: { value: GROCERIES } });
        const buttons = screen.getAllByRole('button', { name: 'Balance with this split' });
        // One per real row, none on the placeholder.
        expect(buttons).toHaveLength(2);

        fireEvent.click(buttons[1]);

        expect(debits()[1].value).toBe('100.00');
        expect(credits()[1].value).toBe('');
        expect(placeholderAccountInput()).toBeNull();
        expect(screen.queryAllByRole('button', { name: 'Balance with this split' })).toHaveLength(0);
    });

    it('replaces whatever the row held, in the direction that balances', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        fireEvent.change(realAccountInputs()[1], { target: { value: GROCERIES } });
        fireEvent.change(credits()[1], { target: { value: '25' } });

        fireEvent.click(screen.getAllByRole('button', { name: 'Balance with this split' })[1]);

        expect(debits()[1].value).toBe('100.00');
        expect(credits()[1].value).toBe('');
    });

    it('`b` in an amount field does the same', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        fireEvent.change(realAccountInputs()[1], { target: { value: GROCERIES } });

        fireEvent.keyDown(debits()[1], { key: 'b' });

        expect(debits()[1].value).toBe('100.00');
    });

    it('splits a three-way entry correctly', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        fireEvent.change(realAccountInputs()[1], { target: { value: GROCERIES } });
        fireEvent.change(debits()[1], { target: { value: '30' } });
        fireEvent.change(placeholderAccountInput()!, { target: { value: FUEL } });

        expect(debits()[2].value).toBe('70.00');
        expect(placeholderAccountInput()).toBeNull();
    });
});

describe('arrow navigation', () => {
    it('ArrowDown in Debit moves to the next row\'s Debit, including the placeholder', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        fireEvent.change(credits()[0], { target: { value: '100' } });
        const rows = debits();
        expect(rows).toHaveLength(3); // two real rows + placeholder

        rows[0].focus();
        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(rows[1]);

        fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(rows[2]);

        // Past the end: stays put.
        fireEvent.keyDown(rows[2], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(rows[2]);
    });

    it('ArrowUp in Memo moves to the previous row\'s Memo and stops at the top', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        const memos = screen.getAllByPlaceholderText('Memo') as HTMLInputElement[];
        memos[1].focus();
        fireEvent.keyDown(memos[1], { key: 'ArrowUp' });
        expect(document.activeElement).toBe(memos[0]);
        fireEvent.keyDown(memos[0], { key: 'ArrowUp' });
        expect(document.activeElement).toBe(memos[0]);
    });

    it('the account picker walks the column too', () => {
        renderAdvanced({ defaultFromAccount: CHECKING });
        const accounts = realAccountInputs();
        accounts[0].focus();
        fireEvent.keyDown(accounts[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(accounts[1]);
    });
});
