import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MileagePage from './page';
import { applyTripPatch, localToday, newTripDefaults, rateNote } from './mileage-helpers';
import type { FuelProfile, MileageProfile, MileageTrip } from '@/lib/resilience/types';

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => toastMock,
}));

const fuelProfile: FuelProfile = {
  baseUrl: '',
  enabled: false,
  hasToken: false,
  lastSyncAt: null,
  vehicles: [],
  fillups: [],
} as unknown as FuelProfile;

function trip(overrides: Partial<MileageTrip>): MileageTrip {
  return {
    id: 'trip-1',
    date: `${new Date().getFullYear()}-03-04`,
    vehicleId: 'car-1',
    purpose: 'business',
    schedule: 'C',
    description: 'Client visit',
    miles: 1234.5,
    startOdometer: null,
    endOdometer: null,
    ...overrides,
  };
}

const truck = { id: 'car-1', name: 'Work truck', year: 2019, make: 'Toyota', model: 'Tacoma', fuelTrackerVehicleId: null };

function mockApi(mileage: MileageProfile | 'fail', fuel: FuelProfile | 'fail' = fuelProfile) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/mileage') ? mileage : fuel;
    if (body === 'fail') return new Response('nope', { status: 500 });
    return new Response(JSON.stringify({ profile: body }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  Object.values(toastMock).forEach(fn => fn.mockReset());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MileagePage', () => {
  it('titles the page to match the sidebar and shows a loading line first', async () => {
    mockApi({ vehicles: [], trips: [] });
    render(<MileagePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Mileage Log' })).toBeInTheDocument();
    expect(screen.getByText('Loading mileage log…')).toBeInTheDocument();
    await screen.findByText('Add your vehicle to start logging trips.');
    expect(screen.queryByText('Loading mileage log…')).not.toBeInTheDocument();
  });

  it('renders a retryable error and no editors when the log fails to load', async () => {
    const fetchMock = mockApi('fail');
    render(<MileagePage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the mileage log");
    expect(screen.queryByRole('button', { name: /log trip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();

    mockApi({ vehicles: [truck], trips: [] });
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findAllByRole('button', { name: 'Log trip' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('with no vehicle, disables Log trip with a visible reason and leads with Add your vehicle', async () => {
    mockApi({ vehicles: [], trips: [] });
    render(<MileagePage />);
    await screen.findByText('Add your vehicle to start logging trips.');
    const logButtons = screen.getAllByRole('button', { name: 'Log trip' });
    expect(logButtons.length).toBeGreaterThan(0);
    for (const button of logButtons) {
      expect(button).toBeDisabled();
      const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toMatch(/add a vehicle first/i);
    }
    expect(toastMock.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add your vehicle' }));
    expect(screen.getByLabelText('Make')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Log trip' })) expect(button).toBeEnabled();
  });

  it('shows a zero deduction muted, never green, and thousands separators on miles', async () => {
    mockApi({ vehicles: [truck], trips: [] });
    const { unmount } = render(<MileagePage />);
    const zero = await screen.findByText('$0.00');
    expect(zero.className).toContain('text-foreground-muted');
    expect(zero.className).not.toContain('text-positive');
    unmount();

    mockApi({ vehicles: [truck], trips: [trip({})] });
    render(<MileagePage />);
    expect(await screen.findAllByText('1,234.5')).toHaveLength(2);
  });

  it('lists saved trips compactly and expands one on tap', async () => {
    mockApi({ vehicles: [truck], trips: [trip({})] });
    render(<MileagePage />);
    const row = await screen.findByRole('button', { name: /client visit/i, expanded: false });
    expect(screen.queryByLabelText('Start odometer')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Start odometer')).toBeInTheDocument();
  });

  it('derives miles from start and end odometer readings', async () => {
    mockApi({ vehicles: [truck], trips: [] });
    render(<MileagePage />);
    const [logTrip] = await screen.findAllByRole('button', { name: 'Log trip' });
    fireEvent.click(logTrip);
    fireEvent.change(screen.getByLabelText('Start odometer'), { target: { value: '41200' } });
    fireEvent.change(screen.getByLabelText('End odometer'), { target: { value: '41212.5' } });
    const miles = screen.getByRole('spinbutton', { name: 'Miles' }) as HTMLInputElement;
    expect(miles.value).toBe('12.5');
    expect(miles.readOnly).toBe(true);
    expect(screen.getByText('From the odometer readings.')).toBeInTheDocument();
  });

  it('flags an end reading below the start instead of deriving miles', async () => {
    mockApi({ vehicles: [truck], trips: [] });
    render(<MileagePage />);
    const [logTrip] = await screen.findAllByRole('button', { name: 'Log trip' });
    fireEvent.click(logTrip);
    fireEvent.change(screen.getByLabelText('Start odometer'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('End odometer'), { target: { value: '400' } });
    expect(screen.getByText('End reading is below the start reading.')).toBeInTheDocument();
    expect((screen.getByRole('spinbutton', { name: 'Miles' }) as HTMLInputElement).readOnly).toBe(false);
  });

  it('defaults a first trip to no schedule, never Schedule F', async () => {
    mockApi({ vehicles: [truck], trips: [] });
    render(<MileagePage />);
    const [logTrip] = await screen.findAllByRole('button', { name: 'Log trip' });
    fireEvent.click(logTrip);
    expect((screen.getByLabelText('Tax schedule') as HTMLSelectElement).value).toBe('none');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(localToday());
    expect(screen.getByText('Pick the schedule this business trip belongs on.')).toBeInTheDocument();
  });

  it('asks before removing a vehicle that has trip history', async () => {
    mockApi({ vehicles: [truck], trips: [trip({})] });
    render(<MileagePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove vehicle' }));
    expect(await screen.findByText(/has 1 logged trip\./)).toBeInTheDocument();
    expect(screen.getByText('Work truck', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove vehicle and trips' }));
    await waitFor(() => expect(screen.getByText('Add your vehicle to start logging trips.')).toBeInTheDocument());
  });

  it('discards unsaved edits back to the loaded log', async () => {
    mockApi({ vehicles: [truck], trips: [] });
    render(<MileagePage />);
    const [logTrip] = await screen.findAllByRole('button', { name: 'Log trip' });
    fireEvent.click(logTrip);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByText(/No trips yet/)).toBeInTheDocument();
  });
});

describe('mileage helpers', () => {
  const profile: MileageProfile = {
    vehicles: [truck, { id: 'car-2', name: 'Sedan' }],
    trips: [trip({ id: 'last', vehicleId: 'car-2', purpose: 'medical', schedule: 'none' }), trip({ id: 'older', schedule: 'F' })],
  };

  it('copies vehicle, purpose and schedule from the last trip logged', () => {
    const next = newTripDefaults(profile, '2026-11-06', 'new');
    expect(next).toMatchObject({ id: 'new', date: '2026-11-06', vehicleId: 'car-2', purpose: 'medical', schedule: 'none', miles: 0 });
  });

  it('falls back to the first vehicle, business, and no schedule', () => {
    expect(newTripDefaults({ vehicles: [truck], trips: [] }, '2026-11-06', 'new'))
      .toMatchObject({ vehicleId: 'car-1', purpose: 'business', schedule: 'none' });
  });

  it('derives miles only when both readings are in order', () => {
    expect(applyTripPatch(trip({ miles: 3 }), { startOdometer: 100, endOdometer: 112.34 }).miles).toBe(12.3);
    expect(applyTripPatch(trip({ miles: 3 }), { startOdometer: 100, endOdometer: 90 }).miles).toBe(3);
  });

  it('builds the rate note from the effective-dated table', () => {
    const periods = [
      { from: '2026-01-01', to: '2026-06-30', business: 0.725, medical: 0.205, charity: 0.14 },
      { from: '2026-07-01', to: '2026-12-31', business: 0.76, medical: 0.235, charity: 0.14 },
    ];
    expect(rateNote('2026-03-01', periods)).toContain('business 72.5¢ → 76¢; medical 20.5¢ → 23.5¢; charity stays 14¢');
    const now = rateNote('2026-11-06', periods);
    expect(now).toContain('Current rates: business 76¢, medical 23.5¢, charity 14¢ a mile.');
    expect(now).not.toContain('From ');
    expect(rateNote('2027-02-01', periods)).toContain('No IRS rate is on file');
  });
});
