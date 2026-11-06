'use client';

import { useCallback, useEffect, useState, Fragment } from 'react';
import Link from 'next/link';
import type { HomeTask, HomeItem, HomeServiceEntry, TaskStatus } from '@/lib/services/home.service';
import { formatCurrency } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { PersonalToolNotice } from '@/components/PersonalToolNotice';
import { useToast } from '@/contexts/ToastContext';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';
import { INPUT, LABEL, SELECT, inputClass } from '@/components/ui/form';
import { Tabs } from '@/components/resilience/ui';
import { TransactionPicker } from '@/components/receipts/TransactionPicker';
import { TNUM } from '@/components/home/home-shared';

const SEASON_OPTIONS = [
    { value: '', label: '—' },
    { value: 'spring', label: 'Spring' },
    { value: 'summer', label: 'Summer' },
    { value: 'fall', label: 'Fall' },
    { value: 'winter', label: 'Winter' },
    { value: 'spring+fall', label: 'Spring + Fall' },
];

type TaskGroupKey = TaskStatus | 'baseline';

const TASK_GROUPS: Array<{ key: TaskGroupKey; label: string; tone: string; hint?: string }> = [
    { key: 'overdue', label: 'Overdue', tone: 'text-error' },
    { key: 'due_soon', label: 'Due soon (30 days)', tone: 'text-warning' },
    {
        key: 'baseline',
        label: 'Needs a baseline',
        tone: 'text-foreground-secondary',
        hint: 'Never logged, so there is no due date yet. Set when each was last done to schedule it.',
    },
    { key: 'later', label: 'Later', tone: 'text-foreground-muted' },
    { key: 'unscheduled', label: 'Unscheduled', tone: 'text-foreground-muted' },
];

/**
 * A cadence task that has never been done has no anchor, so no due date. The
 * service files it under "due soon" so it surfaces; here it gets its own group
 * instead, because nothing about it is actually due and a warning colour would
 * be a false alarm. Season-only tasks always have a next anchor and stay put.
 */
function needsBaseline(task: HomeTask): boolean {
    return !task.lastDone && task.nextDue === null && (task.cadenceMonths ?? 0) > 0;
}

function taskGroup(task: HomeTask): TaskGroupKey {
    return needsBaseline(task) ? 'baseline' : task.status;
}

interface TaskFormState {
    name: string;
    cadenceMonths: string;
    season: string;
    itemId: string;
    lastDone: string;
    notes: string;
}

function emptyTaskForm(): TaskFormState {
    return { name: '', cadenceMonths: '', season: '', itemId: '', lastDone: '', notes: '' };
}

function taskFormFrom(task: HomeTask): TaskFormState {
    return {
        name: task.name,
        cadenceMonths: task.cadenceMonths !== null ? String(task.cadenceMonths) : '',
        season: task.season ?? '',
        itemId: task.itemId !== null ? String(task.itemId) : '',
        lastDone: task.lastDone ?? '',
        notes: task.notes ?? '',
    };
}

function taskFormBody(form: TaskFormState): Record<string, unknown> {
    return {
        name: form.name.trim(),
        cadenceMonths: form.cadenceMonths === '' ? null : Number(form.cadenceMonths),
        season: form.season || null,
        itemId: form.itemId === '' ? null : Number(form.itemId),
        lastDone: form.lastDone || null,
        notes: form.notes || null,
    };
}

