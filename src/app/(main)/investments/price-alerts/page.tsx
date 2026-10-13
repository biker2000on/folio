'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/contexts/ToastContext';
import { LABEL, SELECT, inputClass } from '@/components/ui/form';
import { EmptyState, InvestmentsPage, KpiCard, Panel } from '@/components/investments/ui';

interface PriceAlert {
    id: number;
    commodityGuid: string;
    mnemonic: string;
    fullname: string | null;
    direction: 'above' | 'below';
    threshold: number;
    enabled: boolean;
    lastTriggeredAt: string | null;
    createdAt: string;
}

interface Commodity {
    guid: string;
    namespace: string;
    mnemonic: string;
    fullname: string | null;
}

function formatThreshold(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceAlertsPage() {
    const { success, error } = useToast();
    const [alerts, setAlerts] = useState<PriceAlert[]>([]);
    const [commodities, setCommodities] = useState<Commodity[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    // Add form state
    const [commodityGuid, setCommodityGuid] = useState('');
    const [direction, setDirection] = useState<'above' | 'below'>('above');
    const [threshold, setThreshold] = useState('');

    const load = useCallback(async () => {
        try {
            const [alertsRes, commoditiesRes] = await Promise.all([
                fetch('/api/investments/price-alerts'),
                fetch('/api/commodities'),
            ]);
            if (alertsRes.ok) {
                const data = await alertsRes.json();
                setAlerts(data.alerts ?? []);
            }
            if (commoditiesRes.ok) {
                const data = await commoditiesRes.json();
                if (Array.isArray(data)) setCommodities(data);
            }
        } catch {
            error('Failed to load price alerts');
        } finally {
            setLoading(false);
        }
    }, [error]);

    useEffect(() => {
        void load();
    }, [load]);

    // Alertable commodities: everything except currencies and GnuCash template entries.
    const alertableCommodities = useMemo(
        () => commodities
            .filter(c => c.namespace !== 'CURRENCY' && c.namespace.toLowerCase() !== 'template')
            .sort((a, b) => a.mnemonic.localeCompare(b.mnemonic)),
        [commodities],
    );

    const addAlert = async () => {
        const value = parseFloat(threshold);
        if (!commodityGuid) {
            error('Choose a commodity');
            return;
        }
        if (!Number.isFinite(value) || value <= 0) {
            error('Enter a positive threshold price');
            return;
        }
        setBusy(true);
        try {
            const res = await fetch('/api/investments/price-alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commodityGuid, direction, threshold: value }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Failed to create alert');
            setAlerts(prev => [data.alert, ...prev]);
            setThreshold('');
            success('Price alert created');
        } catch (e) {
            error(e instanceof Error ? e.message : 'Failed to create alert');
        } finally {
            setBusy(false);
        }
    };

    const toggleEnabled = async (alert: PriceAlert) => {
        setBusy(true);
        try {
            const res = await fetch(`/api/investments/price-alerts/${alert.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !alert.enabled }),
            });
            if (!res.ok) throw new Error();
            setAlerts(prev => prev.map(a => (a.id === alert.id ? { ...a, enabled: !a.enabled } : a)));
        } catch {
            error('Failed to update alert');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (alert: PriceAlert) => {
        if (!window.confirm(`Delete the ${alert.mnemonic} ${alert.direction} ${formatThreshold(alert.threshold)} alert?`)) {
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`/api/investments/price-alerts/${alert.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error();
            setAlerts(prev => prev.filter(a => a.id !== alert.id));
            success('Alert deleted');
        } catch {
            error('Failed to delete alert');
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <InvestmentsPage>
                <div className="h-8 bg-background-tertiary rounded animate-pulse w-48" />
                <div className="h-64 rounded-lg border border-border bg-surface animate-pulse" />
            </InvestmentsPage>
        );
    }

    const activeCount = alerts.filter(a => a.enabled).length;
    const lastTriggered = alerts
        .filter(a => a.lastTriggeredAt)
        .sort((x, y) => (y.lastTriggeredAt ?? '').localeCompare(x.lastTriggeredAt ?? ''))[0];

    return (
        <InvestmentsPage>
            <PageHeader
                title="Price Alerts"
                subtitle="Get notified when a security crosses a price threshold"
            />

            {alerts.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                    <KpiCard
                        label="Active Alerts"
                        value={`${activeCount} of ${alerts.length}`}
                        sub={`${new Set(alerts.map(a => a.commodityGuid)).size} securities watched`}
                        href="#alerts"
                        cta="All alerts"
                    />
                    <KpiCard
                        label="Last Triggered"
                        value={lastTriggered ? lastTriggered.mnemonic : '—'}
                        sub={
                            lastTriggered
                                ? `${lastTriggered.direction === 'above' ? 'Rose above' : 'Fell below'} ${formatThreshold(lastTriggered.threshold)} · ${new Date(lastTriggered.lastTriggeredAt as string).toLocaleDateString()}`
                                : 'No alert has fired yet'
                        }
                        href={lastTriggered ? `/reports/price_history?commodityGuid=${lastTriggered.commodityGuid}` : '#alerts'}
                        cta={lastTriggered ? 'Price history' : 'All alerts'}
                    />
                    <KpiCard
                        className="col-span-2 lg:col-span-1"
                        label="Alertable Securities"
                        value={String(alertableCommodities.length)}
                        sub="Securities with a price feed"
                        href="#new-alert"
                        cta="Add an alert"
                    />
                </div>
            )}

            {/* Add form */}
            <Panel
                id="new-alert"
                title="New alert"
                subtitle="Checked after each price refresh; re-notifies at most once every 24 hours"
            >
                <div className="flex flex-wrap items-end gap-3">
                    <label className="block w-full sm:w-72">
                        <span className={LABEL}>Commodity</span>
                        <select
                            value={commodityGuid}
                            onChange={e => setCommodityGuid(e.target.value)}
                            disabled={busy}
                            className={SELECT}
                        >
                            <option value="">Select…</option>
                            {alertableCommodities.map(c => (
                                <option key={c.guid} value={c.guid}>
                                    {c.mnemonic}{c.fullname ? ` — ${c.fullname}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block w-full sm:w-44">
                        <span className={LABEL}>Direction</span>
                        <select
                            value={direction}
                            onChange={e => setDirection(e.target.value as 'above' | 'below')}
                            disabled={busy}
                            className={SELECT}
                        >
                            <option value="above">Rises above</option>
                            <option value="below">Falls below</option>
                        </select>
                    </label>
                    <label className="block w-full sm:w-40">
                        <span className={LABEL}>Threshold price</span>
                        <input
                            type="number"
                            min="0"
                            step="any"
                            value={threshold}
                            onChange={e => setThreshold(e.target.value)}
                            disabled={busy}
                            placeholder="e.g. 250.00"
                            className={inputClass({ extra: 'text-right font-mono tabular-nums' })}
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => void addAlert()}
                        disabled={busy || !commodityGuid || !threshold}
                        className="h-[42px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Add alert
                    </button>
                </div>
            </Panel>

            {/* Alerts table */}
            {alerts.length === 0 ? (
                <EmptyState title="No price alerts yet">
                    Add an alert above to get a notification when a security crosses your threshold.
                </EmptyState>
            ) : (
                <Panel id="alerts" title="Alerts" subtitle={`${alerts.length} ${alerts.length === 1 ? 'alert' : 'alerts'}`} flush>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-background-secondary/60">
                                <tr className="text-left text-[11px] uppercase tracking-wider text-foreground-muted">
                                    <th className="px-4 py-2.5 font-medium sm:px-5">Commodity</th>
                                    <th className="px-4 py-2.5 font-medium">Condition</th>
                                    <th className="px-4 py-2.5 font-medium text-right">Threshold</th>
                                    <th className="px-4 py-2.5 font-medium">Last triggered</th>
                                    <th className="px-4 py-2.5 font-medium">Enabled</th>
                                    <th className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/70">
                                {alerts.map(a => (
                                    <tr key={a.id} className="transition-colors hover:bg-surface-hover/40">
                                        <td className="px-4 py-3 sm:px-5">
                                            <Link
                                                href={`/reports/price_history?commodityGuid=${a.commodityGuid}`}
                                                className="font-semibold text-foreground hover:text-primary"
                                            >
                                                {a.mnemonic}
                                            </Link>
                                            {a.fullname && (
                                                <span className="text-foreground-muted ml-2 text-xs">{a.fullname}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-foreground-secondary">
                                            {a.direction === 'above' ? 'Rises above' : 'Falls below'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-foreground" style={{ fontFeatureSettings: "'tnum'" }}>
                                            {formatThreshold(a.threshold)}
                                        </td>
                                        <td className="px-4 py-3 text-foreground-secondary font-mono text-xs">
                                            {a.lastTriggeredAt ? new Date(a.lastTriggeredAt).toLocaleString() : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={a.enabled}
                                                aria-label={`${a.mnemonic} alert enabled`}
                                                disabled={busy}
                                                onClick={() => void toggleEnabled(a)}
                                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                                    a.enabled ? 'bg-primary' : 'bg-surface-hover border border-border'
                                                }`}
                                            >
                                                <span
                                                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-primary-foreground transition-transform ${
                                                        a.enabled ? 'translate-x-5' : 'translate-x-1'
                                                    }`}
                                                />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => void remove(a)}
                                                disabled={busy}
                                                className="rounded-md px-2 py-1 text-xs text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}
        </InvestmentsPage>
    );
}
