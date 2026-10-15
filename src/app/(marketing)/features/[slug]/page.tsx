import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { FEATURE_PAGES } from '@/lib/marketing-content';
import { product } from '@/lib/product';
import { SYSTEM_ICONS, IconArrow, IconPower } from '@/components/marketing/BenchIcons';
import { LcdScreen, type SystemSlug } from '@/components/marketing/LcdScreen';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function generateStaticParams() {
    return FEATURE_PAGES.map(page => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const page = FEATURE_PAGES.find(p => p.slug === slug);
    if (!page) return {};
    return {
        title: `${page.navLabel} — ${product.brand}`,
        description: page.tagline,
    };
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const page = FEATURE_PAGES.find(p => p.slug === slug);
    if (!page) notFound();

    const pageIndex = FEATURE_PAGES.findIndex(p => p.slug === slug);
    const nextPage = FEATURE_PAGES[(pageIndex + 1) % FEATURE_PAGES.length];
    const Glyph = SYSTEM_ICONS[page.slug];

    return (
        <>
            <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:pt-20 lg:pb-24">
                <div className="min-w-0 lg:col-span-6">
                    {/* The system's own key, pressed: this is the sheet it opens. */}
                    <span className="bench-key h-20 w-20 p-3" data-pressed="true" aria-hidden>
                        <span className="flex items-start justify-between">
                            <span className="bench-figure text-[12px] opacity-60">{pageIndex + 1}</span>
                            <span className="bench-led mt-1" />
                        </span>
                        {Glyph && <Glyph size={22} className="self-end opacity-75" />}
                    </span>
                    <h1 className="bench-display mt-8 text-[clamp(2.2rem,4.2vw,3.75rem)]">{page.title}</h1>
                    <p className="mt-6 max-w-[36rem] text-lg leading-relaxed text-[var(--bench-text-2)]">{page.tagline}</p>
                    <div className="mt-9 flex flex-wrap gap-4">
                        <Link
                            href="/docs/getting-started"
                            className="bench-key bench-key--orange h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                        >
                            <span className="bench-legend text-[12px]">Deploy {product.name}</span>
                            <IconPower size={18} />
                        </Link>
                        <Link
                            href="/features"
                            className="bench-key bench-key--dark h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                        >
                            <span className="bench-legend text-[12px]">All features</span>
                            <IconArrow size={18} />
                        </Link>
                    </div>
                </div>
                <div className="min-w-0 lg:col-span-6 lg:pt-28">
                    <div className="bench-chassis relative p-4 sm:p-6">
                        <span className="bench-screw left-3 top-3" aria-hidden />
                        <span className="bench-screw right-3 top-3" aria-hidden />
                        <span className="bench-screw left-3 bottom-3" aria-hidden />
                        <span className="bench-screw right-3 bottom-3" aria-hidden />
                        <div className="bench-lcd-bezel">
                            <LcdScreen system={page.slug as SystemSlug} label={page.navLabel} period="YTD" className="min-h-[212px]" />
                        </div>
                        <p className="bench-legend mt-4 text-[10px] text-[var(--bench-text-3)]">
                            Demo readout · synthetic figures
                        </p>
                    </div>
                </div>
            </section>

            {page.sections.map((section, i) => (
                <section
                    key={section.heading}
                    className={`border-t border-[var(--bench-seam)] ${i % 2 === 0 ? 'bg-[var(--bench-chassis)]' : ''}`}
                >
                    <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:py-24">
                        <div className="min-w-0 lg:col-span-4">
                            <h2 className="bench-display text-[clamp(1.6rem,2.6vw,2.25rem)]">{section.heading}</h2>
                            <p className="mt-5 leading-relaxed text-[var(--bench-text-2)]">{section.lead}</p>
                            {/* This module's keys: each one jumps to its entry. */}
                            <div className="bench-well mt-8 hidden grid-cols-2 gap-3 p-3 sm:grid">
                                {section.items.map((item, k) => (
                                    <a
                                        key={item.name}
                                        href={`#${slugify(section.heading)}-${k}`}
                                        className={`bench-key ${(k + Math.floor(k / 2)) % 2 === 1 ? 'bench-key--putty' : ''} min-h-[4.75rem] gap-2 p-2.5`}
                                    >
                                        <span className="bench-figure text-[10px] opacity-60">{k + 1}</span>
                                        <span className="bench-legend text-[11px] leading-snug">{item.name}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                        <ul className="grid gap-x-10 sm:grid-cols-2 lg:col-span-8">
                            {section.items.map((item, k) => (
                                <li
                                    key={item.name}
                                    id={`${slugify(section.heading)}-${k}`}
                                    className="scroll-mt-28 border-t border-[var(--bench-gunmetal)] py-5"
                                >
                                    <h3 className="flex items-center gap-3 font-medium text-[var(--bench-text)]">
                                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--bench-amber)]" aria-hidden />
                                        {item.name}
                                    </h3>
                                    <p className="mt-2 text-sm leading-relaxed text-[var(--bench-text-2)]">{item.description}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            ))}

            <section className="border-t border-[var(--bench-seam)]">
                <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-6 px-4 py-16 sm:flex-row sm:items-center sm:px-6">
                    <p className="text-xl font-medium text-[var(--bench-text)]">
                        <span className="text-[var(--bench-text-3)]">Next: </span>
                        {nextPage.title}
                    </p>
                    <Link
                        href={`/features/${nextPage.slug}`}
                        className="bench-key bench-key--putty h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                    >
                        <span className="bench-legend text-[12px]">{nextPage.navLabel}</span>
                        <IconArrow size={18} />
                    </Link>
                </div>
            </section>
        </>
    );
}
