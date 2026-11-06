'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Abbr } from '@/components/ui/Abbr';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { FieldError, INPUT_INVALID } from '@/components/ui/form';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/lib/format';
import { mileageRate, summarizeMileage } from '@/lib/resilience/core';
import type { FuelProfile, MileageProfile, MileagePurpose, MileageSchedule, MileageTrip, MileageVehicle } from '@/lib/resilience/types';
import { applyTripPatch, cents, formatMiles, localToday, newTripDefaults, purposeLabel, PURPOSES, rateNote, SCHEDULES, tripProblems } from './mileage-helpers';
import { Empty, Field, FieldGrid, INPUT, LoadError, Metric, Panel, RecordCard, SaveBar, Tabs, TNUM } from '@/components/resilience/ui';

type Tab = 'log' | 'fuel';
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

const uid = () => crypto.randomUUID();

const PRIMARY = 'inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-border-hover hover:bg-surface-hover';
const QUIET = 'inline-flex min-h-11 items-center px-2 text-sm text-foreground-secondary transition-colors hover:text-foreground';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 text-foreground-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MileagePage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('log');

  const [mileageLoad, setMileageLoad] = useState<LoadState>({ status: 'loading' });
  const [mileage, setMileage] = useState<MileageProfile | null>(null);
  const [savedMileage, setSavedMileage] = useState<MileageProfile | null>(null);
  const [mileageDirty, setMileageDirty] = useState(false);

  const [fuelLoad, setFuelLoad] = useState<LoadState>({ status: 'loading' });
  const [fuel, setFuel] = useState<FuelProfile | null>(null);
  const [savedFuel, setSavedFuel] = useState<FuelProfile | null>(null);
  const [fuelDirty, setFuelDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [token, setToken] = useState('');
  const [openTrips, setOpenTrips] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [removingVehicle, setRemovingVehicle] = useState<MileageVehicle | null>(null);

  const loadMileage = useCallback(async () => {
    setMileageLoad({ status: 'loading' });
    try {
      const response = await fetch('/api/resilience/mileage', { cache: 'no-store' });
      if (!response.ok) throw new Error(`The server answered ${response.status}`);
      const json = await response.json() as { profile: MileageProfile };
      setMileage(json.profile);
      setSavedMileage(json.profile);
      setMileageDirty(false);
      setOpenTrips(new Set());
      setMileageLoad({ status: 'ready' });
    } catch (error) {
      setMileageLoad({ status: 'error', message: error instanceof Error ? error.message : 'The request failed' });
    }
  }, []);

  const loadFuel = useCallback(async () => {
    setFuelLoad({ status: 'loading' });
    try {
      const response = await fetch('/api/resilience/fuel', { cache: 'no-store' });
      if (!response.ok) throw new Error(`The server answered ${response.status}`);
      const json = await response.json() as { profile: FuelProfile };
      setFuel(json.profile);
      setSavedFuel(json.profile);
      setFuelDirty(false);
      setToken('');
      setFuelLoad({ status: 'ready' });
    } catch (error) {
      setFuelLoad({ status: 'error', message: error instanceof Error ? error.message : 'The request failed' });
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'fuel') setTab('fuel');
    void loadMileage();
    void loadFuel();
  }, [loadMileage, loadFuel]);

  // Leaving with unsaved trips loses them; the browser asks first.
  useEffect(() => {
    if (!mileageDirty && !fuelDirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [mileageDirty, fuelDirty]);

  // A just-added trip or vehicle takes focus, which also scrolls it into view
  // (Log trip may have been tapped from the bottom bar, far below the list).
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const summary = useMemo(() => summarizeMileage(mileage?.trips ?? [], new Date().getFullYear()), [mileage]);

  const updateMileage = (profile: MileageProfile) => {
    setMileage(profile);
    setMileageDirty(true);
  };

  const updateFuel = (profile: FuelProfile) => {
    setFuel(profile);
    setFuelDirty(true);
  };

  const toggleTrip = (id: string, open?: boolean) => setOpenTrips(current => {
    const next = new Set(current);
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    return next;
  });

  const addVehicle = () => {
    if (!mileage) return;
    const vehicle: MileageVehicle = { id: uid(), name: '', year: null, make: '', model: '', fuelTrackerVehicleId: null };
    updateMileage({ ...mileage, vehicles: [...mileage.vehicles, vehicle] });
    setFocusId(`vehicle-name-${vehicle.id}`);
  };

  const addTrip = () => {
    if (!mileage || mileage.vehicles.length === 0) return;
    const trip = newTripDefaults(mileage, localToday());
    updateMileage({ ...mileage, trips: [trip, ...mileage.trips] });
    toggleTrip(trip.id, true);
    setFocusId(`trip-description-${trip.id}`);
  };

  const updateVehicle = (id: string, patch: Partial<MileageVehicle>) => {
    if (!mileage) return;
    updateMileage({ ...mileage, vehicles: mileage.vehicles.map(vehicle => vehicle.id === id ? { ...vehicle, ...patch } : vehicle) });
  };

  const removeVehicle = (id: string) => {
    if (!mileage) return;
    updateMileage({ ...mileage, vehicles: mileage.vehicles.filter(item => item.id !== id), trips: mileage.trips.filter(trip => trip.vehicleId !== id) });
  };

  const requestRemoveVehicle = (vehicle: MileageVehicle) => {
    if (!mileage) return;
    // Only a vehicle with history needs the confirm: that is what gets deleted.
    if (mileage.trips.some(trip => trip.vehicleId === vehicle.id)) setRemovingVehicle(vehicle);
    else removeVehicle(vehicle.id);
  };

  const updateTrip = (id: string, patch: Partial<MileageTrip>) => {
    if (!mileage) return;
    updateMileage({ ...mileage, trips: mileage.trips.map(trip => trip.id === id ? applyTripPatch(trip, patch) : trip) });
  };

  const discardMileage = () => {
    setMileage(savedMileage);
    setMileageDirty(false);
    setOpenTrips(new Set());
  };

  const discardFuel = () => {
    setFuel(savedFuel);
    setToken('');
    setFuelDirty(false);
  };

  const saveMileage = async () => {
    if (!mileage) return;
    const problems = tripProblems(mileage);
    if (problems.vehicles) {
      toast.error('Name every vehicle before saving.');
      return;
    }
    if (problems.tripIds.length > 0) {
      setOpenTrips(current => new Set([...current, ...problems.tripIds]));
      toast.error(problems.tripIds.length === 1
        ? 'One trip needs a destination and miles before saving.'
        : `${problems.tripIds.length} trips need a destination and miles before saving.`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/resilience/mileage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: mileage }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Save failed');
      setMileage(json.profile);
      setSavedMileage(json.profile);
      setMileageDirty(false);
      setOpenTrips(new Set());
      toast.success('Mileage log saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveFuel = async () => {
    if (!fuel) return;
    setSaving(true);
    try {
      const response = await fetch('/api/resilience/fuel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: fuel, token: token || undefined }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Save failed');
      setFuel(json.profile);
      setSavedFuel(json.profile);
      setToken('');
      setFuelDirty(false);
      toast.success('Fuel Tracker connection saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const syncFuel = async () => {
    setSyncing(true);
    try {
      if (fuelDirty) await saveFuel();
      const response = await fetch('/api/resilience/fuel-sync', { method: 'POST' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Sync failed');
      setFuel(json.profile);
      setSavedFuel(json.profile);
      toast.success(`Fuel Tracker synced: ${json.imported} imported, ${json.matched} matched`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const hasVehicle = (mileage?.vehicles.length ?? 0) > 0;
  const logReady = tab === 'log' && mileageLoad.status === 'ready' && mileage != null;
  const savedHasVehicle = (savedMileage?.vehicles.length ?? 0) > 0;
  const noVehicleReason = 'Add a vehicle first';

  const logTripButton = (reasonId: string, className = '') => (
    <button
      type="button"
      onClick={addTrip}
      disabled={!hasVehicle}
      aria-describedby={hasVehicle ? undefined : reasonId}
      className={`${PRIMARY} ${className}`}
    >
      Log trip
    </button>
  );

  const headerAction = tab === 'log'
    ? logReady && (
      // The phone gets this action in the bottom bar, within thumb reach.
      <div className="hidden items-center gap-3 sm:flex">
        {!hasVehicle && <span id="log-trip-reason-top" className="text-xs text-foreground-muted">{noVehicleReason}</span>}
        {logTripButton('log-trip-reason-top')}
      </div>
    )
    : fuelLoad.status === 'ready' && (
      <button type="button" onClick={syncFuel} disabled={syncing} className={PRIMARY}>{syncing ? 'Syncing…' : 'Sync now'}</button>
    );

  const renderVehicles = (profile: MileageProfile) => (
    <Panel
      title="Vehicles"
      action={hasVehicle ? <button type="button" onClick={addVehicle} className={SECONDARY}>Add vehicle</button> : undefined}
    >
      {!hasVehicle ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-foreground">Add your vehicle to start logging trips.</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-foreground-secondary">Every trip is recorded against a vehicle, which is what substantiates its miles.</p>
          <button type="button" onClick={addVehicle} className={`${PRIMARY} mt-4`}>Add your vehicle</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {profile.vehicles.map(vehicle => (
            <RecordCard
              key={vehicle.id}
              title={vehicle.name || 'New vehicle'}
              removeLabel="Remove vehicle"
              onRemove={() => requestRemoveVehicle(vehicle)}
            >
              <FieldGrid cols={2}>
                <Field label="Name"><input id={`vehicle-name-${vehicle.id}`} className={INPUT} placeholder="e.g. Work truck" value={vehicle.name} onChange={event => updateVehicle(vehicle.id, { name: event.target.value })} /></Field>
                <Field label="Year"><input type="number" inputMode="numeric" className={`${INPUT} font-mono`} style={TNUM} value={vehicle.year ?? ''} onChange={event => updateVehicle(vehicle.id, { year: event.target.value ? Number(event.target.value) : null })} /></Field>
                <Field label="Make"><input className={INPUT} placeholder="e.g. Toyota" value={vehicle.make ?? ''} onChange={event => updateVehicle(vehicle.id, { make: event.target.value })} /></Field>
                <Field label="Model"><input className={INPUT} placeholder="e.g. Tacoma" value={vehicle.model ?? ''} onChange={event => updateVehicle(vehicle.id, { model: event.target.value })} /></Field>
              </FieldGrid>
            </RecordCard>
          ))}
        </div>
      )}
    </Panel>
  );

  const renderTripLog = (profile: MileageProfile) => (
    <section id="trip-log" className="scroll-mt-4">
      <Panel title="Trip log" description={rateNote(localToday())}>
        {profile.trips.length === 0 ? (
          <Empty>
            {hasVehicle
              ? 'No trips yet. Log each trip while its purpose is fresh; the vehicle, purpose and schedule carry over from the last one.'
              : 'Trips are logged against a vehicle. Add your vehicle above to start.'}
          </Empty>
        ) : (
          <ul className="space-y-2">
            {profile.trips.map(trip => (
              <TripRow
                key={trip.id}
                trip={trip}
                vehicles={profile.vehicles}
                open={openTrips.has(trip.id)}
                onToggle={() => toggleTrip(trip.id)}
                onChange={patch => updateTrip(trip.id, patch)}
                onRemove={() => updateMileage({ ...profile, trips: profile.trips.filter(item => item.id !== trip.id) })}
              />
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mileage Log"
        subtitle={<>Substantiated mileage for <Abbr term="Schedule C" />, <Abbr term="Schedule E" /> and <Abbr term="Schedule F" />, plus evidence-matched Fuel Tracker imports.</>}
        actions={headerAction || undefined}
      />
      <Tabs label="Mileage sections" value={tab} onChange={setTab} tabs={[{ value: 'log', label: 'Mileage log' }, { value: 'fuel', label: 'Fuel Tracker' }]} />

      {tab === 'log' && mileageLoad.status === 'loading' && <p role="status" className="text-sm text-foreground-muted">Loading mileage log…</p>}
      {tab === 'log' && mileageLoad.status === 'error' && <LoadError what="the mileage log" message={mileageLoad.message} onRetry={() => void loadMileage()} />}

      {logReady && mileage && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric
              label={`${new Date().getFullYear()} total miles`}
              value={formatMiles(summary.totalMiles)}
              tone={summary.totalMiles === 0 ? 'muted' : undefined}
              href="#trip-log"
              opens="Trip log"
            />
            <Metric
              label="Deductible miles"
              value={formatMiles(summary.deductibleMiles)}
              tone={summary.deductibleMiles === 0 ? 'muted' : undefined}
              hint="Business, medical and charity"
              href="#trip-log"
              opens="Trip log"
            />
            <div className="col-span-2 sm:col-span-1 [&>*]:h-full">
              <Metric
                label="Estimated deduction"
                value={formatCurrency(summary.deduction)}
                tone={summary.deduction > 0 ? 'positive' : 'muted'}
                href="#trip-log"
                opens="Per-trip deductions"
              />
            </div>
          </div>

          {/* Setup leads until a vehicle is saved; after that the log is the page. */}
          {savedHasVehicle ? <>{renderTripLog(mileage)}{renderVehicles(mileage)}</> : <>{renderVehicles(mileage)}{renderTripLog(mileage)}</>}

          <div className="sticky bottom-4 z-10 space-y-2">
            <SaveBar saving={saving} dirty={mileageDirty} onSave={saveMileage} onDiscard={discardMileage} />
            {/* Thumb reach on phones. With no vehicle there is nothing to log yet;
                the vehicle empty state leads instead of a dead button. */}
            {hasVehicle && <div className="sm:hidden">{logTripButton('', 'w-full py-3 shadow-lg')}</div>}
          </div>
        </>
      )}

      {tab === 'fuel' && fuelLoad.status === 'loading' && <p role="status" className="text-sm text-foreground-muted">Loading Fuel Tracker…</p>}
      {tab === 'fuel' && fuelLoad.status === 'error' && <LoadError what="the Fuel Tracker connection" message={fuelLoad.message} onRetry={() => void loadFuel()} />}

      {tab === 'fuel' && fuelLoad.status === 'ready' && fuel && (
        <>
          <Panel title="Fuel Tracker connection" description="Read-only bearer token; credentials are encrypted and never returned to the browser.">
            <FieldGrid>
              <Field label="Fuel Tracker URL"><input className={INPUT} placeholder="https://fuel.example.com" value={fuel.baseUrl} onChange={event => updateFuel({ ...fuel, baseUrl: event.target.value })} /></Field>
              <Field label={fuel.hasToken ? 'Replace API token (optional)' : 'API token'}><input type="password" className={INPUT} value={token} onChange={event => { setToken(event.target.value); setFuelDirty(true); }} /></Field>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm text-foreground-secondary"><input type="checkbox" checked={fuel.enabled} onChange={event => updateFuel({ ...fuel, enabled: event.target.checked })} /> Nightly sync enabled</label>
            </FieldGrid>
            <p className="mt-3 text-xs text-foreground-muted">Last sync: {fuel.lastSyncAt ? new Date(fuel.lastSyncAt).toLocaleString() : 'Never'}</p>
          </Panel>
          {fuel.vehicles.length > 0 && mileage && (
            <Panel title="Vehicle mapping" description="Map each Fuel Tracker vehicle once; fill-ups inherit the mapping.">
              <div className="space-y-2">
                {fuel.vehicles.map(vehicle => (
                  <div key={vehicle.sourceId} className="grid grid-cols-1 items-center gap-3 border-b border-border/60 py-2 last:border-0 sm:grid-cols-2">
                    <span className="text-sm text-foreground">{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.name}</span>
                    <select aria-label={`Mileage vehicle for ${vehicle.name}`} className={INPUT} value={vehicle.mappedVehicleId ?? ''} onChange={event => updateFuel({ ...fuel, vehicles: fuel.vehicles.map(item => item.sourceId === vehicle.sourceId ? { ...item, mappedVehicleId: event.target.value || null } : item) })}>
                      <option value="">Unmapped</option>
                      {mileage.vehicles.map(local => <option key={local.id} value={local.id}>{local.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Imported fill-ups" description="Exact amount/date candidates are linked to GnuCash transactions; uncertain records remain visible for review.">
            {fuel.fillups.length === 0 ? <Empty>Save the connection, then run the first sync.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-foreground-muted"><tr><th className="pb-2">Date</th><th className="pb-2">Location</th><th className="pb-2 text-right">Gallons</th><th className="pb-2 text-right">$/gal</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Evidence</th></tr></thead>
                  <tbody>{fuel.fillups.slice().reverse().slice(0, 200).map(fillup => (
                    <tr key={fillup.sourceId} className="border-t border-border/60">
                      <td className="py-2 font-mono" style={TNUM}>{fillup.date.slice(0, 10)}</td>
                      <td className="py-2 text-foreground-secondary">{fillup.location || '—'}</td>
                      <td className="py-2 text-right font-mono" style={TNUM}>{fillup.gallons.toFixed(3)}</td>
                      <td className="py-2 text-right font-mono" style={TNUM}>{formatCurrency(fillup.pricePerGallon)}</td>
                      <td className="py-2 text-right font-mono" style={TNUM}>{formatCurrency(fillup.totalCost)}</td>
                      <td className={`py-2 text-right text-xs ${fillup.matchStatus === 'matched' ? 'text-success' : 'text-warning'}`}>{fillup.matchStatus === 'matched' ? 'Transaction linked' : 'Needs match'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Panel>
          <div className="sticky bottom-4 z-10">
            <SaveBar saving={saving} dirty={fuelDirty} onSave={saveFuel} onDiscard={discardFuel} />
          </div>
        </>
      )}

      <ConfirmationDialog
        isOpen={removingVehicle != null}
        title="Remove vehicle and its trips?"
        message={removingVehicle && mileage ? removalMessage(removingVehicle, mileage) : ''}
        confirmLabel="Remove vehicle and trips"
        confirmVariant="danger"
        defaultFocus="cancel"
        confirmOnEnter={false}
        onCancel={() => setRemovingVehicle(null)}
        onConfirm={() => {
          if (removingVehicle) removeVehicle(removingVehicle.id);
          setRemovingVehicle(null);
        }}
      />
    </div>
  );
}

function removalMessage(vehicle: MileageVehicle, profile: MileageProfile): string {
  const count = profile.trips.filter(trip => trip.vehicleId === vehicle.id).length;
  const trips = count === 1 ? '1 logged trip' : `${count} logged trips`;
  return `${vehicle.name || 'This vehicle'} has ${trips}. Removing it deletes that trip history when you save; Discard undoes it until then.`;
}

function TripRow(props: {
  trip: MileageTrip;
  vehicles: MileageVehicle[];
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<MileageTrip>) => void;
  onRemove: () => void;
}) {
  const { trip, open } = props;
  const rate = mileageRate(trip.date, trip.purpose);
  const deduction = Math.round(trip.miles * rate * 100) / 100;
  const deductionTone = deduction > 0 ? 'text-positive' : 'text-foreground-muted';
  const hasStart = trip.startOdometer != null;
  const hasEnd = trip.endOdometer != null;
  const odometerBackwards = hasStart && hasEnd && (trip.endOdometer as number) < (trip.startOdometer as number);
  const milesFromOdometer = hasStart && hasEnd && !odometerBackwards;
  const panelId = `trip-${trip.id}`;
  const odometerValue = (value: string) => value === '' ? null : Number(value);

  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={props.onToggle}
        className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="hidden w-24 shrink-0 font-mono text-sm text-foreground-secondary sm:block" style={TNUM}>{trip.date}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${trip.description ? 'text-foreground' : 'italic text-foreground-muted'}`}>{trip.description || 'No destination yet'}</span>
          <span className="mt-0.5 block text-xs text-foreground-secondary sm:hidden"><span className="font-mono" style={TNUM}>{trip.date}</span> · {purposeLabel(trip.purpose)}</span>
        </span>
        <span className="hidden w-20 shrink-0 text-sm text-foreground-secondary sm:block">{purposeLabel(trip.purpose)}</span>
        <span className="shrink-0 whitespace-nowrap text-right font-mono text-sm text-foreground sm:w-24" style={TNUM}>{formatMiles(trip.miles)} mi</span>
        <span className={`hidden w-24 shrink-0 text-right font-mono text-sm sm:block ${deductionTone}`} style={TNUM}>{formatCurrency(deduction)}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={panelId} className="space-y-4 border-t border-border p-4">
          <FieldGrid>
            <Field label="Date"><input type="date" className={`${INPUT} font-mono`} style={TNUM} value={trip.date} onChange={event => props.onChange({ date: event.target.value })} /></Field>
            <Field label="Purpose / destination" className="sm:col-span-2 lg:col-span-2"><input id={`trip-description-${trip.id}`} className={INPUT} placeholder="e.g. Client site visit, Raleigh" value={trip.description} onChange={event => props.onChange({ description: event.target.value })} /></Field>
            <Field label="Vehicle">
              <select className={INPUT} value={trip.vehicleId} onChange={event => props.onChange({ vehicleId: event.target.value })}>
                {props.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || 'New vehicle'}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select className={INPUT} value={trip.purpose} onChange={event => props.onChange({ purpose: event.target.value as MileagePurpose })}>
                {PURPOSES.map(purpose => <option key={purpose.value} value={purpose.value}>{purpose.label}</option>)}
              </select>
            </Field>
            <div>
              <Field label="Tax schedule">
                <select className={INPUT} aria-describedby={trip.purpose === 'business' && trip.schedule === 'none' ? `${panelId}-schedule-hint` : undefined} value={trip.schedule} onChange={event => props.onChange({ schedule: event.target.value as MileageSchedule })}>
                  {SCHEDULES.map(schedule => <option key={schedule.value} value={schedule.value}>{schedule.label}</option>)}
                </select>
              </Field>
              {trip.purpose === 'business' && trip.schedule === 'none' && <p id={`${panelId}-schedule-hint`} className="mt-1 text-xs text-foreground-muted">Pick the schedule this business trip belongs on.</p>}
            </div>
            <Field label="Start odometer"><input type="number" inputMode="decimal" min="0" className={`${INPUT} font-mono`} style={TNUM} value={trip.startOdometer ?? ''} onChange={event => props.onChange({ startOdometer: odometerValue(event.target.value) })} /></Field>
            <div>
              <Field label="End odometer">
                <input type="number" inputMode="decimal" min="0" className={`${INPUT} font-mono ${odometerBackwards ? INPUT_INVALID : ''}`} style={TNUM} aria-invalid={odometerBackwards || undefined} aria-describedby={odometerBackwards ? `${panelId}-odometer-error` : undefined} value={trip.endOdometer ?? ''} onChange={event => props.onChange({ endOdometer: odometerValue(event.target.value) })} />
              </Field>
              <FieldError id={`${panelId}-odometer-error`} message={odometerBackwards ? 'End reading is below the start reading.' : null} />
            </div>
            <div>
              <Field label="Miles">
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.1"
                    readOnly={milesFromOdometer}
                    aria-describedby={milesFromOdometer ? `${panelId}-miles-hint` : undefined}
                    className={`${INPUT} pr-10 font-mono ${milesFromOdometer ? 'bg-background-secondary text-foreground-secondary' : ''}`}
                    style={TNUM}
                    placeholder="0"
                    value={trip.miles > 0 ? trip.miles : ''}
                    onChange={event => props.onChange({ miles: Number(event.target.value) })}
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">mi</span>
                </div>
              </Field>
              {milesFromOdometer && <p id={`${panelId}-miles-hint`} className="mt-1 text-xs text-foreground-muted">From the odometer readings.</p>}
            </div>
          </FieldGrid>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <p className="text-xs text-foreground-secondary">
              {rate > 0 ? `${cents(rate)} a mile · ` : 'No deduction for personal miles · '}
              <span className={`font-mono ${deductionTone}`} style={TNUM}>{formatCurrency(deduction)}</span> estimated deduction
            </p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={props.onRemove} className="inline-flex min-h-11 items-center px-2 text-sm text-foreground-muted transition-colors hover:text-error">Remove trip</button>
              <button type="button" onClick={props.onToggle} className={QUIET}>Done</button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
