import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeInventoryPage from './page';

const { toastMock, routerMock, searchParamsMock } = vi.hoisted(() => ({
    toastMock: { success: vi.fn(), error: vi.fn() },
    routerMock: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
    searchParamsMock: { current: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => routerMock,
    useSearchParams: () => searchParamsMock.current,
}));
vi.mock('@/contexts/ToastContext', () => ({
    useToast: () => toastMock,
}));
vi.mock('@/components/home/RoomDetailPanel', () => ({
    RoomDetailPanel: ({ room, onBack }: { room: { name: string }; onBack: () => void }) => (
        <div>
            <p>Room panel: {room.name}</p>
            <button type="button" onClick={onBack}>
                All rooms
            </button>
        </div>
    ),
}));

const SUMMARY = {
    rooms: [
        { id: 1, name: 'Kitchen', sortOrder: 0, itemCount: 3, totalValue: 1200 },
        { id: 2, name: 'Garage', sortOrder: 1, itemCount: 1, totalValue: 400 },
    ],
    totalValue: 1600,
    totalItems: 4,
    draftItems: 0,
    warrantyExpired: [
        { itemId: 10, itemName: 'Toaster', roomId: 1, warrantyExpires: '2026-01-02', daysUntil: -300 },
    ],
    warrantyExpiringSoon: [
        { itemId: 11, itemName: 'Drill', roomId: 2, warrantyExpires: '2026-12-01', daysUntil: 25 },
    ],
    warrantyWarningDays: 90,
    tasksOverdue: 0,
    tasksDueSoon: 0,
};

beforeEach(() => {
    searchParamsMock.current = new URLSearchParams();
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
            Promise.resolve({
                ok: url === '/api/home/summary',
                json: () => Promise.resolve(url === '/api/home/summary' ? SUMMARY : null),
            } as Response),
        ),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('Home Inventory', () => {
    it('opens a room through the URL so Back returns to the room list', async () => {
        render(<HomeInventoryPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Garage/ }));
        expect(routerMock.push).toHaveBeenCalledWith('/home/inventory?room=2', { scroll: false });
    });

    it('renders the room named in ?room= and pops back to the list', async () => {
        searchParamsMock.current = new URLSearchParams('room=1');
        render(<HomeInventoryPage />);
        expect(await screen.findByText('Room panel: Kitchen')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'All rooms' }));
        // Arrived by deep link: nothing of ours to pop, so replace instead of back.
        expect(routerMock.replace).toHaveBeenCalledWith('/home/inventory', { scroll: false });
        expect(routerMock.back).not.toHaveBeenCalled();
    });

    it('labels expired and expiring warranties in words, not just colour', async () => {
        render(<HomeInventoryPage />);
        expect(await screen.findByText('Warranty expired')).toBeInTheDocument();
        expect(screen.getByText('Warranty ending within 90 days')).toBeInTheDocument();
        expect(screen.getByText('in 25d')).toBeInTheDocument();
    });
});
