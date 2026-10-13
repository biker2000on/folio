'use client';

/**
 * Layout and control primitives shared by every page under /investments.
 *
 * One vocabulary for the whole section, so a pill on one page never looks
 * like a tab on the next:
 * - <InvestmentsPage>  page width and vertical rhythm (the layout leaves
 *                      /investments full-bleed so this owns the width)
 * - <SectionTabs>      route-level views (underline tabs, real links)
 * - <Segmented>        in-place view switches (chart range, $/TWR/MWR, …)
 * - <Panel>            every card: header row (title · controls), body
 * - <KpiCard>          headline numbers — always a link to the view that
 *                      explains the number
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Tip } from '@/components/ui/Tooltip';
import { statToneClass, type StatTone } from '@/components/ui/StatCard';

const TNUM = { fontFeatureSettings: "'tnum'" } as const;

/** DESIGN.md "Max content width". */
export const INVESTMENTS_MAX_WIDTH = 'max-w-[1400px]';

export function InvestmentsPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full ${INVESTMENTS_MAX_WIDTH} space-y-6 ${className}`}>{children}</div>;
}

export interface SectionTab {
  key: string;
  href: string;
  label: ReactNode;
}

/** Route-level view tabs. Each tab is a link so views are addressable. */
export function SectionTabs({ tabs, active, ariaLabel }: { tabs: SectionTab[]; active: string; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} className="flex max-w-full gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
      {tabs.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
            active === tab.key
              ? 'border-primary text-foreground'
              : 'border-transparent text-foreground-secondary hover:border-border-hover hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Tooltip text (Tip, never title=). */
  hint?: string;
  /** Accessible name when `label` is not plain text (e.g. "$"). */
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * In-place switch between a few mutually exclusive views. 36px tall on
 * phones for touch, 28px from sm up where it sits in dense panel headers.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full shrink-0 items-center overflow-x-auto rounded-md border border-border bg-background-secondary p-0.5 [scrollbar-width:none] ${className}`}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        const button = (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={`flex h-9 min-w-9 shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 sm:h-7 sm:min-w-7 ${
              selected
                ? 'bg-primary-light text-primary'
                : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
            } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            {opt.label}
          </button>
        );
        return opt.hint ? (
          <Tip key={opt.value} content={opt.hint}>
            {button}
          </Tip>
        ) : (
          button
        );
      })}
    </div>
  );
}

/**
 * The section's card. Header carries the title on the left and controls on
 * the right (wrapping under the title on narrow screens); `flush` drops the
 * body padding for tables and edge-to-edge lists.
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  flush = false,
  className = '',
  bodyClassName = '',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-6 flex-col rounded-lg border border-border bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-foreground-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`@container min-w-0 flex-1 ${flush ? '' : 'p-4 sm:p-5'} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * Expand-button placement for an <ExpandableChart> wrapping a ChartPanel:
 * always visible, sitting in the header's reserved right corner.
 */
export const CHART_EXPAND_BUTTON = 'top-2.5 right-3 sm:right-4';

/**
 * A Panel for charts that live inside <ExpandableChart>. Collapsed, it is a
 * normal Panel whose header keeps its right corner free for the expand
 * button; expanded (in the modal, which has its own title) it drops the
 * chrome and keeps only the controls row above a full-height body.
 */
export function ChartPanel({
  expanded,
  title,
  subtitle,
  actions,
  footer,
  children,
  className = '',
}: {
  expanded: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (expanded) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        <div className="min-h-0 flex-1">{children}</div>
        {footer}
      </div>
    );
  }
  return (
    <section className={`flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface ${className}`}>
      <header className="flex min-h-[53px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-2.5 pl-4 pr-14 sm:pl-5 sm:pr-16">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-foreground-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="@container flex min-w-0 flex-1 flex-col p-4 sm:p-5">{children}</div>
      {footer && <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  );
}

/** Empty / no-data state inside a Panel or on its own. */
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-foreground-muted">{children}</div>}
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/**
 * Headline number. The whole card is the hit target (a stretched link: the
 * visible "cta" text is the real <a>, its ::after covers the card), so
 * interactive bits inside — coverage marks, <Abbr> — go in `adornment` /
 * the label's own z-raised slot and keep working above the link layer.
 */
export function KpiCard({
  label,
  value,
  tone = 'default',
  adornment,
  sub,
  href,
  cta,
  className = '',
  emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
  /** Interactive marker beside the value (rendered above the link layer). */
  adornment?: ReactNode;
  sub?: ReactNode;
  href: string;
  /** What the card opens, e.g. "View lots". */
  cta: string;
  className?: string;
  /** Larger value, for the card that leads the row. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={`group relative flex min-w-0 flex-col rounded-lg border border-border bg-surface px-4 py-3 transition-colors duration-150 hover:border-primary/50 hover:bg-surface-hover/40 focus-within:border-primary sm:px-5 sm:py-4 ${className}`}
    >
      <div className="relative z-10 w-fit text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
        {label}
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-1">
        <span
          className={`whitespace-nowrap font-mono font-semibold tabular-nums ${statToneClass(tone)} ${
            emphasis
              ? 'text-2xl sm:text-[26px] lg:text-xl xl:text-[22px] 2xl:text-[26px]'
              : 'text-lg sm:text-[22px] lg:text-lg xl:text-xl 2xl:text-2xl'
          }`}
          style={TNUM}
        >
          {value}
        </span>
        {adornment && <span className="relative z-10 shrink-0">{adornment}</span>}
      </div>
      {sub != null && sub !== '' && <div className="mt-1 min-w-0 text-xs text-foreground-muted">{sub}</div>}
      <div className="mt-auto pt-3">
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground-secondary transition-colors duration-150 after:absolute after:inset-0 after:rounded-lg after:content-[''] group-hover:text-primary focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary"
        >
          {cta}
          <ArrowIcon />
        </Link>
      </div>
    </div>
  );
}

/** Signed money/percent helpers used across the section. */
export function signTone(value: number): StatTone {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'default';
}

/** Recharts styling on design tokens, so charts follow light/dark. */
export const CHART_THEME = {
  grid: 'var(--border)',
  axis: 'var(--border)',
  tick: { fill: 'var(--foreground-muted)', fontSize: 11 },
  tickStrong: { fill: 'var(--foreground-secondary)', fontSize: 12 },
  zeroLine: 'var(--foreground-muted)',
  tooltip: {
    contentStyle: {
      backgroundColor: 'var(--surface-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      color: 'var(--foreground)',
      fontSize: 12,
    },
    labelStyle: { color: 'var(--foreground)', fontWeight: 600 },
    itemStyle: { color: 'var(--foreground-secondary)' },
  },
} as const;

/** Categorical palette for allocation slices and sector bars. */
export const ALLOCATION_COLORS = [
  '#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#f43f5e', '#3b82f6',
  '#84cc16', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#22d3ee',
];
