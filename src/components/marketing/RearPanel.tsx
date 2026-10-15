'use client';

import { useEffect, useState, type JSX } from 'react';

/**
 * The instrument's rear panel: every port Folio has, and where its cable goes.
 * Solid cables are required and land on hardware you own; dashed ones are
 * optional connectors you switch on explicitly. Signal pulses run along the
 * live cables unless the visitor prefers reduced motion.
 */

interface Port {
    id: string;
    label: string;
    target: string;
    note: string;
    optional?: boolean;
}

const PORTS: Port[] = [
    { id: 'pg', label: 'POSTGRES', target: 'Your PostgreSQL', note: 'record' },
    { id: 'files', label: 'FILES', target: 'Your disk or S3', note: 'backups' },
    { id: 'xml', label: 'XML OUT', target: 'Portable XML', note: 'export' },
    { id: 'sso', label: 'OIDC', target: 'Your identity provider', note: 'sign-in', optional: true },
    { id: 'bank', label: 'SIMPLEFIN', target: 'Bank feeds', note: 'opt-in', optional: true },
    { id: 'ai', label: 'AI', target: 'Your chosen model', note: 'opt-in', optional: true },
];

const W = 760;
const PANEL_Y = 40;
const PANEL_H = 140;
const JACK_Y = 128;
const TARGET_Y = 330;

