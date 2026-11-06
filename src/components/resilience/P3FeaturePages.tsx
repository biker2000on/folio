'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/lib/format';
import {
  COLLEGE_START_AGE,
  ageFromBirthday,
  birthYearFromBirthday,
  findDependentMember,
  normalizePersonName,
} from '@/lib/resilience/household';
import type {
  EducationChild,
  EducationProfile,
  HouseholdMember,
  FamilyBankChild,
  FamilyBankEntryKind,
  FamilyBankingProfile,
  TripPlan,
  TripsProfile,
  VehicleTcoAsset,
  VehicleTcoProfile,
} from '@/lib/resilience/types';
import { Empty, Field, FieldGrid, INPUT, LABEL, LoadError, Metric, Panel, SaveBar, TNUM } from './ui';
import { extractErrorMessage } from '@/lib/api-error';

export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);
export const numberValue = (value: string) => Number(value) || 0;

export function useSection<P, R extends { profile: P }>(section: string, initial: P) {
  const toast = useToast();
  const [response, setResponse] = useState<R | null>(null);
  const [profile, setProfile] = useState<P>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Re-read the section. `keepProfile` refreshes only the server-computed
   * half of the response (analysis, suggestions) and leaves the edit buffer
   * alone — used by background polling, which must never discard unsaved work.
   */
  const load = async (keepProfile = false): Promise<R> => {
    const result = await fetch(`/api/resilience/${section}`, { cache: 'no-store' });
    const json = await result.json();
    if (!result.ok) throw new Error(extractErrorMessage(json, 'Request failed'));
    setResponse(json as R);
    if (!keepProfile) {
      setProfile((json as R).profile);
      setDirty(false);
    }
    return json as R;
  };

  const initialLoad = () => {
    setLoading(true);
    setLoadError(null);
    return load()
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Request failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const change = (next: P) => {
    setProfile(next);
    setDirty(true);
  };

  /** Returns true when the save was accepted, so callers can clear staged-work state. */
  const save = async (): Promise<boolean> => {
    // The buffer only means something once the stored profile has loaded.
    // Saving the empty defaults would replace every stored record.
    if (!response) {
      toast.error('This section has not loaded yet, so there is nothing safe to save. Reload and try again.');
      return false;
    }
    setSaving(true);
    try {
      const result = await fetch(`/api/resilience/${section}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const json = await result.json();
      if (!result.ok) throw new Error(extractErrorMessage(json, 'Save failed'));
      setResponse(json as R);
      setProfile((json as R).profile);
      setDirty(false);
      toast.success('Changes saved');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Revert unsaved edits back to the last server response. */
  const discard = () => {
    setProfile(current => (response ? response.profile : current));
    setDirty(false);
  };

  return { response, profile, change, dirty, saving, loading, loadError, retry: initialLoad, save, discard, refresh: () => load(true) };
}

type EducationResult = EducationChild & {
  projectedCost: number;
  projected529Balance: number;
  fundingGap: number;
  requiredMonthlyContribution: number;
  monthlyShortfall: number;
  contributedThisYear: number;
  stateDeductionRemaining: number;
  glidePath: { equityPercent: number; fixedIncomePercent: number; guidance: string };
};

type EducationResponse = {
  profile: EducationProfile;
  plans: EducationResult[];
  /** Household roster from Settings; absent on responses from an older server. */
  household?: { members: HouseholdMember[] };
};

const SETTINGS_LINK = 'text-primary underline-offset-2 hover:underline';

/**
 * Identity fields for one student.
 *
 * Household dependents are the source of truth: picking one takes the name and
 * birthday from Settings and shows them read-only. Manual name/birth-year entry
 * stays available for a student who is not a household dependent — a
 * grandchild or a niece — and for a linked dependent with no birthday on file.
 */
function StudentIdentityFields(props: {
  child: EducationChild;
  members: HouseholdMember[];
  /** Named dependents not already claimed by another student row. */
  available: HouseholdMember[];
  onChange: (patch: Partial<EducationChild>) => void;
}) {
  const { child, members } = props;
  // Same matcher the server uses, so the picker and the analysis never disagree.
  const linked = findDependentMember(child, members);
  const linkedBirthYear = birthYearFromBirthday(linked?.birthday);

  const selectMember = (value: string) => {
    if (value === '') {
      props.onChange({ memberRole: null, memberName: null });
      return;
    }
    const member = props.available.find(item => normalizePersonName(item.name) === value)
      ?? members.find(item => normalizePersonName(item.name) === value);
    if (!member) return;
    // Snapshot the name: it is both the display value and the link key.
    const birthYear = birthYearFromBirthday(member.birthday);
    props.onChange({
      memberRole: 'dependent',
      memberName: member.name.trim(),
      name: member.name.trim(),
      ...(birthYear != null
        ? { birthYear, collegeStartYear: birthYear + COLLEGE_START_AGE }
        : {}),
    });
  };

  return (
    <>
      <Field label="Household member">
        <select
          className={INPUT}
          aria-label="Household member"
          value={linked ? normalizePersonName(linked.name) : ''}
          onChange={event => selectMember(event.target.value)}
        >
          <option value="">Not a household dependent — enter manually</option>
          {props.available.map(member => (
            <option key={member.role + member.name} value={normalizePersonName(member.name)}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      {linked ? (
        <Field label="Birth year">
          {linkedBirthYear != null ? (
            <p className="rounded-md border border-transparent px-3 py-2.5 text-sm text-foreground">
              <span className="font-mono">{linkedBirthYear}</span>
              <span className="text-foreground-muted"> · born {linked.birthday} (household settings)</span>
            </p>
          ) : (
            <>
              <input
                type="number"
                min={1900}
                max={2100}
                className={`${INPUT} font-mono`}
                value={child.birthYear}
                onChange={event => props.onChange({ birthYear: numberValue(event.target.value) })}
              />
              <span className="mt-1 block text-xs text-foreground-muted">
                No birthday recorded for this dependent — add one in Settings to share it everywhere.
              </span>
            </>
          )}
        </Field>
      ) : (
        <>
          <Field label="Student (manual)">
            <input
              className={INPUT}
              value={child.name}
              onChange={event => props.onChange({ name: event.target.value })}
            />
          </Field>
          <Field label="Birth year (manual)">
            <input
              type="number"
              min={1900}
              max={2100}
              className={`${INPUT} font-mono`}
              value={child.birthYear}
              onChange={event => props.onChange({ birthYear: numberValue(event.target.value) })}
            />
          </Field>
        </>
      )}
    </>
  );
}

export function EducationPlannerPage() {
  const state = useSection<EducationProfile, EducationResponse>(
    'education',
    { children: [] },
  );
  const [contributions, setContributions] = useState<Record<string, string>>({});
  if (state.loading) return <div className="p-6 text-sm text-foreground-muted">Loading education plans…</div>;
  const update = (id: string, patch: Partial<EducationChild>) =>
    state.change({ children: state.profile.children.map(child => child.id === id ? { ...child, ...patch } : child) });
  const addChild = () => {
    const year = new Date().getFullYear();
    state.change({ children: [...state.profile.children, {
      id: uid(), memberRole: null, memberName: null,
      name: 'New student', birthYear: year - 5, collegeStartYear: year + 13,
      schoolType: 'public_in_state', yearsOfSchool: 4, annualCostToday: 30_000,
      tuitionInflationRate: 5, current529Balance: 0, expectedAnnualReturn: 6,
      plannedMonthlyContribution: 250, stateDeductionLimit: 0, contributions: [],
    }] });
  };
  // Household dependents from Settings — the source of truth for who these
  // students are. Empty when none are configured; manual entry then works
  // exactly as it did before.
  const householdMembers = state.response?.household?.members ?? [];
  const dependents = householdMembers.filter(member => member.role === 'dependent' && member.name.trim());
  /** Dependents free to pick: not already claimed by a different student row. */
  const availableFor = (child: EducationChild) => {
    const claimed = new Set(state.profile.children
      .filter(item => item.id !== child.id && item.memberRole === 'dependent')
      .map(item => normalizePersonName(item.memberName?.trim() || item.name)));
    const own = normalizePersonName(child.memberName?.trim() || child.name);
    return dependents.filter(member => {
      const key = normalizePersonName(member.name);
      return key === own || !claimed.has(key);
    });
  };
  const recordContribution = (child: EducationChild) => {
    const amount = numberValue(contributions[child.id] ?? '');
    if (amount <= 0) return;
    update(child.id, { contributions: [...child.contributions, { id: uid(), date: today(), amount }] });
    setContributions(current => ({ ...current, [child.id]: '' }));
  };
  const totals = state.response?.plans ?? [];
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <PageHeader title="Education & 529 Planner" subtitle="Per-child tuition projections, contribution targets, state deduction tracking, and glide-path guidance." actions={<button type="button" onClick={addChild} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">Add student</button>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Projected education cost" value={formatCurrency(totals.reduce((sum, row) => sum + row.projectedCost, 0))} />
        <Metric label="Projected 529 value" value={formatCurrency(totals.reduce((sum, row) => sum + row.projected529Balance, 0))} tone="positive" />
        <Metric label="Funding gap" value={formatCurrency(totals.reduce((sum, row) => sum + row.fundingGap, 0))} tone={totals.some(row => row.fundingGap > 0) ? 'warning' : 'positive'} />
      </div>
      <p className="text-xs text-foreground-muted">
        {dependents.length === 0
          ? <>No household dependents are configured yet. Add them (with birthdays) in <Link href="/settings" className={SETTINGS_LINK}>Settings</Link> and this page fills in names and birth years automatically. Until then, enter students manually.</>
          : <>Student names and birthdays come from your household dependents — <Link href="/settings" className={SETTINGS_LINK}>change them in Settings</Link> and every planning pack follows. Only the 529 inputs live here.</>}
      </p>
      {state.profile.children.length === 0 ? <Empty>Add a child or student to model an education path.</Empty> : state.profile.children.map(child => {
        const result = state.response?.plans.find(row => row.id === child.id);
        return (
          <Panel key={child.id} title={child.name} description={result ? `${result.glidePath.equityPercent}% growth / ${result.glidePath.fixedIncomePercent}% preservation guidance` : undefined} action={<button type="button" onClick={() => state.change({ children: state.profile.children.filter(item => item.id !== child.id) })} className="text-xs text-negative">Remove</button>}>
            <FieldGrid>
              <StudentIdentityFields
                child={child}
                members={householdMembers}
                available={availableFor(child)}
                onChange={patch => update(child.id, patch)}
              />
              <Field label="College start"><input type="number" className={`${INPUT} font-mono`} value={child.collegeStartYear} onChange={event => update(child.id, { collegeStartYear: numberValue(event.target.value) })} /></Field>
              <Field label="School type"><select className={INPUT} value={child.schoolType} onChange={event => update(child.id, { schoolType: event.target.value as EducationChild['schoolType'] })}><option value="public_in_state">Public in-state</option><option value="public_out_of_state">Public out-of-state</option><option value="private">Private</option></select></Field>
              <Field label="Years"><input type="number" min="1" max="10" className={`${INPUT} font-mono`} value={child.yearsOfSchool} onChange={event => update(child.id, { yearsOfSchool: numberValue(event.target.value) })} /></Field>
              <Field label="Annual cost today"><input type="number" className={`${INPUT} font-mono`} value={child.annualCostToday} onChange={event => update(child.id, { annualCostToday: numberValue(event.target.value) })} /></Field>
              <Field label="Tuition inflation %"><input type="number" step="0.1" className={`${INPUT} font-mono`} value={child.tuitionInflationRate} onChange={event => update(child.id, { tuitionInflationRate: numberValue(event.target.value) })} /></Field>
              <Field label="Current 529 balance"><input type="number" className={`${INPUT} font-mono`} value={child.current529Balance} onChange={event => update(child.id, { current529Balance: numberValue(event.target.value) })} /></Field>
              <Field label="Expected return %"><input type="number" step="0.1" className={`${INPUT} font-mono`} value={child.expectedAnnualReturn} onChange={event => update(child.id, { expectedAnnualReturn: numberValue(event.target.value) })} /></Field>
              <Field label="Planned monthly"><input type="number" className={`${INPUT} font-mono`} value={child.plannedMonthlyContribution} onChange={event => update(child.id, { plannedMonthlyContribution: numberValue(event.target.value) })} /></Field>
              <Field label="State deduction limit"><input type="number" className={`${INPUT} font-mono`} value={child.stateDeductionLimit} onChange={event => update(child.id, { stateDeductionLimit: numberValue(event.target.value) })} /></Field>
              <Field label="Record contribution" className="sm:col-span-2"><div className="flex gap-2"><input type="number" className={`${INPUT} font-mono`} value={contributions[child.id] ?? ''} onChange={event => setContributions(current => ({ ...current, [child.id]: event.target.value }))} /><button type="button" onClick={() => recordContribution(child)} className="rounded-md border border-border px-3 text-sm text-primary">Record</button></div></Field>
            </FieldGrid>
            {result && <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Required monthly" value={formatCurrency(result.requiredMonthlyContribution)} /><Metric label="Monthly shortfall" value={formatCurrency(result.monthlyShortfall)} tone={result.monthlyShortfall > 0 ? 'warning' : 'positive'} /><Metric label="Contributed this year" value={formatCurrency(result.contributedThisYear)} tone="positive" /><Metric label="Deduction room" value={formatCurrency(result.stateDeductionRemaining)} /></div>}
            {result && <p className="mt-3 text-xs text-foreground-muted">{result.glidePath.guidance} Five-year gift elections and 529-to-Roth eligibility require tax-adviser review.</p>}
          </Panel>
        );
      })}
      <SaveBar saving={state.saving} dirty={state.dirty} onSave={state.save} />
    </div>
  );
}

type AccountOption = { guid: string; fullname: string; name: string; type: string };
type FamilyResponse = {
  profile: FamilyBankingProfile;
  children: Array<{ child: FamilyBankChild; balance: number; pendingCount: number; pendingAmount: number; goalRemaining: number; goalProgressPercent: number; allowanceDue: boolean }>;
  /** Household roster from Settings; absent on responses from an older server. */
  household?: { members: HouseholdMember[] };
};

/**
 * Identity fields for one family-banking child.
 *
 * Household dependents are the source of truth: picking one takes the name
 * from Settings, and the on-file birthday supplies the age shown on the panel.
 * Manual name entry stays available for a child who is not a household
 * dependent — a visiting cousin's ledger, say.
 */
function FamilyChildIdentityFields(props: {
  child: FamilyBankChild;
  members: HouseholdMember[];
  /** Named dependents not already claimed by another child row. */
  available: HouseholdMember[];
  onChange: (patch: Partial<FamilyBankChild>) => void;
}) {
  const { child, members } = props;
  // Same matcher the server uses, so the picker and the ledger never disagree.
  const linked = findDependentMember(child, members);

  const selectMember = (value: string) => {
    if (value === '') {
      props.onChange({ memberRole: null, memberName: null });
      return;
    }
    const member = props.available.find(item => normalizePersonName(item.name) === value)
      ?? members.find(item => normalizePersonName(item.name) === value);
    if (!member) return;
    // Snapshot the name: it is both the display value and the link key.
    props.onChange({
      memberRole: 'dependent',
      memberName: member.name.trim(),
      name: member.name.trim(),
    });
  };

  return (
    <>
      <Field label="Household member">
        <select
          className={INPUT}
          aria-label="Household member"
          value={linked ? normalizePersonName(linked.name) : ''}
          onChange={event => selectMember(event.target.value)}
        >
          <option value="">Not a household dependent — enter manually</option>
          {props.available.map(member => (
            <option key={member.role + member.name} value={normalizePersonName(member.name)}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      {!linked && (
        <Field label="Name (manual)">
          <input className={INPUT} value={child.name} onChange={event => props.onChange({ name: event.target.value })} />
        </Field>
      )}
    </>
  );
}

export function FamilyBankingPage() {
  const state = useSection<FamilyBankingProfile, FamilyResponse>('family_banking', { children: [] });
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [entryText, setEntryText] = useState<Record<string, string>>({});
  const [entryAmount, setEntryAmount] = useState<Record<string, string>>({});
  useEffect(() => { fetch('/api/accounts?flat=true&noBalances=true').then(result => result.json()).then(json => setAccounts(Array.isArray(json) ? json : json.accounts ?? [])).catch(() => undefined); }, []);
  if (state.loading) return <div className="p-6 text-sm text-foreground-muted">Loading family banking…</div>;
  const update = (id: string, patch: Partial<FamilyBankChild>) => state.change({ children: state.profile.children.map(child => child.id === id ? { ...child, ...patch } : child) });
  const addChild = () => state.change({ children: [...state.profile.children, { id: uid(), memberRole: null, memberName: null, name: 'New child', liabilityAccountGuid: '', allowanceAmount: 5, allowanceCadence: 'weekly', nextAllowanceDate: today(), parentMatchPercent: 0, savingsGoal: 100, entries: [] }] });
  // Household dependents from Settings — the source of truth for who these
  // children are. Empty when none are configured; manual entry then works
  // exactly as it did before.
  const householdMembers = state.response?.household?.members ?? [];
  const dependents = householdMembers.filter(member => member.role === 'dependent' && member.name.trim());
  /** Dependents free to pick: not already claimed by a different child row. */
  const availableFor = (child: FamilyBankChild) => {
    const claimed = new Set(state.profile.children
      .filter(item => item.id !== child.id && item.memberRole === 'dependent')
      .map(item => normalizePersonName(item.memberName?.trim() || item.name)));
    const own = normalizePersonName(child.memberName?.trim() || child.name);
    return dependents.filter(member => {
      const key = normalizePersonName(member.name);
      return key === own || !claimed.has(key);
    });
  };
  const addEntry = (child: FamilyBankChild, kind: FamilyBankEntryKind, approved: boolean) => {
    const raw = numberValue(entryAmount[child.id] ?? '');
    if (raw <= 0 || !(entryText[child.id] ?? '').trim()) return;
    const amount = kind === 'spend' ? -raw : raw;
    const entries = [...child.entries, { id: uid(), date: today(), description: entryText[child.id], amount, kind, approved, transactionGuid: null }];
    if (kind === 'deposit' && child.parentMatchPercent > 0) {
      entries.push({
        id: uid(),
        date: today(),
        description: `${child.parentMatchPercent}% parent savings match`,
        amount: raw * child.parentMatchPercent / 100,
        kind: 'match',
        approved: true,
        transactionGuid: null,
      });
    }
    update(child.id, { entries });
    setEntryText(current => ({ ...current, [child.id]: '' })); setEntryAmount(current => ({ ...current, [child.id]: '' }));
  };
  const advanceAllowance = (child: FamilyBankChild) => {
    const next = new Date(`${child.nextAllowanceDate}T12:00:00Z`);
    if (child.allowanceCadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7); else next.setUTCMonth(next.getUTCMonth() + 1);
    update(child.id, { entries: [...child.entries, { id: uid(), date: today(), description: 'Scheduled allowance', amount: child.allowanceAmount, kind: 'allowance', approved: true, transactionGuid: null }], nextAllowanceDate: next.toISOString().slice(0, 10) });
  };
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <PageHeader title="Family Banking" subtitle="Liability-backed child balances, allowances, chores, savings goals, and parent approvals." actions={<button type="button" onClick={addChild} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Add child</button>} />
      <p className="text-xs text-foreground-muted">
        {dependents.length === 0
          ? <>No household dependents are configured yet. Add them (with birthdays) in <Link href="/settings" className={SETTINGS_LINK}>Settings</Link> and this page fills in names and ages automatically. Until then, enter children manually.</>
          : <>Child names and ages come from your household dependents — <Link href="/settings" className={SETTINGS_LINK}>change them in Settings</Link> and every planning pack follows. Only the ledger lives here.</>}
      </p>
      {state.profile.children.length === 0 ? <Empty>Add a child and link a liability account to start an honest family ledger.</Empty> : state.profile.children.map(child => {
        const result = state.response?.children.find(item => item.child.id === child.id);
        // Age comes from the linked dependent's birthday on file in Settings.
        const linkedAge = ageFromBirthday(findDependentMember(child, householdMembers)?.birthday);
        const accountNote = child.liabilityAccountGuid ? 'Backed by a linked liability account' : 'Link a liability account before treating this balance as funded';
        return <Panel key={child.id} title={child.name} description={linkedAge != null ? `Age ${linkedAge} (household settings) · ${accountNote}` : accountNote} action={<div className="flex gap-3"><a href={`/planning/family-banking/${child.id}`} className="text-xs text-primary">Kid view</a><button type="button" onClick={() => state.change({ children: state.profile.children.filter(item => item.id !== child.id) })} className="text-xs text-negative">Remove</button></div>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4"><Metric label="Owed balance" value={formatCurrency(result?.balance ?? 0)} tone="positive" /><Metric label="Savings goal remaining" value={formatCurrency(result?.goalRemaining ?? child.savingsGoal)} /><Metric label="Goal progress" value={`${result?.goalProgressPercent ?? 0}%`} /><Metric label="Pending approval" value={String(result?.pendingCount ?? 0)} tone={(result?.pendingCount ?? 0) > 0 ? 'warning' : undefined} /></div>
          <FieldGrid className="mt-4">
            <FamilyChildIdentityFields
              child={child}
              members={householdMembers}
              available={availableFor(child)}
              onChange={patch => update(child.id, patch)}
            />
            <Field label="Liability account"><select className={INPUT} value={child.liabilityAccountGuid} onChange={event => update(child.id, { liabilityAccountGuid: event.target.value })}><option value="">Select liability account</option>{accounts.filter(account => account.type === 'LIABILITY').map(account => <option key={account.guid} value={account.guid}>{account.fullname || account.name}</option>)}</select></Field>
            <Field label="Allowance"><input type="number" className={`${INPUT} font-mono`} value={child.allowanceAmount} onChange={event => update(child.id, { allowanceAmount: numberValue(event.target.value) })} /></Field>
            <Field label="Cadence"><select className={INPUT} value={child.allowanceCadence} onChange={event => update(child.id, { allowanceCadence: event.target.value as FamilyBankChild['allowanceCadence'] })}><option>weekly</option><option>monthly</option></select></Field>
            <Field label="Next allowance"><input type="date" className={`${INPUT} font-mono`} value={child.nextAllowanceDate} onChange={event => update(child.id, { nextAllowanceDate: event.target.value })} /></Field>
            <Field label="Parent match %"><input type="number" className={`${INPUT} font-mono`} value={child.parentMatchPercent} onChange={event => update(child.id, { parentMatchPercent: numberValue(event.target.value) })} /></Field>
            <Field label="Savings goal"><input type="number" className={`${INPUT} font-mono`} value={child.savingsGoal} onChange={event => update(child.id, { savingsGoal: numberValue(event.target.value) })} /></Field>
          </FieldGrid>
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => advanceAllowance(child)} className="rounded-md border border-border px-3 py-2 text-sm text-primary">Record allowance</button></div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]"><input className={INPUT} placeholder="Chore, deposit, or purchase" value={entryText[child.id] ?? ''} onChange={event => setEntryText(current => ({ ...current, [child.id]: event.target.value }))} /><input type="number" className={`${INPUT} font-mono`} placeholder="Amount" value={entryAmount[child.id] ?? ''} onChange={event => setEntryAmount(current => ({ ...current, [child.id]: event.target.value }))} /></div>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => addEntry(child, 'chore', false)} className="rounded-md border border-border px-3 py-2 text-xs text-primary">Submit chore</button><button type="button" onClick={() => addEntry(child, 'deposit', true)} className="rounded-md border border-border px-3 py-2 text-xs text-primary">Record deposit</button><button type="button" onClick={() => addEntry(child, 'spend', true)} className="rounded-md border border-border px-3 py-2 text-xs text-primary">Record spending</button></div>
          {child.entries.length > 0 && <div className="mt-4 space-y-1">{child.entries.slice().reverse().slice(0, 30).map(entry => <div key={entry.id} className="flex items-center justify-between border-t border-border py-2 text-sm"><span>{entry.date} · {entry.description} <span className="text-xs text-foreground-muted">({entry.kind})</span></span><div className="flex items-center gap-3"><span className={`font-mono ${entry.amount >= 0 ? 'text-positive' : 'text-negative'}`} style={TNUM}>{formatCurrency(entry.amount)}</span>{!entry.approved && <button type="button" onClick={() => update(child.id, { entries: child.entries.map(item => item.id === entry.id ? { ...item, approved: true } : item) })} className="text-xs text-primary">Approve</button>}</div></div>)}</div>}
        </Panel>;
      })}
      <SaveBar saving={state.saving} dirty={state.dirty} onSave={state.save} />
    </div>
  );
}

export function FamilyBankingChildView({ childId }: { childId: string }) {
  const [result, setResult] = useState<FamilyResponse['children'][number] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/resilience/family-banking/${encodeURIComponent(childId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Ledger unavailable')))
      .then(setResult)
      .finally(() => setLoading(false));
  }, [childId]);
  if (loading) return <div className="p-6 text-sm text-foreground-muted">Loading family ledger…</div>;
  if (!result) return <div className="p-6 text-sm text-negative">This family ledger is unavailable.</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader title={`${result.child.name}'s Money`} subtitle="A read-only view of approved family ledger activity and savings progress." />
      <div className="grid grid-cols-2 gap-3"><Metric label="Your balance" value={formatCurrency(result.balance)} tone="positive" /><Metric label="Goal progress" value={`${result.goalProgressPercent}%`} /></div>
      <Panel title="Approved activity" description="Pending chores remain private until a parent approves them.">
        {result.child.entries.length === 0 ? <Empty>No approved activity yet.</Empty> : <div className="space-y-1">{result.child.entries.slice().reverse().map(entry => <div key={entry.id} className="flex justify-between border-t border-border py-3 text-sm"><span>{entry.date} · {entry.description}</span><span className={`font-mono ${entry.amount >= 0 ? 'text-positive' : 'text-negative'}`}>{formatCurrency(entry.amount)}</span></div>)}</div>}
      </Panel>
    </div>
  );
}

type TripResult = { trip: TripPlan; spent: number; remainingBudget: number; fundingGap: number; requiredMonthlySavings: number; status: string };
type TripSuggestion = { tripId: string; transactionGuid: string; date: string; description: string; amount: number };
type TripsResponse = { profile: TripsProfile; trips: TripResult[]; suggestions: TripSuggestion[] };

export function TripsPlannerPage() {
  const state = useSection<TripsProfile, TripsResponse>('trips', { trips: [] });
  const [expenseText, setExpenseText] = useState<Record<string, string>>({});
  const [expenseAmount, setExpenseAmount] = useState<Record<string, string>>({});
  if (state.loading) return <div className="p-6 text-sm text-foreground-muted">Loading trip plans…</div>;
  const update = (id: string, patch: Partial<TripPlan>) => state.change({ trips: state.profile.trips.map(trip => trip.id === id ? { ...trip, ...patch } : trip) });
  const addTrip = () => { const start = new Date(); start.setUTCMonth(start.getUTCMonth() + 6); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7); state.change({ trips: [...state.profile.trips, { id: uid(), name: 'New trip', destination: '', startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), budget: 2_000, savingsTarget: 2_000, fundedAmount: 0, tagId: null, tagName: 'vacation', current: false, expenses: [] }] }); };
  const addExpense = (trip: TripPlan, suggestion?: TripSuggestion) => {
    const amount = suggestion?.amount ?? numberValue(expenseAmount[trip.id] ?? '');
    const description = suggestion?.description ?? expenseText[trip.id] ?? '';
    if (amount <= 0 || !description.trim()) return;
    update(trip.id, { expenses: [...trip.expenses, { id: uid(), date: suggestion?.date ?? today(), description, amount, transactionGuid: suggestion?.transactionGuid ?? null }] });
    setExpenseText(current => ({ ...current, [trip.id]: '' })); setExpenseAmount(current => ({ ...current, [trip.id]: '' }));
  };
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <PageHeader title="Trip & Vacation Budgets" subtitle="Date-ranged envelopes with savings targets, transaction suggestions, live spending, and plan-versus-actual." actions={<button type="button" onClick={addTrip} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Plan trip</button>} />
      {state.profile.trips.length === 0 ? <Empty>Plan a trip to create a funding target and date-range transaction review.</Empty> : state.profile.trips.map(trip => {
        const result = state.response?.trips.find(item => item.trip.id === trip.id);
        const suggestions = state.response?.suggestions.filter(item => item.tripId === trip.id) ?? [];
        return <Panel key={trip.id} title={trip.name} description={`${result?.status ?? 'planning'} · ${trip.startDate} through ${trip.endDate}`} action={<button type="button" onClick={() => state.change({ trips: state.profile.trips.filter(item => item.id !== trip.id) })} className="text-xs text-negative">Remove</button>}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Budget" value={formatCurrency(trip.budget)} /><Metric label="Spent" value={formatCurrency(result?.spent ?? 0)} /><Metric label="Remaining" value={formatCurrency(result?.remainingBudget ?? trip.budget)} tone={(result?.remainingBudget ?? 0) < 0 ? 'negative' : 'positive'} /><Metric label="Monthly savings needed" value={formatCurrency(result?.requiredMonthlySavings ?? 0)} tone={(result?.fundingGap ?? 0) > 0 ? 'warning' : 'positive'} /></div>
          <FieldGrid className="mt-4"><Field label="Trip"><input className={INPUT} value={trip.name} onChange={event => update(trip.id, { name: event.target.value })} /></Field><Field label="Destination"><input className={INPUT} value={trip.destination} onChange={event => update(trip.id, { destination: event.target.value })} /></Field><Field label="Start"><input type="date" className={`${INPUT} font-mono`} value={trip.startDate} onChange={event => update(trip.id, { startDate: event.target.value })} /></Field><Field label="End"><input type="date" className={`${INPUT} font-mono`} value={trip.endDate} onChange={event => update(trip.id, { endDate: event.target.value })} /></Field><Field label="Budget"><input type="number" className={`${INPUT} font-mono`} value={trip.budget} onChange={event => update(trip.id, { budget: numberValue(event.target.value) })} /></Field><Field label="Savings target"><input type="number" className={`${INPUT} font-mono`} value={trip.savingsTarget} onChange={event => update(trip.id, { savingsTarget: numberValue(event.target.value) })} /></Field><Field label="Already funded"><input type="number" className={`${INPUT} font-mono`} value={trip.fundedAmount} onChange={event => update(trip.id, { fundedAmount: numberValue(event.target.value) })} /></Field><Field label="Transaction tag"><input className={INPUT} placeholder="vacation" value={trip.tagName ?? ''} onChange={event => update(trip.id, { tagName: event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || null })} /></Field><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={trip.current} onChange={event => { state.change({ trips: state.profile.trips.map(item => ({ ...item, current: item.id === trip.id ? event.target.checked : false })) }); }} /> Current trip for Quick Add</label></FieldGrid>
          {suggestions.length > 0 && <div className="mt-4 rounded-md border border-warning/40 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-warning">Suggested date-range transactions</p>{suggestions.slice(0, 20).map(item => <div key={item.transactionGuid} className="flex items-center justify-between border-t border-border py-2 text-sm"><span>{item.date} · {item.description} · <span className="font-mono">{formatCurrency(item.amount)}</span></span><button type="button" onClick={() => addExpense(trip, item)} className="text-primary">Add to trip</button></div>)}</div>}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_auto]"><input className={INPUT} placeholder="Expense description" value={expenseText[trip.id] ?? ''} onChange={event => setExpenseText(current => ({ ...current, [trip.id]: event.target.value }))} /><input type="number" className={`${INPUT} font-mono`} value={expenseAmount[trip.id] ?? ''} onChange={event => setExpenseAmount(current => ({ ...current, [trip.id]: event.target.value }))} /><button type="button" onClick={() => addExpense(trip)} className="rounded-md border border-border px-3 text-sm text-primary">Add</button></div>
          {trip.expenses.length > 0 && <div className="mt-3 space-y-1">{trip.expenses.slice().reverse().map(expense => <div key={expense.id} className="flex justify-between border-t border-border py-2 text-sm"><span>{expense.date} · {expense.description}{expense.transactionGuid && <span className="ml-2 text-xs text-positive">Linked</span>}</span><span className="font-mono">{formatCurrency(expense.amount)}</span></div>)}</div>}
        </Panel>;
      })}
      <SaveBar saving={state.saving} dirty={state.dirty} onSave={state.save} />
    </div>
  );
}