interface DoneFormState {
    date: string;
    cost: string;
    vendor: string;
    txnGuid: string;
    notes: string;
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function cadenceLabel(task: HomeTask): string {
    const parts: string[] = [];
    if (task.cadenceMonths) parts.push(`every ${task.cadenceMonths} mo`);
    if (task.seasonLabel) parts.push(task.seasonLabel);
    return parts.join(' · ') || 'no schedule';
}

/**
 * The one date reading a row shows: when it is next due, or — for a task with
 * no schedule — when it was last done. Never both, and never the same fact
 * twice.
 */
function scheduleReading(task: HomeTask): { text: string; tone: string; mono: boolean } {
    if (task.nextDue) {
        const d = task.daysUntilDue;
        const tone =
            task.status === 'overdue'
                ? 'text-error'
                : task.status === 'due_soon'
                  ? 'text-warning'
                  : 'text-foreground-secondary';
        if (d === null) return { text: `Due ${task.nextDue}`, tone, mono: true };
        if (d < 0) return { text: `Due ${task.nextDue} · ${Math.abs(d)}d overdue`, tone, mono: true };
        if (d === 0) return { text: `Due today`, tone, mono: true };
        return { text: `Due ${task.nextDue} · in ${d}d`, tone, mono: true };
    }
    return {
        text: task.lastDone ? `Last done ${task.lastDone}` : 'Not done yet',
        tone: 'text-foreground-muted',
        mono: Boolean(task.lastDone),
    };
}

type Panel = { taskId: number; kind: 'done' | 'history' | 'edit' } | null;

/** Row action that must stay a comfortable tap target on phones. */
const ROW_ACTION =
    'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors sm:min-h-9 disabled:opacity-50';

/**
 * Optional link from a service entry to a ledger transaction, chosen by
 * searching rather than by pasting a 32-character GUID.
 */
function LinkedTransactionField({
    id,
    value,
    onChange,
}: {
    id: string;
    value: string;
    onChange: (guid: string) => void;
}) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [summary, setSummary] = useState<{ guid: string; text: string } | null>(null);

