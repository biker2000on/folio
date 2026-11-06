import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeTask } from '@/lib/services/home.service';
import HomeMaintenancePage from './page';

const { toastMock } = vi.hoisted(() => ({
    toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/ToastContext', () => ({
    useToast: () => toastMock,
}));

function task(overrides: Partial<HomeTask>): HomeTask {
    return {
        id: 1,
        name: 'Task',
        cadenceMonths: 12,
        season: null,
        seasonLabel: null,
        itemId: null,
        itemName: null,
        lastDone: null,
        active: true,
        notes: null,
        nextDue: null,
        daysUntilDue: null,
        status: 'due_soon',
        ...overrides,
    };
}

const TASKS: HomeTask[] = [
    // Never done, cadence only: the service files it as due_soon.
    task({ id: 1, name: 'Flush water heater', status: 'due_soon' }),
    // Genuinely due soon.
    task({
        id: 2,
        name: 'Clean dryer vent',
        lastDone: '2025-11-20',
        nextDue: '2026-11-20',
        daysUntilDue: 14,
        status: 'due_soon',
    }),
    task({
        id: 3,
        name: 'Test sump pump',
        cadenceMonths: null,
        season: 'spring',
        seasonLabel: 'Spring',
        nextDue: '2027-04-01',
        daysUntilDue: 146,
        status: 'later',
    }),
];

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];

function json(body: unknown, ok = true) {
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
    calls = [];
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
            calls.push({ url, init });
            if (url.startsWith('/api/home/tasks?')) return json({ tasks: TASKS });
            if (url === '/api/home/items') return json({ items: [] });
            if (url.startsWith('/api/home/service-log')) return json({ entries: [], ytdCost: 0 });
            if (url.startsWith('/api/home/tasks/')) return json({ ok: true });
            return json(null, false);
        }),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

async function renderPage() {
    render(<HomeMaintenancePage />);
    await screen.findByText('Flush water heater');
}

function group(name: RegExp) {
    return screen.getByRole('region', { name });
}

describe('Home Maintenance task list', () => {
    it('files never-done cadence tasks under "Needs a baseline", not "Due soon"', async () => {
        await renderPage();

        const baseline = group(/needs a baseline/i);
        const dueSoon = group(/due soon/i);
        expect(within(baseline).getByText('Flush water heater')).toBeInTheDocument();
        expect(within(dueSoon).queryByText('Flush water heater')).not.toBeInTheDocument();
        expect(within(dueSoon).getByText('Clean dryer vent')).toBeInTheDocument();
        // Plain styling: the baseline heading is not in the warning colour.
        expect(within(baseline).getByRole('heading').className).not.toMatch(/text-warning/);
        // No "never done" reading anywhere.
        expect(screen.queryByText(/never done/i)).not.toBeInTheDocument();
    });

    it('sets "last done" on a baseline task in one step', async () => {
        await renderPage();
        const baseline = group(/needs a baseline/i);
        const setButton = within(baseline).getByRole('button', { name: 'Set' });
        expect(setButton).toBeDisabled();

        fireEvent.change(within(baseline).getByLabelText('Last done'), {
            target: { value: '2026-05-01' },
        });
        expect(setButton).toBeEnabled();
        fireEvent.click(setButton);

        await waitFor(() => {
            const put = calls.find((c) => c.url === '/api/home/tasks/1' && c.init?.method === 'PUT');
            expect(put).toBeDefined();
            expect(JSON.parse(String(put!.init!.body))).toEqual({ lastDone: '2026-05-01' });
        });
    });

    it('shows one reading per row: the next due date', async () => {
        await renderPage();
        const dueSoon = group(/due soon/i);
        expect(within(dueSoon).getByText('Due 2026-11-20 · in 14d')).toBeInTheDocument();
        expect(within(dueSoon).queryByText(/2025-11-20/)).not.toBeInTheDocument();
    });

    it('keeps Mark done visible and moves the other row actions into an overflow menu', async () => {
        await renderPage();
        const dueSoon = group(/due soon/i);
        expect(within(dueSoon).getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
        for (const name of ['History', 'Edit', 'Pause', 'Delete…']) {
            expect(within(dueSoon).queryByRole('button', { name })).not.toBeInTheDocument();
        }

        const trigger = within(dueSoon).getByRole('button', { name: 'More actions for Clean dryer vent' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        for (const name of ['History', 'Edit', 'Pause', 'Delete…']) {
            expect(within(dueSoon).getByRole('menuitem', { name })).toBeInTheDocument();
        }
        // Focus enters the menu; Escape closes it and returns focus to the trigger.
        expect(within(dueSoon).getByRole('menuitem', { name: 'History' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
    });

    it('asks for confirmation before deleting from the overflow menu', async () => {
        await renderPage();
        const dueSoon = group(/due soon/i);
        fireEvent.click(within(dueSoon).getByRole('button', { name: 'More actions for Clean dryer vent' }));
        fireEvent.click(within(dueSoon).getByRole('menuitem', { name: 'Delete…' }));

        expect(within(dueSoon).getByText('Delete this task?')).toBeInTheDocument();
        expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);

        fireEvent.click(within(dueSoon).getByRole('button', { name: 'Delete' }));
        await waitFor(() =>
            expect(
                calls.some((c) => c.url === '/api/home/tasks/2' && c.init?.method === 'DELETE'),
            ).toBe(true),
        );
    });

    it('uses shared tabs and only offers "Add task" on the task list', async () => {
        await renderPage();
        expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
        // PageHeader renders the action twice (desktop + mobile placements).
        expect(screen.getAllByRole('button', { name: 'Add task' }).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('tab', { name: 'Service log' }));
        expect(screen.getByRole('tab', { name: 'Service log' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
    });

    it('ties every service-log label to its control and replaces the GUID field', async () => {
        await renderPage();
        fireEvent.click(screen.getByRole('tab', { name: 'Service log' }));
        for (const label of ['Date', 'Task (optional)', 'Item (optional)', 'Cost', 'Vendor', 'Notes']) {
            expect(screen.getByLabelText(label)).toBeInTheDocument();
        }
        expect(screen.queryByText(/guid/i)).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Linked transaction (optional)' })).toBeInTheDocument();
    });
});