type VehicleResult = {
  vehicle: VehicleTcoAsset;
  trailing12FuelCost: number;
  /** Miles logged in the Mileage Log this calendar year (the field name predates that). */
  trailing12Miles: number;
  /** The insurance the calculation used: the vehicle's own figure, else its auto policies. */
  insurance: number;
  annualDepreciation: number;
  annualOperatingCost: number;
  annualTotalCost: number;
  monthlyRunRate: number;
  costPerMile: number;
  keepAndRepairCost: number;
  replaceCost: number;
  recommendedDecision: 'repair' | 'replace';
  decisionSavings: number;
};
type MileageVehicle = { id: string; name: string; year?: number | null; make?: string | null; model?: string | null };
type VehicleResponse = { profile: VehicleTcoProfile; vehicles: VehicleResult[]; mileageVehicles: MileageVehicle[] };
type VehicleNode = Parameters<typeof Panel>[0]['title'];

const MILEAGE_LOG_HREF = '/tools/mileage';
const INSURANCE_HREF = '/home/protection';
const VEHICLE_KEYS: Array<keyof VehicleTcoAsset> = [
  'mileageVehicleId', 'name', 'purchaseDate', 'purchasePrice', 'currentValue', 'annualInsurance',
  'annualRegistration', 'annualMaintenance', 'annualOther', 'repairCost', 'repairExtendsYears',
  'replacementVehicleCost', 'replacementAnnualOperatingCost',
];
const wholeDollars = (amount: number) => formatCurrency(amount, 'USD', 0);
const years = (count: number) => `${count} year${count === 1 ? '' : 's'}`;
const HINT = 'mt-1.5 text-xs text-foreground-muted';

