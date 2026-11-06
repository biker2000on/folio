import { IRS_MILEAGE_RATES } from '@/lib/resilience/core';
import type { MileageProfile, MileagePurpose, MileageSchedule, MileageTrip } from '@/lib/resilience/types';

/** Today in the user's own time zone (toISOString would hand back tomorrow every US evening). */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const PURPOSES: Array<{ value: MileagePurpose; label: string }> = [
  { value: 'business', label: 'Business' },
  { value: 'medical', label: 'Medical' },
  { value: 'charity', label: 'Charity' },
  { value: 'personal', label: 'Personal' },
];

export const SCHEDULES: Array<{ value: MileageSchedule; label: string }> = [
  { value: 'none', label: 'None (not a business schedule)' },
  { value: 'C', label: 'Schedule C · business' },
  { value: 'E', label: 'Schedule E · rental' },
  { value: 'F', label: 'Schedule F · farm' },
];

export const purposeLabel = (purpose: MileagePurpose) => PURPOSES.find(item => item.value === purpose)?.label ?? purpose;

const MILES = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export const formatMiles = (miles: number) => MILES.format(miles);

/**
 * A new trip copies the last one logged (trips are prepended, so that is the
 * first): same vehicle, same purpose, same schedule. With nothing to copy the
 * schedule stays "none" so the user picks one, instead of quietly filing every
 * first trip on the farm schedule. Miles start empty rather than at a made-up 1.
 */
export function newTripDefaults(profile: MileageProfile, today: string, id: string = crypto.randomUUID()): MileageTrip {
  const last = profile.trips[0];
  const lastVehicle = last && profile.vehicles.some(vehicle => vehicle.id === last.vehicleId) ? last.vehicleId : null;
  return {
    id,
    date: today,
    vehicleId: lastVehicle ?? profile.vehicles[0]?.id ?? '',
    purpose: last?.purpose ?? 'business',
    schedule: last?.schedule ?? 'none',
    description: '',
    miles: 0,
    startOdometer: null,
    endOdometer: null,
  };
}

/** Applies a patch; both odometer readings, in order, derive the miles. */
export function applyTripPatch(trip: MileageTrip, patch: Partial<MileageTrip>): MileageTrip {
  const next = { ...trip, ...patch };
  if (next.startOdometer != null && next.endOdometer != null && next.endOdometer >= next.startOdometer) {
    next.miles = Math.round((next.endOdometer - next.startOdometer) * 10) / 10;
  }
  return next;
}

/** Records the server would reject: an unnamed vehicle, a trip with no destination or miles. */
export function tripProblems(profile: MileageProfile): { vehicles: boolean; tripIds: string[] } {
  return {
    vehicles: profile.vehicles.some(vehicle => !vehicle.name.trim()),
    tripIds: profile.trips.filter(trip => !trip.description.trim() || !(trip.miles > 0)).map(trip => trip.id),
  };
}

export const cents = (rate: number) => `${Number((rate * 100).toFixed(1))}¢`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The rate note comes from the same effective-dated table the deductions use,
 * so it can never drift from the figures: current rates, plus the next change
 * only when the table has one.
 */
export function rateNote(on: string, periods = IRS_MILEAGE_RATES): string {
  const current = periods.find(period => on >= period.from && on <= period.to);
  const next = periods.find(period => period.from > on);
  const keys = ['business', 'medical', 'charity'] as const;
  const parts: string[] = ['Each trip uses the IRS rate in effect on its date.'];
  if (current) {
    parts.push(`Current rates: ${keys.map(key => `${key} ${cents(current[key])}`).join(', ')} a mile.`);
  } else {
    parts.push(`No IRS rate is on file for ${longDate(on)} yet, so trips dated then show no deduction.`);
  }
  if (next && current) {
    const changes = keys.map(key => current[key] === next[key]
      ? `${key} stays ${cents(next[key])}`
      : `${key} ${cents(current[key])} → ${cents(next[key])}`);
    parts.push(`From ${longDate(next.from)}: ${changes.join('; ')}.`);
  }
  return parts.join(' ');
}
