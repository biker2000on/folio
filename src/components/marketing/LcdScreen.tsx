import type { JSX } from 'react';

/**
 * Amber LCD readouts for the marketing instrument. Every figure here is
 * synthetic demo data, labelled DEMO on the screen; nothing is read from a book.
 */

export const PERIODS = ['MTD', 'QTD', 'YTD', '5Y'] as const;
export type Period = (typeof PERIODS)[number];

export type SystemSlug = 'platform' | 'accounting' | 'investments' | 'planning' | 'business' | 'automation';

const SCALE: Record<Period, number> = { MTD: 1, QTD: 2.8, YTD: 9.6, '5Y': 47.3 };

const usd = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ left, mid, right, dim }: { left: string; mid?: string; right?: string; dim?: boolean }) {
    return (
        // Phones: tag and value share the first line, the description wraps below it.
        <div className={`grid grid-cols-[1fr_auto] gap-x-3 sm:grid-cols-[4.5rem_1fr_auto] ${dim ? 'bench-lcd-dim' : ''}`}>
            <span className="truncate">{left}</span>
            <span className="order-last col-span-2 sm:order-none sm:col-span-1 sm:truncate">{mid}</span>
            <span className="text-right">{right}</span>
        </div>
    );
}

function Platform({ period }: { period: Period }) {
    const k = PERIODS.indexOf(period);
    const fix = [3, 7, 12, 31][k];
    const decide = [2, 4, 9, 22][k];
    const done = [5, 14, 61, 288][k];
    return (
        <>
            <div className="flex items-end gap-6">
                {[
                    ['FIX', fix],
                    ['DECIDE', decide],
                    ['DONE', done],
                ].map(([label, value]) => (
                    <div key={label}>
                        <div className="text-[10px] tracking-[0.18em] bench-lcd-dim">{label}</div>
                        <div className="text-3xl sm:text-4xl leading-none">{String(value).padStart(2, '0')}</div>
                    </div>
                ))}
            </div>
            <div className="mt-3 space-y-1 text-[12px] sm:text-[13px]">
                <Row left="FIX" mid="Reconcile Checking · 4 unmatched" right="NEW" />
                <Row left="DECIDE" mid="Harvest VXUS lot · −$1,840.12" right="NEW" />
                <Row left="DO" mid="Q4 estimated tax · due 01/15" right="" dim />
            </div>
        </>
    );
}

function Accounting({ period }: { period: Period }) {
    const s = SCALE[period];
    const rows: Array<[string, string, number]> = [
        ['10/01', 'Paycheck · Acme Corp', 4832.17],
        ['10/03', 'Mortgage · P+I', -2214.9],
        ['10/07', 'Groceries · Co-op', -186.43],
    ];
    const net = rows.reduce((a, r) => a + r[2], 0) * s;
    return (
        <>
            <div className="text-[10px] tracking-[0.18em] bench-lcd-dim">STORED AS VALUE_NUM / VALUE_DENOM</div>
            <div className="mt-2 space-y-1 text-[12px] sm:text-[13px]">
                {rows.map(([d, desc, amt]) => (
                    <Row key={desc} left={d} mid={desc} right={`${Math.round(amt * 100)}/100`} />
                ))}
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-[rgba(255,194,77,0.25)] pt-2">
                <span className="text-[10px] tracking-[0.18em] bench-lcd-dim">NET {period}</span>
                <span className="text-2xl sm:text-3xl leading-none">{usd(net)}</span>
            </div>
        </>
    );
}

function Investments({ period }: { period: Period }) {
    const s = Math.max(1, SCALE[period] / 6);
    const lots: Array<[string, string, string, number]> = [
        ['VTSAX', '2019-03', 'LT', 8412.55],
        ['VXUS', '2025-11', 'ST', -1840.12],
        ['BND', '2022-06', 'LT', 112.4],
    ];
    const total = lots.reduce((a, l) => a + l[3], 0) * s;
    return (
        <>
            <div className="text-[10px] tracking-[0.18em] bench-lcd-dim">LOTS · OLDEST FIRST · UNREALIZED</div>
            <div className="mt-2 space-y-1 text-[12px] sm:text-[13px]">
                {lots.map(([sym, opened, term, gain]) => (
                    <Row
                        key={sym}
                        left={sym}
                        mid={`${opened} ${term}`}
                        right={`${gain < 0 ? '−' : '+'}${usd(Math.abs(gain * s))}`}
                        dim={gain < 0}
                    />
                ))}
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-[rgba(255,194,77,0.25)] pt-2">
                <span className="text-[10px] tracking-[0.18em] bench-lcd-dim">NET GAIN</span>
                <span className="text-2xl sm:text-3xl leading-none">+{usd(total)}</span>
            </div>
        </>
    );
}