    useEffect(() => {
        if (!value || summary?.guid === value) return;
        let cancelled = false;
        fetch(`/api/transactions/${value}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json: { description?: string; post_date?: string } | null) => {
                if (cancelled || !json) return;
                const date = json.post_date ? String(json.post_date).slice(0, 10) : '';
                const text = [json.description || '(no description)', date].filter(Boolean).join(' · ');
                setSummary({ guid: value, text });
            })
            .catch(() => {
                /* the summary is cosmetic; the link itself is already set */
            });
        return () => {
            cancelled = true;
        };
    }, [value, summary?.guid]);

    const labelId = `${id}-label`;
    return (
        <div role="group" aria-labelledby={labelId}>
            <span id={labelId} className={LABEL}>
                Linked transaction (optional)
            </span>
            {value ? (
                <div className="flex min-h-[42px] items-center gap-3 rounded-md border border-border px-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {summary?.guid === value ? summary.text : 'Transaction linked'}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="text-sm text-primary transition-colors hover:text-primary-hover"
                    >
                        Change
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="text-sm text-foreground-muted transition-colors hover:text-foreground"
                    >
                        Remove
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className={inputClass({ extra: 'text-left text-foreground-secondary' })}
                >
                    Search transactions…
                </button>
            )}
            <TransactionPicker
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={(guid) => onChange(guid)}
            />
        </div>
    );
}

export default function HomeMaintenancePage() {
    const toast = useToast();
    const [tasks, setTasks] = useState<HomeTask[] | null>(null);
    const [items, setItems] = useState<HomeItem[]>([]);
    const [logEntries, setLogEntries] = useState<HomeServiceEntry[]>([]);
    const [ytdCost, setYtdCost] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [tab, setTab] = useState<'tasks' | 'log'>('tasks');
    const [panel, setPanel] = useState<Panel>(null);
    const [history, setHistory] = useState<Record<number, HomeServiceEntry[]>>({});
    const [saving, setSaving] = useState(false);

    const [seeding, setSeeding] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [addForm, setAddForm] = useState<TaskFormState>(emptyTaskForm());
    const [editForm, setEditForm] = useState<TaskFormState>(emptyTaskForm());
    const [doneForm, setDoneForm] = useState<DoneFormState>({
        date: today(),
        cost: '',
        vendor: '',
        txnGuid: '',
        notes: '',
    });
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

    // Standalone service-log entry form (log tab)
    const [logForm, setLogForm] = useState({
        date: today(),
        taskId: '',
        itemId: '',
        cost: '',
        vendor: '',
        txnGuid: '',
        notes: '',
    });
    const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<number | null>(null);
    // "Last done" dates typed into the baseline group, keyed by task id.
    const [baselineDates, setBaselineDates] = useState<Record<number, string>>({});

    const load = useCallback(async () => {
        try {
            const [tasksRes, itemsRes, logRes] = await Promise.all([
                fetch('/api/home/tasks?includeInactive=true'),
                fetch('/api/home/items'),
                fetch('/api/home/service-log'),
            ]);
            if (!tasksRes.ok || !logRes.ok) throw new Error('Request failed');
            const tasksJson = (await tasksRes.json()) as { tasks: HomeTask[] };
            const logJson = (await logRes.json()) as {
                entries: HomeServiceEntry[];
                ytdCost: number;
            };
            setTasks(tasksJson.tasks);
            setLogEntries(logJson.entries);
            setYtdCost(logJson.ytdCost);
            if (itemsRes.ok) {
                const itemsJson = (await itemsRes.json()) as { items: HomeItem[] };
                setItems(itemsJson.items);
            }
            setHistory({});
            setError(null);
        } catch {
            setError('Failed to load maintenance tasks.');
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await load();
            if (!cancelled) setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    const seedTemplate = async () => {
        setSeeding(true);
        try {
            const res = await fetch('/api/home/tasks/seed', { method: 'POST' });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to seed template');
            }
            toast.success('Standard maintenance template added — edit anything to fit your home');
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to seed template');
        } finally {
            setSeeding(false);
        }
    };

    const openPanel = (taskId: number, kind: 'done' | 'history' | 'edit', task?: HomeTask) => {
        if (panel?.taskId === taskId && panel.kind === kind) {
            setPanel(null);
            return;
        }
        setPanel({ taskId, kind });
        setConfirmDeleteId(null);
        if (kind === 'done') {
            setDoneForm({ date: today(), cost: '', vendor: '', txnGuid: '', notes: '' });
        }
        if (kind === 'edit' && task) setEditForm(taskFormFrom(task));
        if (kind === 'history' && history[taskId] === undefined) {
            fetch(`/api/home/service-log?taskId=${taskId}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((json) => {
                    if (json) setHistory((prev) => ({ ...prev, [taskId]: json.entries }));
                })
                .catch(() => {
                    /* history panel is best-effort */
                });
        }
    };

    const handleMarkDone = async (task: HomeTask) => {
        setSaving(true);
        try {
            const res = await fetch('/api/home/service-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: task.id,
                    itemId: task.itemId,
                    serviceDate: doneForm.date,
                    cost: doneForm.cost === '' ? null : Number(doneForm.cost),
                    vendor: doneForm.vendor || null,
                    txnGuid: doneForm.txnGuid || null,
                    notes: doneForm.notes || null,
                }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to log service');
            }
            toast.success(`${task.name} marked done`);
            setPanel(null);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to log service');
        } finally {
            setSaving(false);
        }
    };

