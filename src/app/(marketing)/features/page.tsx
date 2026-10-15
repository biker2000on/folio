import type { Metadata } from 'next';
import { PublicFeatureCatalog } from '@/components/marketing/PublicFeatureCatalog';
import { FEATURES } from '@/lib/feature-registry';
import { product } from '@/lib/product';

export const metadata: Metadata = {
  title: `All Features — ${product.brand}`,
  description: `Every registered ${product.name} page, report, tool, and workflow in one searchable catalog.`,
};

export default function AllFeaturesPage() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 pt-14 pb-24 sm:px-6 lg:pt-20">
      <header className="grid gap-8 lg:grid-cols-12 lg:items-end">
        <h1 className="bench-display text-[clamp(2.2rem,4.4vw,4rem)] lg:col-span-7">
          Every key on the instrument.
        </h1>
        <p className="text-lg leading-relaxed text-[var(--bench-text-2)] lg:col-span-5">
          All {FEATURES.length} registered capabilities, from daily bookkeeping and tax-lot accounting to
          household planning, business operations and administration. Each one links to its documentation.
        </p>
      </header>
      <PublicFeatureCatalog features={FEATURES} />
    </section>
  );
}
