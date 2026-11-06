import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleTcoPage } from '../P3FeaturePages';
import { calculateVehicleTco } from '@/lib/resilience/p3-core';
import type { VehicleTcoAsset } from '@/lib/resilience/types';

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => toastMock,
}));

const civic: VehicleTcoAsset = {
  id: 'civic',
  mileageVehicleId: 'mlg-civic',
  name: '2014 Honda Civic',
  purchaseDate: '2018-04-01',
  purchasePrice: 14_500,
  currentValue: 6_200,
  annualInsurance: 0,
  annualRegistration: 180,
  annualMaintenance: 900,
  annualOther: 120,
  repairCost: 2_400,
  repairExtendsYears: 3,
  replacementVehicleCost: 28_000,
  replacementAnnualOperatingCost: 3_100,
};

function sectionResponse(vehicles: VehicleTcoAsset[]) {
  return {
    profile: { vehicles },
    vehicles: vehicles.map(vehicle => calculateVehicleTco({
      vehicle,
      trailing12FuelCost: 1_450,
      trailing12Miles: 9_812,
      sharedInsurancePremium: 1_100,
      asOf: new Date('2026-11-06T00:00:00Z'),
    })),
    mileageVehicles: [{ id: 'mlg-civic', name: 'Civic' }],
  };
}

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
}

beforeEach(() => {
  stubFetch(sectionResponse([civic]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Vehicle Total Cost', () => {
  it('leads each vehicle with the repair-or-replace answer, ahead of its inputs', async () => {
    render(<VehicleTcoPage />);
    const decision = await screen.findByTestId('vehicle-decision');

    // Repair: 2,400 + 3 × (1,450 fuel + 1,100 policy + 180 + 900 + 120) = 13,650.
    // Replace: (28,000 − 6,200) + 3 × 3,100 = 31,100. Repair saves 17,450.
    expect(decision.textContent).toContain('Repair it: saves $17,450 over 3 years');
    expect(decision.textContent).toContain('$13,650');
    expect(decision.textContent).toContain('$31,100');
    expect(screen.getByText('9,812')).toBeTruthy();

    // Decision first: the answer precedes the first input in reading order.
    const firstInput = screen.getByLabelText('Name');
    expect(decision.compareDocumentPosition(firstInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Inputs come in labelled groups, money with its unit.
    for (const group of ['Vehicle', 'Ownership', 'Running costs', 'Repair or replace']) {
      expect(screen.getByRole('group', { name: group })).toBeTruthy();
    }
    expect(screen.getByLabelText('Insurance (per year)')).toBeTruthy();
    // A single vehicle's totals are the fleet's, so no fleet row yet.
    expect(screen.queryByText('Fleet cost per year')).toBeNull();
  });

  it('does not recommend replacing when there is nothing to replace with', async () => {
    stubFetch(sectionResponse([{ ...civic, replacementVehicleCost: 0, replacementAnnualOperatingCost: 0 }]));
    render(<VehicleTcoPage />);
    const decision = await screen.findByTestId('vehicle-decision');
    expect(decision.textContent).toContain('not enough to compare yet');
    expect(decision.textContent).not.toMatch(/Replace it/);
  });

  it('marks the figures stale once the vehicle is edited, and Discard reverts', async () => {
    render(<VehicleTcoPage />);
    await screen.findByTestId('vehicle-decision');
    fireEvent.change(screen.getByLabelText('Repair estimate'), { target: { value: '9000' } });
    expect(screen.getByText(/These figures are from your last save/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText(/These figures are from your last save/)).toBeNull();
    expect((screen.getByLabelText('Repair estimate') as HTMLInputElement).value).toBe('2400');
  });

  it('asks before removing a vehicle', async () => {
    render(<VehicleTcoPage />);
    await screen.findByTestId('vehicle-decision');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('group', { name: 'Remove 2014 Honda Civic?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.getByTestId('vehicle-decision')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Remove 2014 Honda Civic?' })).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByTestId('vehicle-decision')).toBeNull();
    expect(screen.getByText('No vehicles yet')).toBeTruthy();
  });

  it('shows the fleet row, with miles linking to the Mileage Log, once there are two vehicles', async () => {
    stubFetch(sectionResponse([civic, { ...civic, id: 'truck', name: 'Truck', mileageVehicleId: null }]));
    render(<VehicleTcoPage />);
    await screen.findAllByTestId('vehicle-decision');
    expect(screen.getByText('Fleet cost per year')).toBeTruthy();
    const miles = screen.getByText('Miles logged this year').closest('a');
    expect(miles?.getAttribute('href')).toBe('/tools/mileage');
    expect(miles?.textContent).toContain('19,624');
  });

  it('opens on a lead-in with one Add vehicle action when there are no vehicles', async () => {
    stubFetch(sectionResponse([]));
    render(<VehicleTcoPage />);
    expect(await screen.findByText('No vehicles yet')).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.queryByText('Fleet cost per year')).toBeNull();

    const add = screen.getAllByRole('button', { name: 'Add vehicle' });
    expect(add).toHaveLength(1);
    fireEvent.click(add[0]);
    // The new vehicle takes the free Mileage Log vehicle's name and link.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Civic');
    expect(screen.getByText(/Save to work out this vehicle/)).toBeTruthy();
  });

  it('shows a retryable error instead of editors when the section fails to load', async () => {
    stubFetch({ error: 'Database unavailable' }, false);
    render(<VehicleTcoPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText("Couldn't load your vehicle costs")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add vehicle' })).toBeNull();

    stubFetch(sectionResponse([civic]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('vehicle-decision')).toBeTruthy());
  });
});
