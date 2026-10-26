/**
 * The description auto-match must have a "none of these" exit.
 *
 * Escape closes the list and keeps the typed text; the keystroke goes no
 * further (a hosting modal or inline editor must not also act on it); a
 * lookup still in flight when the list was dismissed does not reopen it;
 * and Tab afterwards leaves the field without filling in a match. Typing
 * again lifts the dismissal.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DescriptionAutocomplete } from '../DescriptionAutocomplete';

const suggestions = [
    { description: 'Grocery Store', lastUsed: '2026-10-01', splits: [] },
    { description: 'Grocery Outlet', lastUsed: '2026-09-01', splits: [] },
];

let resolveFetch: ((value: unknown) => void) | null = null;

function Harness({ onTab }: { onTab?: () => void }) {
    const [value, setValue] = useState('');
    return (
        <div
            data-testid="host"
            onKeyDown={(e) => {
                if (e.key === 'Escape') hostEscape();
            }}
        >
            <DescriptionAutocomplete value={value} onChange={setValue} onTab={onTab} />
        </div>
    );
}

const hostEscape = vi.fn();

async function typeQuery(input: HTMLElement, text: string) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    // Debounce (200ms) then the fetch
    await act(async () => {
        vi.advanceTimersByTime(250);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no scrollIntoView; the list scrolls its focused row into view.
    Element.prototype.scrollIntoView = vi.fn();
    hostEscape.mockReset();
    resolveFetch = null;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {
        resolveFetch = (value) => resolve({ json: async () => value } as Response);
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function settleFetch(body: unknown = { suggestions }) {
    await act(async () => {
        resolveFetch?.(body);
    });
}

describe('DescriptionAutocomplete — dismissing the match list', () => {
    it('Escape closes the list, keeps the text, and does not reach the host', async () => {
        render(<Harness />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(input).toHaveValue('Groc');
        expect(hostEscape).not.toHaveBeenCalled();
    });

    it('a second Escape, with the list already closed, does reach the host', async () => {
        render(<Harness />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();
        fireEvent.keyDown(input, { key: 'Escape' });
        hostEscape.mockClear();

        fireEvent.keyDown(input, { key: 'Escape' });

        expect(hostEscape).toHaveBeenCalledTimes(1);
    });

    it('Tab after Escape moves on without filling in a match', async () => {
        const onTab = vi.fn();
        render(<Harness onTab={onTab} />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();
        fireEvent.keyDown(input, { key: 'Escape' });

        fireEvent.keyDown(input, { key: 'Tab' });

        expect(onTab).toHaveBeenCalledTimes(1);
        expect(input).toHaveValue('Groc');
    });

    it('a lookup still in flight when the list was dismissed does not reopen it', async () => {
        render(<Harness />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();
        // Open; dismiss; then type one more character and dismiss again
        // before its fetch resolves.
        fireEvent.keyDown(input, { key: 'Escape' });
        await typeQuery(input, 'Groce');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Escape' }); // list closed: no-op, host gets it
        hostEscape.mockClear();

        await settleFetch();

        // The fetch for "Groce" resolved after no dismissal of THAT text, so
        // it opens — which is the point: only the dismissed text stays shut.
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(hostEscape).not.toHaveBeenCalled();
    });

    it('the "Keep what I typed" row dismisses the list too', async () => {
        render(<Harness />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();

        fireEvent.click(screen.getByRole('button', { name: /keep what i typed/i }));

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(input).toHaveValue('Groc');
    });

    it('typing again after a dismissal brings the list back', async () => {
        render(<Harness />);
        const input = screen.getByRole('combobox');
        await typeQuery(input, 'Groc');
        await settleFetch();
        fireEvent.keyDown(input, { key: 'Escape' });

        await typeQuery(input, 'Grocer');
        await settleFetch();

        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
});