    const handleCreateTask = async () => {
        if (!addForm.name.trim()) {
            toast.error('Task name is required');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/home/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskFormBody(addForm)),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to create task');
            }
            toast.success('Task added');
            setAddForm(emptyTaskForm());
            setAddOpen(false);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create task');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveTask = async (task: HomeTask) => {
        if (!editForm.name.trim()) {
            toast.error('Task name is required');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/home/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskFormBody(editForm)),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Save failed');
            }
            toast.success('Task updated');
            setPanel(null);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update task');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (task: HomeTask) => {
        try {
            const res = await fetch(`/api/home/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !task.active }),
            });
            if (!res.ok) throw new Error('Failed');
            await load();
        } catch {
            toast.error('Failed to update task');
        }
    };

    /** Record when a never-logged task was last done, which gives it a due date. */
    const handleSetBaseline = async (task: HomeTask) => {
        const lastDone = baselineDates[task.id];
        if (!lastDone) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/home/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastDone }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to update task');
            }
            toast.success(`${task.name} scheduled`);
            setBaselineDates((prev) => {
                const next = { ...prev };
                delete next[task.id];
                return next;
            });
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update task');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteTask = async (id: number) => {
        try {
            const res = await fetch(`/api/home/tasks/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            toast.success('Task deleted');
            setConfirmDeleteId(null);
            await load();
        } catch {
            toast.error('Failed to delete task');
        }
    };

    const handleAddLogEntry = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/home/service-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serviceDate: logForm.date,
                    taskId: logForm.taskId === '' ? null : Number(logForm.taskId),
                    itemId: logForm.itemId === '' ? null : Number(logForm.itemId),
                    cost: logForm.cost === '' ? null : Number(logForm.cost),
                    vendor: logForm.vendor || null,
                    txnGuid: logForm.txnGuid || null,
                    notes: logForm.notes || null,
                }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to log service');
            }
            toast.success('Service logged');
            setLogForm({
                date: today(),
                taskId: '',
                itemId: '',
                cost: '',
                vendor: '',
                txnGuid: '',
                notes: '',
            });
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to log service');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteLogEntry = async (id: number) => {
        try {
            const res = await fetch(`/api/home/service-log/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            toast.success('Entry deleted');
            setConfirmDeleteLogId(null);
            await load();
        } catch {
            toast.error('Failed to delete entry');
        }
    };

    const activeTasks = (tasks ?? []).filter((t) => t.active);
    const inactiveTasks = (tasks ?? []).filter((t) => !t.active);

    const renderTaskForm = (
        form: TaskFormState,
        setForm: (f: TaskFormState) => void,
        onSubmit: () => void,
        onCancel: () => void,
        submitLabel: string,
    ) => (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="sm:col-span-2">
                    <span className={LABEL}>Task name *</span>
                    <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="e.g. Replace HVAC filter"
                        className={INPUT}
                    />
                </label>
                <label>
                    <span className={LABEL}>Every N months</span>
                    <input
                        type="number"
                        min="1"
                        max="120"
                        value={form.cadenceMonths}
                        onChange={(e) => setForm({ ...form, cadenceMonths: e.target.value })}
                        placeholder="e.g. 3"
                        className={inputClass({ extra: 'font-mono' })}
                        style={TNUM}
                    />
                </label>
                <label>
                    <span className={LABEL}>Season</span>
                    <select
                        value={form.season}
                        onChange={(e) => setForm({ ...form, season: e.target.value })}
                        className={SELECT}
                    >
                        {SEASON_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className={LABEL}>Linked item (optional)</span>
                    <select
                        value={form.itemId}
                        onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                        className={SELECT}
                    >
                        <option value="">None</option>
                        {items.map((i) => (
                            <option key={i.id} value={String(i.id)}>
                                {i.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className={LABEL}>Last done</span>
                    <input
                        type="date"
                        value={form.lastDone}
                        onChange={(e) => setForm({ ...form, lastDone: e.target.value })}
                        className={inputClass({ extra: 'font-mono' })}
                    />
                </label>
                <label className="sm:col-span-2">
                    <span className={LABEL}>Notes</span>
                    <input
                        type="text"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Filter size, breaker location…"
                        className={INPUT}
                    />
                </label>
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={saving}
                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                    {saving ? 'Saving…' : submitLabel}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );

    const renderTaskRow = (task: HomeTask) => {
        const baseline = task.active && needsBaseline(task);
        const reading = baseline ? null : scheduleReading(task);
        const confirmingDelete = confirmDeleteId === task.id;
        // Mark done (or Resume, for a paused task) is the one visible action;
        // everything else lives in the row's overflow menu.
        const menuItems: ActionMenuItem[] = [
            ...(baseline ? [{ label: 'Mark done', onSelect: () => openPanel(task.id, 'done') }] : []),
            { label: 'History', onSelect: () => openPanel(task.id, 'history') },
            { label: 'Edit', onSelect: () => openPanel(task.id, 'edit', task) },
            ...(task.active ? [{ label: 'Pause', onSelect: () => void handleToggleActive(task) }] : []),
            {
                label: 'Delete…',
                destructive: true,
                onSelect: () => {
                    setPanel(null);
                    setConfirmDeleteId(task.id);
                },
            },
        ];
        return (
            <Fragment key={task.id}>
                <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/30 px-4 py-2 last:border-b-0">
                    <div className="min-w-0 flex-1 basis-full py-1 sm:basis-48">
                        <span className="text-sm text-foreground">{task.name}</span>
                        <span className="ml-3 text-xs text-foreground-muted">
                            {cadenceLabel(task)}
                            {task.itemName && ` · ${task.itemName}`}
                        </span>
                        {task.notes && (
                            <p className="mt-0.5 truncate text-xs text-foreground-muted">{task.notes}</p>
                        )}
                    </div>
                    {reading && (
                        <span
                            className={`text-xs ${reading.mono ? 'font-mono' : ''} ${reading.tone}`}
                            style={reading.mono ? TNUM : undefined}
                        >
                            {reading.text}
                        </span>
                    )}
                    {confirmingDelete ? (
                        <div className="ml-auto flex items-center gap-1" role="group" aria-label={`Delete ${task.name}`}>
                            <span className="text-sm text-foreground-secondary">Delete this task?</span>
                            <button
                                type="button"
                                onClick={() => handleDeleteTask(task.id)}
                                className={`${ROW_ACTION} text-error hover:bg-error/10`}
                            >
                                Delete
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className={`${ROW_ACTION} font-normal text-foreground-secondary hover:text-foreground`}
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div className="ml-auto flex items-center gap-1">
                            {baseline ? (
                                <form
                                    className="flex items-center gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleSetBaseline(task);
                                    }}
                                >
                                    <label
                                        htmlFor={`baseline-${task.id}`}
                                        className="whitespace-nowrap text-xs text-foreground-secondary"
                                    >
                                        Last done
                                    </label>
                                    <div className="w-40">
                                        <input
                                            id={`baseline-${task.id}`}
                                            type="date"
                                            max={today()}
                                            value={baselineDates[task.id] ?? ''}
                                            onChange={(e) =>
                                                setBaselineDates((prev) => ({ ...prev, [task.id]: e.target.value }))
                                            }
                                            className={inputClass({ extra: 'py-2 font-mono' })}
                                            style={TNUM}
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={saving || !baselineDates[task.id]}
                                        className={`${ROW_ACTION} border border-border text-foreground hover:border-border-hover hover:bg-surface-hover`}
                                    >
                                        Set
                                    </button>
                                </form>
                            ) : task.active ? (
                                <button
                                    type="button"
                                    onClick={() => openPanel(task.id, 'done')}
                                    aria-expanded={panel?.taskId === task.id && panel.kind === 'done'}
                                    className={`${ROW_ACTION} text-primary hover:bg-primary-light hover:text-primary-hover`}
                                >
                                    Mark done
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => handleToggleActive(task)}
                                    className={`${ROW_ACTION} text-primary hover:bg-primary-light hover:text-primary-hover`}
                                >
                                    Resume
                                </button>
                            )}
                            <ActionMenu
                                items={menuItems}
                                label={`More actions for ${task.name}`}
                                size="touch"
                                className="shrink-0"
                            />
                        </div>
                    )}
                </li>
                {panel?.taskId === task.id && (
                    <li className="border-b border-border/30 bg-background-tertiary/30 px-4 py-3 last:border-b-0">
                        {panel.kind === 'done' && (
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <label>
                                        <span className={LABEL}>Date</span>
                                        <input
                                            type="date"
                                            value={doneForm.date}
                                            onChange={(e) =>
                                                setDoneForm({ ...doneForm, date: e.target.value })
                                            }
                                            className={inputClass({ extra: 'font-mono' })}
                                        />
                                    </label>
                                    <label>
                                        <span className={LABEL}>Cost (optional)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={doneForm.cost}
                                            onChange={(e) =>
                                                setDoneForm({ ...doneForm, cost: e.target.value })
                                            }
                                            placeholder="0.00"
                                            className={inputClass({ extra: 'font-mono' })}
                                            style={TNUM}
                                        />
                                    </label>
                                    <label>
                                        <span className={LABEL}>Vendor (optional)</span>
                                        <input
                                            type="text"
                                            value={doneForm.vendor}
                                            onChange={(e) =>
                                                setDoneForm({ ...doneForm, vendor: e.target.value })
                                            }
                                            className={INPUT}
                                        />
                                    </label>
                                    <LinkedTransactionField
                                        id={`done-txn-${task.id}`}
                                        value={doneForm.txnGuid}
                                        onChange={(txnGuid) => setDoneForm({ ...doneForm, txnGuid })}
                                    />
                                    <label>
                                        <span className={LABEL}>Notes</span>
                                        <input
                                            type="text"
                                            value={doneForm.notes}
                                            onChange={(e) =>
                                                setDoneForm({ ...doneForm, notes: e.target.value })
                                            }
                                            className={INPUT}
                                        />
                                    </label>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => handleMarkDone(task)}
                                        disabled={saving}
                                        className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50"
                                    >
                                        {saving ? 'Saving…' : 'Log service'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPanel(null)}
                                        className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                        {panel.kind === 'history' &&
                            (history[task.id] === undefined ? (
                                <p className="text-sm text-foreground-muted">Loading history…</p>
                            ) : history[task.id].length === 0 ? (
                                <p className="text-sm text-foreground-muted">
                                    No service history for this task yet.
                                </p>
                            ) : (
                                <ul className="space-y-1">
                                    {history[task.id].map((entry) => (
                                        <li
                                            key={entry.id}
                                            className="flex flex-wrap items-center gap-x-4 text-sm"
                                        >
                                            <span className="font-mono text-foreground-secondary" style={TNUM}>
                                                {entry.serviceDate}
                                            </span>
                                            <span className="font-mono text-foreground-secondary" style={TNUM}>
                                                {entry.cost !== null ? formatCurrency(entry.cost) : '—'}
                                            </span>
                                            {entry.vendor && (
                                                <span className="text-foreground-secondary">{entry.vendor}</span>
                                            )}
                                            {entry.notes && (
                                                <span className="text-xs text-foreground-muted">{entry.notes}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ))}
                        {panel.kind === 'edit' &&
                            renderTaskForm(
                                editForm,
                                setEditForm,
                                () => handleSaveTask(task),
                                () => setPanel(null),
                                'Save',
                            )}
                    </li>
                )}
            </Fragment>
        );
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Home Maintenance"
                subtitle="Recurring and seasonal upkeep with a service log — so nothing quietly rusts, clogs, or burns out."
                actions={
                    // Adding a task only makes sense on the task list; the service
                    // log has its own entry form.
                    tab === 'tasks' ? (
                        <button
                            type="button"
                            onClick={() => setAddOpen((v) => !v)}
                            aria-expanded={addOpen}
                            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors"
                        >
                            Add task
                        </button>
                    ) : undefined
                }
            />

            <PersonalToolNotice />

            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <span className="text-foreground-secondary">Loading...</span>
                    </div>
                </div>
            )}

            {!loading && error && (
                <div className="border border-error/30 bg-surface/30 rounded-lg p-4">
                    <p className="text-sm text-error">{error}</p>
                </div>
            )}

            {!loading && !error && tasks !== null && (
                <>
                    <div className="flex items-stretch">
                        <div className="min-w-0 flex-1">
                            <Tabs
                                label="Maintenance views"
                                value={tab}
                                onChange={setTab}
                                tabs={[
                                    { value: 'tasks', label: 'Tasks' },
                                    { value: 'log', label: 'Service log' },
                                ]}
                            />
                        </div>
                        <Link
                            href="/home/inventory"
                            className="flex shrink-0 items-center border-b border-border pl-3 text-sm text-primary hover:text-primary-hover transition-colors"
                        >
                            Home inventory →
                        </Link>
                    </div>

                    {tab === 'tasks' && (
                        <div role="tabpanel" aria-label="Tasks" className="space-y-6">
                            {addOpen && (
                                <div className="bg-background-secondary/30 border border-border rounded-lg p-4">
                                    {renderTaskForm(
                                        addForm,
                                        setAddForm,
                                        handleCreateTask,
                                        () => {
                                            setAddOpen(false);
                                            setAddForm(emptyTaskForm());
                                        },
                                        'Add task',
                                    )}
                                </div>
                            )}

                            {tasks.length === 0 && (
                                <div className="bg-background-secondary/30 border border-border rounded-lg p-6 space-y-3">
                                    <p className="text-sm text-foreground">
                                        No maintenance tasks yet. Start with the standard template —
                                        every task is editable afterwards:
                                    </p>
                                    <p className="text-sm text-foreground-secondary">
                                        HVAC filter (3mo) · smoke/CO detector test (6mo) + batteries
                                        (12mo) · gutters (spring + fall) · water heater flush (12mo) ·
                                        dryer vent (12mo) · refrigerator coils (12mo) · sump pump test
                                        (spring) · winterize outdoor faucets (fall) · HVAC service (12mo)
                                    </p>
                                    <button
                                        type="button"
                                        onClick={seedTemplate}
                                        disabled={seeding}
                                        className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50"
                                    >
                                        {seeding ? 'Adding…' : 'Seed standard template'}
                                    </button>
                                </div>
                            )}

                            {TASK_GROUPS.map((group) => {
                                const groupTasks = activeTasks.filter((t) => taskGroup(t) === group.key);
                                if (groupTasks.length === 0) return null;
                                const headingId = `task-group-${group.key}`;
                                return (
                                    <section
                                        key={group.key}
                                        aria-labelledby={headingId}
                                        className="bg-background-secondary/30 border border-border rounded-lg overflow-hidden"
                                    >
                                        <div className="border-b border-border px-4 py-2.5">
                                            <h2
                                                id={headingId}
                                                className={`text-xs font-semibold uppercase tracking-wider ${group.tone}`}
                                            >
                                                {group.label}
                                                <span className="ml-2 font-mono" style={TNUM}>
                                                    {groupTasks.length}
                                                </span>
                                            </h2>
                                            {group.hint && (
                                                <p className="mt-0.5 text-xs text-foreground-muted">{group.hint}</p>
                                            )}
                                        </div>
                                        <ul>{groupTasks.map(renderTaskRow)}</ul>
                                    </section>
                                );
                            })}

                            {inactiveTasks.length > 0 && (
                                <section
                                    aria-labelledby="task-group-paused"
                                    className="bg-background-secondary/30 border border-border rounded-lg overflow-hidden"
                                >
                                    <h2
                                        id="task-group-paused"
                                        className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted"
                                    >
                                        Paused
                                        <span className="ml-2 font-mono" style={TNUM}>
                                            {inactiveTasks.length}
                                        </span>
                                    </h2>
                                    <ul>{inactiveTasks.map(renderTaskRow)}</ul>
                                </section>
                            )}
                        </div>
                    )}

                    {tab === 'log' && (
                        <div role="tabpanel" aria-label="Service log" className="space-y-6">
                            <div className="bg-background-secondary/30 border border-border rounded-lg p-5">
                                <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                                    Maintenance cost — year to date
                                </p>
                                <p
                                    className="mt-1 font-mono text-3xl font-semibold text-foreground"
                                    style={TNUM}
                                >
                                    {formatCurrency(ytdCost)}
                                </p>
                            </div>

                            {/* Add standalone entry */}
                            <div className="bg-background-secondary/30 border border-border rounded-lg p-4 space-y-3">
                                <p className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                                    Log a service
                                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <label>
                                        <span className={LABEL}>Date</span>
                                        <input
                                            type="date"
                                            value={logForm.date}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, date: e.target.value })
                                            }
                                            className={inputClass({ extra: 'font-mono' })}
                                        />
                                    </label>
                                    <label>
                                        <span className={LABEL}>Task (optional)</span>
                                        <select
                                            value={logForm.taskId}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, taskId: e.target.value })
                                            }
                                            className={SELECT}
                                        >
                                            <option value="">None</option>
                                            {(tasks ?? []).map((t) => (
                                                <option key={t.id} value={String(t.id)}>
                                                    {t.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        <span className={LABEL}>Item (optional)</span>
                                        <select
                                            value={logForm.itemId}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, itemId: e.target.value })
                                            }
                                            className={SELECT}
                                        >
                                            <option value="">None</option>
                                            {items.map((i) => (
                                                <option key={i.id} value={String(i.id)}>
                                                    {i.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        <span className={LABEL}>Cost</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={logForm.cost}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, cost: e.target.value })
                                            }
                                            placeholder="0.00"
                                            className={inputClass({ extra: 'font-mono' })}
                                            style={TNUM}
                                        />
                                    </label>
                                    <label>
                                        <span className={LABEL}>Vendor</span>
                                        <input
                                            type="text"
                                            value={logForm.vendor}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, vendor: e.target.value })
                                            }
                                            className={INPUT}
                                        />
                                    </label>
                                    <LinkedTransactionField
                                        id="log-txn"
                                        value={logForm.txnGuid}
                                        onChange={(txnGuid) => setLogForm({ ...logForm, txnGuid })}
                                    />
                                    <label className="sm:col-span-2">
                                        <span className={LABEL}>Notes</span>
                                        <input
                                            type="text"
                                            value={logForm.notes}
                                            onChange={(e) =>
                                                setLogForm({ ...logForm, notes: e.target.value })
                                            }
                                            className={INPUT}
                                        />
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAddLogEntry}
                                    disabled={saving}
                                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50"
                                >
                                    {saving ? 'Saving…' : 'Add entry'}
                                </button>
                            </div>

                            {logEntries.length === 0 ? (
                                <div className="bg-background-secondary/30 border border-border rounded-lg p-8 text-center">
                                    <p className="text-sm text-foreground-secondary">
                                        No service history yet. Marking a task done logs an entry here
                                        automatically.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-background-secondary/30 border border-border rounded-lg overflow-hidden">
                                    <ul>
                                        {logEntries.map((entry) => (
                                            <li
                                                key={entry.id}
                                                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/30 px-4 py-2.5 last:border-b-0"
                                            >
                                                <span
                                                    className="font-mono text-xs text-foreground-secondary"
                                                    style={TNUM}
                                                >
                                                    {entry.serviceDate}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <span className="text-sm text-foreground">
                                                        {entry.taskName ?? entry.itemName ?? 'Service'}
                                                    </span>
                                                    <span className="ml-3 text-xs text-foreground-muted">
                                                        {[
                                                            entry.taskName && entry.itemName
                                                                ? entry.itemName
                                                                : null,
                                                            entry.vendor,
                                                            entry.txnGuid ? 'txn linked' : null,
                                                            entry.notes,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </span>
                                                </div>
                                                <span
                                                    className="font-mono text-sm text-foreground-secondary"
                                                    style={TNUM}
                                                >
                                                    {entry.cost !== null
                                                        ? formatCurrency(entry.cost)
                                                        : '—'}
                                                </span>
                                                {confirmDeleteLogId === entry.id ? (
                                                    <span className="flex items-center gap-2 text-sm">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleDeleteLogEntry(entry.id)
                                                            }
                                                            className="font-medium text-error hover:opacity-80 transition-opacity"
                                                        >
                                                            Confirm
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteLogId(null)}
                                                            className="text-foreground-muted hover:text-foreground transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDeleteLogId(entry.id)}
                                                        className="text-sm text-foreground-muted hover:text-error transition-colors"
                                                    >
                                                        Delete
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