function Planning({ period }: { period: Period }) {
    const k = PERIODS.indexOf(period);
    // A stepped projection; the horizon stretches with the knob.
    const steps = [8, 12, 18, 26][k];
    const pts: string[] = [];
    let y = 52;
    for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * 300;
        y = Math.max(6, y - (2.4 + ((i * 7) % 5)) * (24 / steps));
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        if (i < steps) pts.push(`${(((i + 1) / steps) * 300).toFixed(1)},${y.toFixed(1)}`);
    }
    return (
        <>
            <div className="flex items-baseline justify-between">
                <span className="text-[10px] tracking-[0.18em] bench-lcd-dim">LIVING PLAN · NET WORTH</span>
                <span className="text-[10px] tracking-[0.18em] bench-lcd-dim">HORIZON {['1Y', '5Y', '15Y', '30Y'][k]}</span>
            </div>
            <svg viewBox="0 0 300 60" className="mt-2 w-full h-16" preserveAspectRatio="none" aria-hidden>
                <path d="M0 59.5H300" stroke="currentColor" strokeOpacity="0.3" />
                <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-2 grid grid-cols-2 gap-x-4 text-[12px] sm:text-[13px]">
                <span>FI DATE <span className="bench-lcd-dim">{['—', '2044', '2042', '2041'][k]}</span></span>
                <span className="text-right">SUCCESS <span className="bench-lcd-dim">{[0, 71, 83, 87][k] || '—'}%</span></span>
            </div>
        </>
    );
}

function Business({ period }: { period: Period }) {
    const s = SCALE[period] / 2;
    const buckets: Array<[string, number]> = [
        ['CURRENT', 6420],
        ['1–30', 2310],
        ['31–60', 980],
        ['61–90', 245],
    ];
    const max = buckets[0][1];
    return (
        <>
            <div className="text-[10px] tracking-[0.18em] bench-lcd-dim">A/R AGING · 4 OPEN INVOICES</div>
            <div className="mt-2 space-y-1.5 text-[12px] sm:text-[13px]">
                {buckets.map(([label, amt]) => (
                    <div key={label} className="grid grid-cols-[4.5rem_1fr_6.5rem] items-center gap-x-3">
                        <span>{label}</span>
                        <span className="block h-2.5 bg-[var(--bench-amber)]" style={{ width: `${(amt / max) * 100}%` }} />
                        <span className="text-right">{usd(amt * Math.max(1, s))}</span>
                    </div>
                ))}
            </div>
        </>
    );
}

function Automation({ period }: { period: Period }) {
    const k = PERIODS.indexOf(period);
    const n = [1, 3, 12, 60][k];
    return (
        <>
            <div className="text-[10px] tracking-[0.18em] bench-lcd-dim">WORKER LOG · YOUR SERVER</div>
            <div className="mt-2 space-y-1 text-[12px] sm:text-[13px]">
                <Row left="02:00" mid="SimpleFIN sync" right={`${14 * n} TXN`} />
                <Row left="06:00" mid="Price quotes" right={`${212 * n} PX`} />
                <Row left="03:00" mid="XML backup → /backups" right="OK" />
                <Row left="NOW" mid="" right="" dim />
            </div>
            <span className="bench-caret mt-1" aria-hidden />
        </>
    );
}

const SCREENS: Record<SystemSlug, (p: { period: Period }) => JSX.Element> = {
    platform: Platform,
    accounting: Accounting,
    investments: Investments,
    planning: Planning,
    business: Business,
    automation: Automation,
};

export function LcdScreen({
    system,
    label,
    period,
    className = '',
}: {
    system: SystemSlug;
    label: string;
    period: Period;
    className?: string;
}): JSX.Element {
    const Screen = SCREENS[system];
    return (
        <div className={`bench-lcd p-4 sm:p-5 ${className}`}>
            <div className="flex items-center justify-between text-[10px] tracking-[0.2em]">
                <span>{label.toUpperCase()}</span>
                <span className="bench-lcd-dim">
                    {period} · DEMO
                </span>
            </div>
            <div key={`${system}-${period}`} className="bench-lcd-redraw mt-3">
                <Screen period={period} />
            </div>
        </div>
    );
}