/** A dollar input: "$" in front, and "/ yr" behind for yearly figures. */
function MoneyField(props: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  perYear?: boolean;
  /** Show 0 as an empty box, for fields where blank means "work it out for me". */
  blankWhenZero?: boolean;
  placeholder?: string;
  hint?: VehicleNode;
}) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div>
      {/* An explicit label, not a wrapping one: the "$" and "/ yr" marks must stay out of the field's name. */}
      <label htmlFor={props.id} className={LABEL}>{props.label}{props.perYear && <span className="sr-only"> (per year)</span>}</label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">$</span>
        <input
          id={props.id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          aria-describedby={hintId}
          placeholder={props.placeholder ?? '0'}
          // No spin buttons: they sit on top of the "/ yr" mark, and nobody steps a price by $1.
          className={`${INPUT} pl-7! font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none${props.perYear ? ' pr-12!' : ''}`}
          style={TNUM}
          value={props.blankWhenZero && props.value === 0 ? '' : props.value}
          onChange={event => props.onChange(numberValue(event.target.value))}
        />
        {props.perYear && <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">/ yr</span>}
      </div>
      {props.hint && <p id={hintId} className={HINT}>{props.hint}</p>}
    </div>
  );
}

function VehicleInputGroup(props: { title: string; description?: VehicleNode; children: VehicleNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-foreground">{props.title}</legend>
      {props.description && <p className="mt-1 text-xs text-foreground-muted">{props.description}</p>}
      <div className="mt-3">{props.children}</div>
    </fieldset>
  );
}

