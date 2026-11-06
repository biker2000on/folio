'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { HomeSummary, RoomSummary } from '@/lib/services/home.service';
import { formatCurrency } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { PersonalToolNotice } from '@/components/PersonalToolNotice';
import { useToast } from '@/contexts/ToastContext';
import { WalkthroughOverlay } from '@/components/home/WalkthroughOverlay';
import { RoomDetailPanel } from '@/components/home/RoomDetailPanel';
import { BulkDetailPanel } from '@/components/home/BulkDetailPanel';
import { inputClass } from '@/components/ui/form';
import { TNUM } from '@/components/home/home-shared';

const INVENTORY_PATH = '/home/inventory';

function LoadingState() {
    return (
        <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-foreground-secondary">Loading...</span>
            </div>
        </div>
    );
}

function HomeInventoryContent() {
    const toast = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [summary, setSummary] = useState<HomeSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // The open room lives in the URL (?room=<id>) so browser Back returns to the
    // room list instead of leaving the page, and a room can be linked to.
    const roomParam = Number(searchParams.get('room'));
    const selectedRoomId = Number.isInteger(roomParam) && roomParam > 0 ? roomParam : null;
    // True once this page pushed a room entry, so "All rooms" can pop it rather
    // than stacking a second list entry on top of it.
    const pushedRoom = useRef(false);
    const openRoom = (roomId: number) => {
        pushedRoom.current = true;
        router.push(`${INVENTORY_PATH}?room=${roomId}`, { scroll: false });
    };
    const closeRoom = () => {
        if (pushedRoom.current) {
            pushedRoom.current = false;
            router.back();
        } else {
            router.replace(INVENTORY_PATH, { scroll: false });
        }
    };
    const [walking, setWalking] = useState(false);
    const [startingWalk, setStartingWalk] = useState(false);
    const [bulkDetailing, setBulkDetailing] = useState(false);

    const [addingRoom, setAddingRoom] = useState(false);
    const [newRoomName, setNewRoomName] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/home/summary');
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            setSummary(await res.json());
            setError(null);
        } catch {
            setError('Failed to load home inventory.');
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

    /**
     * "Start walk-through": on first use (zero rooms) this seeds the default
     * room set — Living Room, Kitchen, … — all editable afterwards.
     */
    const startWalkthrough = async () => {
        if (!summary) return;
        setStartingWalk(true);
        try {
            if (summary.rooms.length === 0) {
                const res = await fetch('/api/home/rooms/seed', { method: 'POST' });
                if (!res.ok) {
                    const json = await res.json().catch(() => null);
                    throw new Error(json?.error ?? 'Failed to set up rooms');
                }
                await load();
            }
            setWalking(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to start walk-through');
        } finally {
            setStartingWalk(false);
        }
    };

    const handleAddRoom = async () => {
        const name = newRoomName.trim();
        if (!name) return;
        try {
            const res = await fetch('/api/home/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.error ?? 'Failed to add room');
            }
            toast.success('Room added');
            setNewRoomName('');
            setAddingRoom(false);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to add room');
        }
    };

    const rooms = summary?.rooms ?? [];
    const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
    const warrantyAlertCount =
        (summary?.warrantyExpired.length ?? 0) + (summary?.warrantyExpiringSoon.length ?? 0);
    // Up to six alerts, expired first (matching the old single-line strip).
    const shownExpired = (summary?.warrantyExpired ?? []).slice(0, 6);
    const shownExpiring = (summary?.warrantyExpiringSoon ?? []).slice(0, 6 - shownExpired.length);
    const warrantyLines = [
        { key: 'expired', label: 'Warranty expired', tone: 'text-error', alerts: shownExpired },
        {
            key: 'expiring',
            label: `Warranty ending within ${summary?.warrantyWarningDays ?? 90} days`,
            tone: 'text-warning',
            alerts: shownExpiring,
        },
    ].filter((line) => line.alerts.length > 0);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Home Inventory"
                subtitle="A room-by-room record of what you own — for insurance coverage, warranties, and serial numbers."
                actions={
                    !selectedRoom && !bulkDetailing ? (
                        <button
                            type="button"
                            onClick={startWalkthrough}
                            disabled={startingWalk || loading}
                            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50"
                        >
                            {startingWalk ? 'Setting up…' : 'Start walk-through'}
                        </button>
                    ) : undefined
                }
            />

            <PersonalToolNotice />

            {loading && <LoadingState />}

            {!loading && error && (
                <div className="border border-error/30 bg-surface/30 rounded-lg p-4">
                    <p className="text-sm text-error">{error}</p>
                </div>
            )}

            {!loading && !error && summary && selectedRoom && (
                <RoomDetailPanel
                    room={selectedRoom}
                    rooms={rooms}
                    onBack={closeRoom}
                    onChanged={() => void load()}
                    onRoomDeleted={() => {
                        pushedRoom.current = false;
                        router.replace(INVENTORY_PATH, { scroll: false });
                        void load();
                    }}
                />
            )}

            {!loading && !error && summary && !selectedRoom && bulkDetailing && (
                <BulkDetailPanel
                    rooms={rooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder }))}
                    onBack={() => setBulkDetailing(false)}
                    onChanged={() => void load()}
                />
            )}

            {!loading && !error && summary && !selectedRoom && !bulkDetailing && (
                <>
                    {/* Drafts awaiting details */}
                    {summary.draftItems > 0 && (
                        <button
                            type="button"
                            onClick={() => setBulkDetailing(true)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
                        >
                            <span className="text-sm text-foreground">
                                <span className="font-mono font-medium" style={TNUM}>
                                    {summary.draftItems}
                                </span>{' '}
                                item{summary.draftItems === 1 ? '' : 's'} captured without details —
                                add names, categories, and values
                            </span>
                            <span className="shrink-0 text-sm font-medium text-primary">
                                Add details →
                            </span>
                        </button>
                    )}

                    {/* Coverage hero */}
                    <div className="bg-background-secondary/30 border border-border rounded-lg p-5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                            Estimated contents value
                        </p>
                        <p className="mt-1 font-mono text-3xl font-semibold text-foreground" style={TNUM}>
                            {formatCurrency(summary.totalValue)}
                        </p>
                        <p className="mt-2 text-sm text-foreground-secondary">
                            Across{' '}
                            <span className="font-mono" style={TNUM}>{summary.totalItems}</span> item
                            {summary.totalItems === 1 ? '' : 's'} in{' '}
                            <span className="font-mono" style={TNUM}>{rooms.length}</span> room
                            {rooms.length === 1 ? '' : 's'} — review your homeowner&apos;s/renter&apos;s
                            contents coverage against this number.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-secondary">
                            {summary.warrantyExpired.length > 0 && (
                                <span className="text-error">
                                    {summary.warrantyExpired.length} warrant
                                    {summary.warrantyExpired.length === 1 ? 'y' : 'ies'} expired
                                </span>
                            )}
                            {summary.warrantyExpiringSoon.length > 0 && (
                                <span className="text-warning">
                                    {summary.warrantyExpiringSoon.length} warrant
                                    {summary.warrantyExpiringSoon.length === 1 ? 'y' : 'ies'} ending
                                    within {summary.warrantyWarningDays} days
                                </span>
                            )}
                            <Link
                                href="/home/maintenance"
                                className="text-primary hover:text-primary-hover transition-colors"
                            >
                                Home maintenance
                                {summary.tasksOverdue > 0 && ` · ${summary.tasksOverdue} overdue`} →
                            </Link>
                        </div>
                    </div>

                    {/* Warranty alert detail. Expired and expiring are separate,
                        labelled lines, so the state never rests on colour alone. */}
                    {warrantyAlertCount > 0 && (
                        <div className="space-y-1 border border-warning/30 bg-warning/5 rounded-lg px-4 py-3 text-sm text-foreground-secondary">
                            {warrantyLines.map((line) => (
                                <p key={line.key}>
                                    <span className={`mr-3 font-medium ${line.tone}`}>{line.label}</span>
                                    {line.alerts.map((a) => (
                                        <span key={a.itemId} className="mr-4 inline-block">
                                            <button
                                                type="button"
                                                onClick={() => openRoom(a.roomId)}
                                                className="text-foreground hover:text-primary transition-colors"
                                            >
                                                {a.itemName}
                                            </button>{' '}
                                            <span className="font-mono text-xs" style={TNUM}>
                                                {a.daysUntil < 0 ? a.warrantyExpires : `in ${a.daysUntil}d`}
                                            </span>
                                        </span>
                                    ))}
                                </p>
                            ))}
                            {warrantyAlertCount > 6 && (
                                <p className="text-foreground-muted">
                                    +{warrantyAlertCount - 6} more
                                </p>
                            )}
                        </div>
                    )}

                    {/* Room cards */}
                    {rooms.length === 0 ? (
                        <div className="bg-background-secondary/30 border border-border rounded-lg p-8 text-center space-y-2">
                            <p className="text-sm text-foreground-secondary">
                                No rooms yet. Tap{' '}
                                <span className="font-medium text-foreground">Start walk-through</span>{' '}
                                to set up a standard room list (Living Room, Kitchen, Garage, …) and
                                capture items one room at a time — or add rooms by hand below.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {rooms.map((room: RoomSummary) => (
                                <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => openRoom(room.id)}
                                    className="rounded-lg border border-border bg-background-secondary/30 p-4 text-left transition-colors hover:border-border-hover hover:bg-surface-hover"
                                >
                                    <p className="text-sm font-medium text-foreground break-words">{room.name}</p>
                                    <p className="mt-1 text-xs text-foreground-secondary">
                                        <span className="font-mono" style={TNUM}>{room.itemCount}</span> item
                                        {room.itemCount === 1 ? '' : 's'}
                                    </p>
                                    <p className={`mt-2 font-mono text-sm ${room.totalValue === 0 ? 'text-foreground-muted' : 'text-foreground-secondary'}`} style={TNUM}>
                                        {formatCurrency(room.totalValue)}
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Add room */}
                    <div>
                        {addingRoom ? (
                            <form
                                className="flex items-center gap-2"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void handleAddRoom();
                                }}
                            >
                                <input
                                    type="text"
                                    value={newRoomName}
                                    onChange={(e) => setNewRoomName(e.target.value)}
                                    placeholder="Room name"
                                    aria-label="Room name"
                                    className={inputClass({ extra: 'w-56' })}
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors"
                                >
                                    Add
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddingRoom(false);
                                        setNewRoomName('');
                                    }}
                                    className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors"
                                >
                                    Cancel
                                </button>
                            </form>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setAddingRoom(true)}
                                className="text-sm text-primary hover:text-primary-hover transition-colors"
                            >
                                + Add room
                            </button>
                        )}
                    </div>
                </>
            )}

            {walking && summary && (
                <WalkthroughOverlay
                    rooms={rooms.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder }))}
                    onClose={(changed) => {
                        setWalking(false);
                        if (changed) void load();
                    }}
                />
            )}
        </div>
    );
}

export default function HomeInventoryPage() {
    return (
        <Suspense fallback={<LoadingState />}>
            <HomeInventoryContent />
        </Suspense>
    );
}
