'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import { SYSTEM_ICONS, IconArrow } from '@/components/marketing/BenchIcons';
import { LcdScreen, PERIODS, type SystemSlug } from '@/components/marketing/LcdScreen';

export interface InstrumentSystem {
    slug: SystemSlug;
    label: string;
    title: string;
}

const KNOB_DEG = [-120, -40, 40, 120];

/**
 * The hero instrument: six system keys select what the amber screen reads,
 * the knob scrubs its period. Keys 1–6 and the arrow keys work while focus is
 * anywhere inside the instrument.
 */
export function BenchInstrument({ systems }: { systems: InstrumentSystem[] }): JSX.Element {
    const [active, setActive] = useState(0);
    const [period, setPeriod] = useState(2);
    const drag = useRef<{ y: number; start: number } | null>(null);

    const system = systems[active];

    const nudgePeriod = useCallback((delta: number) => {
        setPeriod(p => Math.min(PERIODS.length - 1, Math.max(0, p + delta)));
    }, []);

    const onInstrumentKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const n = Number(event.key);
        if (Number.isInteger(n) && n >= 1 && n <= systems.length) {
            setActive(n - 1);
            event.preventDefault();
        }
    };

    const onKnobKey = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') nudgePeriod(1);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') nudgePeriod(-1);
        else if (event.key === 'Home') setPeriod(0);
        else if (event.key === 'End') setPeriod(PERIODS.length - 1);
        else return;
        event.preventDefault();
    };

    const onKnobDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, start: period };
    };
    const onKnobMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        // One detent per 28px of vertical travel, up = clockwise.
        const steps = Math.round((drag.current.y - event.clientY) / 28);
        setPeriod(Math.min(PERIODS.length - 1, Math.max(0, drag.current.start + steps)));
    };
    const onKnobUp = () => {
        drag.current = null;
    };

    return (
        <div
            className="bench-chassis relative p-4 sm:p-6"
            onKeyDown={onInstrumentKey}
            role="group"
            aria-label="Folio instrument: choose a system to preview"
        >
            <span className="bench-screw left-3 top-3" aria-hidden />
            <span className="bench-screw right-3 top-3" aria-hidden />
            <span className="bench-screw left-3 bottom-3" aria-hidden />
            <span className="bench-screw right-3 bottom-3" aria-hidden />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-6">
                <div className="bench-lcd-bezel min-w-0 flex-1" aria-live="polite">
                    <LcdScreen system={system.slug} label={system.label} period={PERIODS[period]} className="min-h-[188px] sm:min-h-[212px]" />
                </div>

                <div className="flex shrink-0 flex-row items-center justify-center gap-5 sm:flex-col sm:gap-3">
                    <div
                        role="slider"
                        tabIndex={0}
                        aria-label="Period"
                        aria-valuemin={0}
                        aria-valuemax={PERIODS.length - 1}
                        aria-valuenow={period}
                        aria-valuetext={PERIODS[period]}
                        className="bench-knob h-[72px] w-[72px] sm:h-[104px] sm:w-[104px]"
                        style={{ transform: `rotate(${KNOB_DEG[period]}deg)` }}
                        onKeyDown={onKnobKey}
                        onPointerDown={onKnobDown}
                        onPointerMove={onKnobMove}
                        onPointerUp={onKnobUp}
                        onPointerCancel={onKnobUp}
                    >
                        <span className="bench-knob-cap" />
                    </div>
                    <div className="bench-legend flex gap-2 text-[10px] text-[var(--bench-text-3)]">
                        {PERIODS.map((p, i) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPeriod(i)}
                                className={`px-0.5 transition-colors duration-150 ${i === period ? 'text-[var(--bench-amber)]' : 'hover:text-[var(--bench-text)]'}`}
                                aria-label={`Period ${p}`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bench-silk bench-legend mt-6 mb-3">
                <span>System</span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                {systems.map((s, i) => {
                    const Glyph = SYSTEM_ICONS[s.slug];
                    const pressed = i === active;
                    return (
                        <button
                            key={s.slug}
                            type="button"
                            aria-pressed={pressed}
                            onClick={() => setActive(i)}
                            className={`bench-key ${i % 3 === 1 ? 'bench-key--putty' : ''} h-[84px] p-3 text-left sm:h-[96px]`}
                        >
                            <span className="flex items-start justify-between">
                                <span className="bench-figure text-[13px] opacity-60">{i + 1}</span>
                                <span className="bench-led mt-1" aria-hidden />
                            </span>
                            <span className="flex items-end justify-between gap-2">
                                <span className="bench-legend text-[11px] leading-tight">{s.label}</span>
                                {Glyph && <Glyph size={18} className="shrink-0 opacity-70" />}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bench-gunmetal)] pt-4">
                <p className="bench-legend flex items-center gap-2 text-[10px] text-[var(--bench-text-3)]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--bench-amber)]" aria-hidden />
                    1 image · your Postgres · 0 cloud stores
                </p>
                <Link
                    href={`/features/${system.slug}`}
                    className="bench-key bench-key--putty flex-row items-center gap-3 px-4 py-2.5"
                >
                    <span className="bench-legend text-[11px]">Open {system.label}</span>
                    <IconArrow size={14} />
                </Link>
            </div>
        </div>
    );
}