export function RearPanel(): JSX.Element {
    const [motion, setMotion] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: no-preference)');
        const sync = () => setMotion(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);

    const pitch = (W - 120) / (PORTS.length - 1);

    return (
        <figure>
            {/* Phones: the same patch bay turned on its side, one port per row. */}
            <ul className="space-y-2 sm:hidden">
                {PORTS.map(port => (
                    <li
                        key={port.id}
                        className="grid grid-cols-[2.25rem_5.5rem_1fr] items-center gap-3 rounded-md bg-[var(--bench-ground)] px-3 py-2.5"
                    >
                        <span className="relative h-7 w-7 rounded-full border-2 border-[#4a5058] bg-[var(--bench-seam)]">
                            <span className="absolute inset-[7px] rounded-full bg-[var(--bench-chassis-raised)]" />
                        </span>
                        <span className="bench-legend text-[10px] text-[var(--bench-text)]">{port.label}</span>
                        <span className="flex min-w-0 items-center gap-3">
                            <span
                                className={`h-0 w-6 shrink-0 ${port.optional ? 'border-t-2 border-dashed border-[var(--bench-text-3)]' : 'border-t-[3px] border-[var(--bench-bone)]'}`}
                            />
                            <span className="min-w-0">
                                <span className={`block text-sm ${port.optional ? 'text-[var(--bench-text-2)]' : 'text-[var(--bench-text)]'}`}>
                                    {port.target}
                                </span>
                                <span
                                    className={`bench-legend block text-[9px] ${port.optional ? 'text-[var(--bench-text-3)]' : 'text-[var(--bench-amber)]'}`}
                                >
                                    {port.note}
                                </span>
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
            <svg
                viewBox={`0 0 ${W} 420`}
                className="hidden h-auto w-full sm:block"
                role="img"
                aria-labelledby="rear-panel-title rear-panel-desc"
            >
                <title id="rear-panel-title">Folio rear panel</title>
                <desc id="rear-panel-desc">
                    {PORTS.map(p => `${p.label} connects to ${p.target}${p.optional ? ' (optional)' : ''}.`).join(' ')}
                </desc>

                {/* Chassis rear */}
                <rect x="20" y={PANEL_Y} width={W - 40} height={PANEL_H} rx="10" fill="#24282d" stroke="#3d4248" />
                <rect x="36" y={PANEL_Y + 14} width="150" height="22" rx="4" fill="#0e1013" />
                <text x="48" y={PANEL_Y + 29} fill="#8c897f" fontSize="10" letterSpacing="2" fontFamily="var(--font-bench-display)">
                    FOLIO · REAR
                </text>
                <text x={W - 36} y={PANEL_Y + 29} textAnchor="end" fill="#8c897f" fontSize="10" letterSpacing="2" fontFamily="var(--font-bench-display)">
                    1 DOCKER IMAGE + WORKER
                </text>
                {/* Vent slots */}
                {Array.from({ length: 14 }, (_, i) => (
                    <rect key={i} x={250 + i * 18} y={PANEL_Y + 18} width="8" height="16" rx="2" fill="#0e1013" />
                ))}

                {PORTS.map((port, i) => {
                    const x = 60 + i * pitch;
                    const cable = `M${x} ${JACK_Y + 14} C ${x} ${JACK_Y + 90}, ${x} ${TARGET_Y - 90}, ${x} ${TARGET_Y - 18}`;
                    const live = !port.optional;
                    return (
                        <g key={port.id}>
                            {/* Jack */}
                            <circle cx={x} cy={JACK_Y} r="15" fill="#0e1013" stroke="#4a5058" strokeWidth="2" />
                            <circle cx={x} cy={JACK_Y} r="6" fill="#2c3137" />
                            <text
                                x={x}
                                y={JACK_Y - 26}
                                textAnchor="middle"
                                fill="#e6e2d9"
                                fontSize="10"
                                letterSpacing="1.6"
                                fontFamily="var(--font-bench-display)"
                            >
                                {port.label}
                            </text>

                            {/* Cable */}
                            <path
                                id={`cable-${port.id}`}
                                d={cable}
                                fill="none"
                                stroke={live ? '#e6e2d9' : '#8c897f'}
                                strokeWidth={live ? 3 : 2}
                                strokeDasharray={live ? undefined : '6 7'}
                                strokeLinecap="round"
                            />
                            {live && motion && (
                                <circle r="3.5" fill="#ffc24d">
                                    <animateMotion dur={`${2.2 + i * 0.35}s`} repeatCount="indefinite" rotate="auto">
                                        <mpath href={`#cable-${port.id}`} />
                                    </animateMotion>
                                </circle>
                            )}

                            {/* Destination */}
                            <rect
                                x={x - 54}
                                y={TARGET_Y - 18}
                                width="108"
                                height="64"
                                rx="6"
                                fill={live ? '#2c3137' : 'none'}
                                stroke={live ? '#3d4248' : '#4a5058'}
                                strokeDasharray={live ? undefined : '4 5'}
                            />
                            <text x={x} y={TARGET_Y + 6} textAnchor="middle" fill={live ? '#e6e2d9' : '#b4b0a6'} fontSize="11" fontFamily="var(--font-bench-body)">
                                {port.target.length > 18 ? port.target.split(' ').slice(0, 2).join(' ') : port.target}
                            </text>
                            {port.target.length > 18 && (
                                <text x={x} y={TARGET_Y + 20} textAnchor="middle" fill={live ? '#e6e2d9' : '#b4b0a6'} fontSize="11" fontFamily="var(--font-bench-body)">
                                    {port.target.split(' ').slice(2).join(' ')}
                                </text>
                            )}
                            <text
                                x={x}
                                y={TARGET_Y + 36}
                                textAnchor="middle"
                                fill={live ? '#ffc24d' : '#8c897f'}
                                fontSize="9"
                                letterSpacing="1.2"
                                fontFamily="var(--font-bench-display)"
                            >
                                {port.note.toUpperCase()}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <figcaption className="bench-legend mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[10px] text-[var(--bench-text-3)]">
                <span className="flex items-center gap-2">
                    <span className="inline-block h-[3px] w-6 bg-[var(--bench-bone)]" aria-hidden /> Required · hardware you own
                </span>
                <span className="flex items-center gap-2">
                    <span className="inline-block w-6 border-t-2 border-dashed border-[var(--bench-text-3)]" aria-hidden /> Optional · off until you connect it
                </span>
            </figcaption>
        </figure>
    );
}