/**
 * The answer for one vehicle, ahead of its inputs: repair or replace, then
 * what it costs a year and per mile. The figures are the server's, computed
 * from the last save, so an edited vehicle says so instead of showing a
 * recommendation its inputs no longer support.
 */
function VehicleDecision(props: { result: VehicleResult | undefined; stale: boolean; linked: boolean }) {
  const { result } = props;
  if (!result) {
    return <p className="text-sm text-foreground-secondary">Save to work out this vehicle&apos;s yearly cost and whether to repair or replace it.</p>;
  }
  const saved = result.vehicle;
  const horizon = Math.max(1, saved.repairExtendsYears);
  const missing = [
    saved.replacementVehicleCost > 0 ? null : 'a replacement price',
    saved.replacementAnnualOperatingCost > 0 ? null : 'the replacement’s yearly running cost',
  ].filter(Boolean);
  const repairWins = result.recommendedDecision === 'repair';
  const hasMiles = result.trailing12Miles > 0;
  return (
    <div className="space-y-4">
      {props.stale && (
        <p className="text-xs text-foreground-secondary" aria-live="polite">
          These figures are from your last save. Save changes to recalculate.
        </p>
      )}
      <div data-testid="vehicle-decision">
        {missing.length > 0 ? (
          <>
            <p className="text-base font-semibold text-foreground">Repair or replace: not enough to compare yet</p>
            <p className="mt-1 text-sm text-foreground-secondary">Add {missing.join(' and ')} under Repair or replace.</p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-foreground">
              {result.decisionSavings === 0
                ? `Repairing and replacing cost the same over ${years(horizon)}`
                : <>{repairWins ? 'Repair it' : 'Replace it'}: saves <span className="font-mono text-positive" style={TNUM}>{wholeDollars(result.decisionSavings)}</span> over {years(horizon)}</>}
            </p>
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-foreground-secondary">
              <div className="flex gap-2">
                <dt>Repair</dt>
                <dd className={`font-mono ${repairWins ? 'font-semibold text-foreground' : ''}`} style={TNUM}>{wholeDollars(result.keepAndRepairCost)}</dd>
              </div>
              <div className="flex gap-2">
                <dt>Replace</dt>
                <dd className={`font-mono ${repairWins ? '' : 'font-semibold text-foreground'}`} style={TNUM}>{wholeDollars(result.replaceCost)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">Cost per year</dt>
          <dd className={`mt-1 font-mono text-lg font-semibold ${result.annualTotalCost > 0 ? 'text-foreground' : 'text-foreground-muted'}`} style={TNUM}>
            {result.annualTotalCost > 0 ? wholeDollars(result.annualTotalCost) : '—'}
          </dd>
          <dd className={HINT}>
            {result.annualTotalCost > 0 ? <>About <span className="font-mono" style={TNUM}>{wholeDollars(result.monthlyRunRate)}</span> a month</> : 'Add costs below'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">Cost per mile</dt>
          <dd className={`mt-1 font-mono text-lg font-semibold ${hasMiles ? 'text-foreground' : 'text-foreground-muted'}`} style={TNUM}>
            {hasMiles ? formatCurrency(result.costPerMile) : '—'}
          </dd>
          <dd className={HINT}>{hasMiles ? 'Cost per year ÷ miles this year' : props.linked ? 'No trips logged this year' : 'Needs a Mileage Log link'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">Miles this year</dt>
          <dd className={`mt-1 font-mono text-lg font-semibold ${hasMiles ? 'text-foreground' : 'text-foreground-muted'}`} style={TNUM}>
            {result.trailing12Miles.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </dd>
          <dd className="mt-1.5 text-xs">
            <Link href={MILEAGE_LOG_HREF} className="text-primary underline-offset-2 hover:underline">
              {props.linked ? 'Open Mileage Log' : 'Log trips in Mileage Log'} →
            </Link>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function VehicleTcoPage() {
  const state = useSection<VehicleTcoProfile, VehicleResponse>('vehicle_tco', { vehicles: [] });
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const title = 'Vehicle Total Cost';
  if (state.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} />
        <p className="text-sm text-foreground-muted" aria-live="polite">Loading vehicle costs…</p>
      </div>
    );
  }
  if (state.loadError && !state.response) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} />
        <LoadError what="your vehicle costs" message={state.loadError} onRetry={() => void state.retry()} />
      </div>
    );
  }

  const mileageVehicles = state.response?.mileageVehicles ?? [];
  const update = (id: string, patch: Partial<VehicleTcoAsset>) => state.change({ vehicles: state.profile.vehicles.map(vehicle => vehicle.id === id ? { ...vehicle, ...patch } : vehicle) });
  const addVehicle = () => {
    // Offer the first Mileage Log vehicle nothing else is costing yet.
    const taken = new Set(state.profile.vehicles.map(vehicle => vehicle.mileageVehicleId));
    const link = mileageVehicles.find(item => !taken.has(item.id)) ?? null;
    state.change({ vehicles: [...state.profile.vehicles, { id: uid(), mileageVehicleId: link?.id ?? null, name: link?.name ?? 'New vehicle', purchaseDate: today(), purchasePrice: 0, currentValue: 0, annualInsurance: 0, annualRegistration: 0, annualMaintenance: 0, annualOther: 0, repairCost: 0, repairExtendsYears: 3, replacementVehicleCost: 0, replacementAnnualOperatingCost: 0 }] });
  };
  const remove = (id: string) => {
    state.change({ vehicles: state.profile.vehicles.filter(item => item.id !== id) });
    setConfirmingRemove(null);
  };
  const discard = () => {
    state.discard();
    setConfirmingRemove(null);
  };
  const isStale = (vehicle: VehicleTcoAsset) => {
    const saved = state.response?.profile.vehicles.find(item => item.id === vehicle.id);
    return !saved || VEHICLE_KEYS.some(key => (saved[key] ?? null) !== (vehicle[key] ?? null));
  };

  const results = state.response?.vehicles ?? [];
  const fleetAnnual = results.reduce((sum, row) => sum + row.annualTotalCost, 0);
  const fleetMonthly = results.reduce((sum, row) => sum + row.monthlyRunRate, 0);
  const fleetMiles = results.reduce((sum, row) => sum + row.trailing12Miles, 0);
  const addButton = (
    <button type="button" onClick={addVehicle} className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover sm:min-h-0">
      Add vehicle
    </button>
  );
  const empty = state.profile.vehicles.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle="What each vehicle costs a year and per mile, and whether a repair beats replacing it."
        actions={empty ? undefined : addButton}
      />
      {/* One vehicle's totals are the fleet's: the row only earns its place with two or more. */}
      {results.length > 1 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Fleet cost per year" value={wholeDollars(fleetAnnual)} tone={fleetAnnual > 0 ? undefined : 'muted'} />
          <Metric label="Fleet cost per month" value={wholeDollars(fleetMonthly)} tone={fleetMonthly > 0 ? undefined : 'muted'} />
          <Metric
            label="Miles logged this year"
            value={fleetMiles.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            tone={fleetMiles > 0 ? undefined : 'muted'}
            href={MILEAGE_LOG_HREF}
            opens="Open Mileage Log"
          />
        </div>
      )}
      {empty ? (
        <Empty>
          <p className="text-base font-semibold text-foreground">No vehicles yet</p>
          <p className="mx-auto mt-2 max-w-prose">
            Add a vehicle to see what it costs a year and per mile, and whether a repair beats replacing it.
            Link it to a Mileage Log vehicle and its miles and fuel come in automatically.
          </p>
          <div className="mt-5 flex justify-center">{addButton}</div>
        </Empty>
      ) : state.profile.vehicles.map(vehicle => {
        const result = state.response?.vehicles.find(item => item.vehicle.id === vehicle.id);
        const savedVehicle = state.response?.profile.vehicles.find(item => item.id === vehicle.id);
        const linkedVehicle = mileageVehicles.find(item => item.id === vehicle.mileageVehicleId);
        const fieldId = (key: string) => `vehicle-${vehicle.id}-${key}`;
        const money = (key: 'purchasePrice' | 'currentValue' | 'annualRegistration' | 'annualMaintenance' | 'annualOther' | 'repairCost' | 'replacementVehicleCost' | 'replacementAnnualOperatingCost', label: string, extra?: { perYear?: boolean; hint?: VehicleNode }) => (
          <MoneyField id={fieldId(key)} label={label} value={vehicle[key]} onChange={value => update(vehicle.id, { [key]: value })} {...extra} />
        );
        // The server only knows the policy figure when the saved vehicle had no insurance of its own.
        const policyInsurance = savedVehicle && savedVehicle.annualInsurance === 0 && result ? result.insurance : null;
        const confirming = confirmingRemove === vehicle.id;
        const removeAction = confirming ? (
          <div role="group" aria-label={`Remove ${vehicle.name}?`} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-foreground-secondary">Remove {vehicle.name} and its inputs?</span>
            <button type="button" onClick={() => remove(vehicle.id)} className="inline-flex min-h-11 items-center px-2 font-semibold text-error hover:underline">Remove</button>
            <button type="button" onClick={() => setConfirmingRemove(null)} className="inline-flex min-h-11 items-center px-2 text-foreground-secondary hover:text-foreground">Keep</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingRemove(vehicle.id)} className="-my-3 -mr-2 inline-flex min-h-11 items-center px-2 text-xs text-foreground-muted transition-colors hover:text-error">
            Remove
          </button>
        );
        return (
          <Panel
            key={vehicle.id}
            title={vehicle.name || 'Unnamed vehicle'}
            description={linkedVehicle ? `Miles and fuel from Mileage Log: ${linkedVehicle.name}` : 'Not linked to the Mileage Log'}
            action={removeAction}
          >
            <VehicleDecision result={result} stale={Boolean(result) && isStale(vehicle)} linked={Boolean(linkedVehicle)} />
            <div className="mt-6 space-y-6 border-t border-border pt-6">
              <VehicleInputGroup title="Vehicle">
                <FieldGrid cols={2}>
                  <Field label="Name"><input className={INPUT} value={vehicle.name} onChange={event => update(vehicle.id, { name: event.target.value })} /></Field>
                  <div>
                    <Field label="Miles and fuel from">
                      <select
                        className={`${INPUT} cursor-pointer`}
                        aria-describedby={fieldId('link-hint')}
                        value={vehicle.mileageVehicleId ?? ''}
                        onChange={event => {
                          const linked = mileageVehicles.find(item => item.id === event.target.value);
                          update(vehicle.id, { mileageVehicleId: event.target.value || null, name: vehicle.name === 'New vehicle' && linked ? linked.name : vehicle.name });
                        }}
                      >
                        <option value="">Not linked</option>
                        {mileageVehicles.map(item => <option key={item.id} value={item.id}>Mileage Log vehicle: {item.name}</option>)}
                      </select>
                    </Field>
                    <p id={fieldId('link-hint')} className={HINT}>
                      {vehicle.mileageVehicleId
                        ? 'Uses this year’s logged trips for miles and the last 12 months of fill-ups for fuel.'
                        : mileageVehicles.length === 0
                          ? <>No vehicles in the <Link href={MILEAGE_LOG_HREF} className="text-primary underline-offset-2 hover:underline">Mileage Log</Link> yet. Until one is linked, fuel and miles count as zero.</>
                          : 'Unlinked, fuel and miles count as zero, so there is no cost per mile.'}
                    </p>
                  </div>
                </FieldGrid>
              </VehicleInputGroup>

              <VehicleInputGroup
                title="Ownership"
                description={result && savedVehicle && !isStale(vehicle)
                  ? <>Loses about <span className="font-mono" style={TNUM}>{wholeDollars(result.annualDepreciation)}</span> a year: purchase price less current value, spread over the years owned.</>
                  : 'Depreciation is the purchase price less the current value, spread over the years owned.'}
              >
                <FieldGrid>
                  <Field label="Purchase date"><input type="date" className={`${INPUT} font-mono`} value={vehicle.purchaseDate} onChange={event => update(vehicle.id, { purchaseDate: event.target.value })} /></Field>
                  {money('purchasePrice', 'Purchase price')}
                  {money('currentValue', 'Current value')}
                </FieldGrid>
              </VehicleInputGroup>

              <VehicleInputGroup
                title="Running costs"
                description={!linkedVehicle
                  ? 'Fuel isn’t counted until a Mileage Log vehicle is linked. Add the rest by the year.'
                  : result && !isStale(vehicle)
                    ? <>Fuel is <span className="font-mono" style={TNUM}>{wholeDollars(result.trailing12FuelCost)}</span> over the last 12 months, from Mileage Log fill-ups. Add the rest by the year.</>
                    : 'Fuel comes from the linked Mileage Log vehicle’s fill-ups. Add the rest by the year.'}
              >
                <FieldGrid cols={2}>
                  <MoneyField
                    id={fieldId('annualInsurance')}
                    label="Insurance"
                    perYear
                    blankWhenZero
                    placeholder={policyInsurance ? String(policyInsurance) : '0'}
                    value={vehicle.annualInsurance}
                    onChange={value => update(vehicle.id, { annualInsurance: value })}
                    hint={<>Leave blank to use your auto policies in <Link href={INSURANCE_HREF} className="text-primary underline-offset-2 hover:underline">Insurance Coverage</Link>{policyInsurance !== null ? <> (<span className="font-mono" style={TNUM}>{wholeDollars(policyInsurance)}</span> a year{policyInsurance === 0 ? ', none recorded' : ''})</> : ''}.</>}
                  />
                  {money('annualRegistration', 'Registration and taxes', { perYear: true })}
                  {money('annualMaintenance', 'Maintenance', { perYear: true })}
                  {money('annualOther', 'Other', { perYear: true, hint: 'Parking, tolls, inspections, anything else.' })}
                </FieldGrid>
              </VehicleInputGroup>

              <VehicleInputGroup title="Repair or replace" description="Both paths are compared over the years the repair buys you.">
                <FieldGrid cols={2}>
                  {money('repairCost', 'Repair estimate')}
                  <div>
                    <Field label="Years the repair buys">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        aria-describedby={fieldId('repairExtendsYears-hint')}
                        className={`${INPUT} font-mono`}
                        style={TNUM}
                        value={vehicle.repairExtendsYears}
                        onChange={event => update(vehicle.id, { repairExtendsYears: numberValue(event.target.value) })}
                      />
                    </Field>
                    <p id={fieldId('repairExtendsYears-hint')} className={HINT}>Repair path: the estimate plus this many years of today&apos;s running costs.</p>
                  </div>
                  {money('replacementVehicleCost', 'Replacement price', { hint: 'Less this vehicle’s current value, as a trade-in.' })}
                  {money('replacementAnnualOperatingCost', 'Replacement running costs', { perYear: true, hint: 'Fuel, insurance, registration and maintenance for the replacement.' })}
                </FieldGrid>
              </VehicleInputGroup>
            </div>
          </Panel>
        );
      })}
      <SaveBar saving={state.saving} dirty={state.dirty} onSave={state.save} onDiscard={discard} />
    </div>
  );
}
