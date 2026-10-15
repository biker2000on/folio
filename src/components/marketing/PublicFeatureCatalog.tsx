'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Feature, FeatureDomain } from '@/lib/feature-registry';
import { IconArrow, IconSearch } from '@/components/marketing/BenchIcons';

const DOMAIN_LABELS: Record<FeatureDomain, string> = {
  home: 'Financial command center',
  money: 'Accounting and records',
  budgets: 'Budgets and goals',
  investments: 'Investments',
  taxes: 'Taxes',
  planning: 'Planning and resilience',
  reports: 'Reports',
  business: 'Business operations',
  settings: 'Administration',
};

export function PublicFeatureCatalog({ features }: { features: Feature[] }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(
    () => features.filter((feature) =>
      !normalized || `${feature.title} ${feature.description} ${feature.keywords ?? ''} ${feature.task}`
        .toLowerCase()
        .includes(normalized),
    ),
    [features, normalized],
  );
  const domains = [...new Set(features.map((feature) => feature.domain))];

  return (
    <>
      {/* The search field is the instrument's screen: type and it filters live. */}
      <div className="bench-lcd-bezel mt-12 max-w-3xl">
        <div className="bench-lcd flex items-center gap-4 px-5 py-4">
          <IconSearch size={18} className="shrink-0" />
          <label htmlFor="feature-search" className="sr-only">Search all features</label>
          <input
            id="feature-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SEARCH FEATURES, REPORTS, WORKFLOWS"
            className="relative z-10 min-w-0 flex-1 bg-transparent text-[15px] tracking-[0.06em] text-[var(--bench-amber)] caret-[var(--bench-amber)] outline-none placeholder:text-[var(--bench-amber-dim)]"
          />
          <span className="shrink-0 text-[12px] tracking-[0.14em]" aria-live="polite">
            {String(visible.length).padStart(3, '0')}/{features.length}
          </span>
        </div>
      </div>

      {visible.length === 0 && (
        <p className="mt-14 text-[var(--bench-text-2)]">
          Nothing matches &ldquo;{query}&rdquo;. Try a broader word, such as &ldquo;tax&rdquo;, &ldquo;budget&rdquo; or &ldquo;invoice&rdquo;.
        </p>
      )}

      <div className="mt-16 space-y-16">
        {domains.map((domain) => {
          const domainFeatures = visible.filter((feature) => feature.domain === domain);
          if (domainFeatures.length === 0) return null;
          return (
            <section key={domain} aria-labelledby={`domain-${domain}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 id={`domain-${domain}`} className="bench-display text-xl sm:text-2xl">{DOMAIN_LABELS[domain]}</h2>
                <span className="bench-figure text-xs text-[var(--bench-text-3)]">{domainFeatures.length}</span>
              </div>
              <ul className="mt-5 border-t border-[var(--bench-gunmetal)]">
                {domainFeatures.map((feature) => (
                  <li key={feature.id} className="border-b border-[var(--bench-seam)]">
                    <Link
                      href={`/docs/features/${feature.id}`}
                      className="group grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[minmax(0,16rem)_5.5rem_minmax(0,1fr)_auto] sm:items-baseline"
                    >
                      <span className="font-medium text-[var(--bench-text)] group-hover:text-[var(--bench-amber)] transition-colors duration-150">
                        {feature.title}
                      </span>
                      <span className="bench-legend text-[10px] text-[var(--bench-text-3)]">{feature.kind}</span>
                      <span className="text-sm leading-relaxed text-[var(--bench-text-2)]">{feature.description}</span>
                      <span className="bench-legend hidden items-center gap-1.5 text-[10px] text-[var(--bench-text-3)] group-hover:text-[var(--bench-text)] transition-colors duration-150 sm:inline-flex">
                        Docs <IconArrow size={12} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
