import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getPreference } from '@/lib/user-preferences';
import { FEATURE_PAGES, LANDING_STATS } from '@/lib/marketing-content';
import { product } from '@/lib/product';
import { BenchInstrument, type InstrumentSystem } from '@/components/marketing/BenchInstrument';
import { RearPanel } from '@/components/marketing/RearPanel';
import { IconArrow, IconPower, IconSource } from '@/components/marketing/BenchIcons';
import type { SystemSlug } from '@/components/marketing/LcdScreen';

const GITHUB = 'https://github.com/biker2000on/folio';

const SYSTEMS: InstrumentSystem[] = FEATURE_PAGES.map(page => ({
    slug: page.slug as SystemSlug,
    label: page.navLabel,
    title: page.title,
}));

export default async function LandingPage() {
    const session = await getSession();
    if (session.isLoggedIn && session.userId) {
        const homeScreen = await getPreference(session.userId, 'home_screen', 'dashboard');
        redirect(homeScreen === 'accounts' ? '/accounts' : '/dashboard');
    }

    return (
        <>
            {/* First viewport: the copy on the left, the instrument doing its job on the right. */}
            <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pt-10 pb-14 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:pt-16 lg:pb-20">
                <div className="flex min-w-0 flex-col justify-center lg:col-span-5">
                    <h1 className="bench-display text-[clamp(2.6rem,5.2vw,5rem)]">
                        Your ledger.
                        <br />
                        Your hardware.
                    </h1>
                    <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-[var(--bench-text-2)]">
                        {product.name} is double-entry accounting you run yourself: one Docker image against your own
                        PostgreSQL, with every amount stored as an exact fraction. No vendor holds your books.
                    </p>
                    <div className="mt-9 flex flex-wrap gap-4">
                        <Link
                            href="/docs/getting-started"
                            className="bench-key bench-key--orange h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                        >
                            <span className="bench-legend text-[12px]">Deploy {product.name}</span>
                            <IconPower size={18} />
                        </Link>
                        <a
                            href={GITHUB}
                            className="bench-key bench-key--putty h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                        >
                            <span className="bench-legend text-[12px]">View source</span>
                            <IconSource size={18} />
                        </a>
                    </div>
                    <p className="mt-6 text-sm text-[var(--bench-text-3)]">
                        Already running it?{' '}
                        <Link href="/login" className="text-[var(--bench-text-2)] underline decoration-[var(--bench-gunmetal)] underline-offset-4 hover:text-[var(--bench-text)]">
                            Sign in to your instance
                        </Link>
                    </p>
                </div>

                <div className="min-w-0 lg:col-span-7">
                    <BenchInstrument systems={SYSTEMS} />
                </div>
            </section>

            {/* Rating plate: the facts printed on the underside of the unit. */}
            <section aria-label="Specification" className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6">
                <dl className="bench-well grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
                    {[
                        { label: 'Model', value: `${product.name}` },
                        ...LANDING_STATS.slice(0, 3).map(s => ({ label: s.label, value: s.value })),
                        { label: 'Storage', value: 'PostgreSQL' },
                        { label: 'Cloud stores required', value: '0' },
                    ].map(cell => (
                        <div key={cell.label} className="bg-[var(--bench-chassis)] px-5 py-4">
                            <dt className="bench-legend text-[10px] text-[var(--bench-text-3)]">{cell.label}</dt>
                            <dd className="bench-figure mt-1.5 text-xl text-[var(--bench-text)]">{cell.value}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            {/* Rear panel: the ownership claim, drawn as the actual topology. */}
            <section className="border-y border-[var(--bench-seam)] bg-[var(--bench-chassis)]">
                <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:py-28">
                    <div className="min-w-0 lg:col-span-4">
                        <h2 className="bench-display text-[clamp(1.9rem,3vw,2.75rem)]">Every cable lands on hardware you own.</h2>
                        <p className="mt-6 leading-relaxed text-[var(--bench-text-2)]">
                            {product.name} is one image plus a background worker. Its only required connection is your
                            PostgreSQL. Receipts and backups go to your disk or S3 bucket. Bank feeds, single sign-on and
                            AI are separate ports, and each stays off until you connect it.
                        </p>
                        <p className="mt-4 leading-relaxed text-[var(--bench-text-2)]">
                            Import your GnuCash file or start from a standard chart of accounts; scheduled XML exports
                            keep a portable copy of every book. Plug in single sign-on and give your partner edit access
                            and your accountant a read-only view, book by book.
                        </p>
                    </div>
                    <div className="min-w-0 lg:col-span-8">
                        <RearPanel />
                    </div>
                </div>
            </section>

            {/* Precision: why the screen shows fractions. */}
            <section className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:py-28">
                <div className="min-w-0 lg:col-span-5">
                    <h2 className="bench-display text-[clamp(1.9rem,3vw,2.75rem)]">Every cent is a fraction.</h2>
                    <p className="mt-6 max-w-[34rem] leading-relaxed text-[var(--bench-text-2)]">
                        Floating-point maths can&apos;t represent a dime exactly. {product.name} stores every amount
                        as an integer numerator over a denominator, so balances can&apos;t drift by a cent
                        however many transactions you post.
                    </p>
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-7">
                    <div className="bench-lcd-bezel">
                        <div className="bench-lcd p-5">
                            <div className="bench-lcd-dim text-[10px] tracking-[0.2em]">FLOAT · MOST APPS</div>
                            <div className="mt-4 text-[15px]">0.10 + 0.20 =</div>
                            <div className="mt-1 text-[clamp(1rem,1.5vw,1.2rem)] break-all leading-tight">0.30000000000000004</div>
                            <div className="bench-lcd-dim mt-4 text-[11px] tracking-[0.12em]">DRIFT: 4 × 10⁻¹⁷</div>
                        </div>
                    </div>
                    <div className="bench-lcd-bezel">
                        <div className="bench-lcd p-5">
                            <div className="bench-lcd-dim text-[10px] tracking-[0.2em]">{product.name.toUpperCase()} · VALUE_NUM / VALUE_DENOM</div>
                            <div className="mt-4 text-[15px]">10/100 + 20/100 =</div>
                            <div className="mt-1 text-[clamp(1rem,1.5vw,1.2rem)] leading-tight">30/100 = 0.30</div>
                            <div className="bench-lcd-dim mt-4 text-[11px] tracking-[0.12em]">DRIFT: 0</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* The six systems, each a key you can press through to its sheet. */}
            <section className="border-t border-[var(--bench-seam)]">
                <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:py-28">
                    <div className="flex flex-wrap items-end justify-between gap-6">
                        <h2 className="bench-display max-w-3xl text-[clamp(1.9rem,3vw,2.75rem)]">Six systems. One ledger.</h2>
                        <Link
                            href="/features"
                            className="bench-legend inline-flex items-center gap-2 text-[11px] text-[var(--bench-text-2)] hover:text-[var(--bench-text)] transition-colors duration-150"
                        >
                            Browse all {LANDING_STATS[0].value} capabilities <IconArrow size={14} />
                        </Link>
                    </div>
                    <p className="mt-5 max-w-2xl leading-relaxed text-[var(--bench-text-2)]">
                        Each one reads and writes the same double-entry books, so your net worth, your tax estimate and
                        your invoice aging can&apos;t disagree with each other.
                    </p>
                    {/* The key legend printed under the instrument: number, then the sheet that key opens. */}
                    <ol className="mt-12 border-b border-[var(--bench-gunmetal)]">
                        {FEATURE_PAGES.map((page, i) => (
                            <li key={page.slug} className="border-t border-[var(--bench-gunmetal)]">
                                <Link
                                    href={`/features/${page.slug}`}
                                    className="group grid gap-x-8 gap-y-1 py-5 md:grid-cols-[3rem_minmax(0,22rem)_minmax(0,1fr)_auto] md:items-baseline"
                                >
                                    <span className="bench-figure hidden text-sm text-[var(--bench-text-3)] md:block">{i + 1}</span>
                                    <span className="text-lg font-medium leading-snug text-[var(--bench-text)] group-hover:text-[var(--bench-amber)] transition-colors duration-150">
                                        {page.title}
                                    </span>
                                    <span className="text-sm leading-relaxed text-[var(--bench-text-2)]">{page.tagline}</span>
                                    <IconArrow size={16} className="hidden text-[var(--bench-text-3)] group-hover:text-[var(--bench-text)] md:block" />
                                </Link>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* Evidence: a number traced back to its sources, the way the app's "Explain this number" does. */}
            <section className="border-t border-[var(--bench-seam)] bg-[var(--bench-chassis)]">
                <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:items-center lg:py-28">
                    <div className="min-w-0 lg:order-2 lg:col-span-5 lg:col-start-8">
                        <h2 className="bench-display text-[clamp(1.9rem,3vw,2.75rem)]">Every number explains itself.</h2>
                        <p className="mt-6 leading-relaxed text-[var(--bench-text-2)]">
                            Important figures trace back through their formula, their assumptions and the transactions
                            underneath. Stale prices and missing exchange rates are flagged, not hidden. Automated
                            changes are previewed, approved, audited and, where possible, undoable.
                        </p>
                    </div>
                    <div className="bench-lcd-bezel min-w-0 lg:order-1 lg:col-span-7">
                        <div className="bench-lcd p-5 text-[12px] leading-relaxed sm:p-6 sm:text-[13px]">
                            <div className="flex justify-between text-[10px] tracking-[0.2em]">
                                <span>EXPLAIN · NET WORTH</span>
                                <span className="bench-lcd-dim">DEMO</span>
                            </div>
                            <div className="mt-4 text-[clamp(1.5rem,3vw,2.25rem)] leading-none">1,284,402.17</div>
                            <div className="mt-5 space-y-1.5">
                                <div className="grid grid-cols-[1fr_auto] gap-x-4">
                                    <span>= Assets · 14 accounts</span>
                                    <span>1,702,118.40</span>
                                </div>
                                <div className="grid grid-cols-[1fr_auto] gap-x-4">
                                    <span>− Liabilities · 3 accounts</span>
                                    <span>417,716.23</span>
                                </div>
                                <div className="bench-lcd-dim grid grid-cols-[1fr_auto] gap-x-4">
                                    <span>Source · 3,211 splits</span>
                                    <span>through 10/14</span>
                                </div>
                                <div className="grid grid-cols-[1fr_auto] gap-x-4">
                                    <span>Warning · VXUS price</span>
                                    <span>2 days old</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Power on. */}
            <section className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:py-28">
                <div className="bench-chassis relative grid gap-10 p-6 sm:p-10 lg:grid-cols-12 lg:items-center">
                    <span className="bench-screw left-3 top-3" aria-hidden />
                    <span className="bench-screw right-3 top-3" aria-hidden />
                    <span className="bench-screw left-3 bottom-3" aria-hidden />
                    <span className="bench-screw right-3 bottom-3" aria-hidden />
                    <div className="min-w-0 lg:col-span-5">
                        <h2 className="bench-display text-[clamp(1.9rem,3vw,2.75rem)]">Power it on.</h2>
                        <p className="mt-5 leading-relaxed text-[var(--bench-text-2)]">
                            Point it at a PostgreSQL database, start the stack, and import your GnuCash file. Bank sync,
                            price quotes and backups run from the worker after that.
                        </p>
                    </div>
                    <div className="min-w-0 lg:col-span-7">
                        <div className="bench-lcd-bezel">
                            <pre className="bench-lcd bench-scroll overflow-x-auto p-5 text-[13px] leading-relaxed sm:text-[14px]">
                                <code>
                                    <span className="bench-lcd-dim">$ </span>docker compose -f docker-compose.prod.yml up -d
                                    {'\n'}
                                    <span className="bench-lcd-dim">✔ folio      started{'\n'}✔ worker     started{'\n'}</span>
                                    <span className="bench-lcd-dim">$ </span>
                                    <span className="bench-caret" aria-hidden />
                                </code>
                            </pre>
                        </div>
                        <div className="mt-6 flex flex-wrap gap-4">
                            <Link
                                href="/docs/getting-started"
                                className="bench-key bench-key--orange h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                            >
                                <span className="bench-legend text-[12px]">Read the setup guide</span>
                                <IconPower size={18} />
                            </Link>
                            <Link
                                href="/docs"
                                className="bench-key bench-key--dark h-14 min-w-[13rem] flex-row items-center justify-between gap-6 px-5"
                            >
                                <span className="bench-legend text-[12px]">All documentation</span>
                                <IconArrow size={18} />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
