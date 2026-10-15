import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Martian_Mono } from 'next/font/google';
import { BrandMark } from '@/components/brand/BrandMark';
import { IconPower } from '@/components/marketing/BenchIcons';
import { FEATURE_PAGES } from '@/lib/marketing-content';
import { product } from '@/lib/product';
import './bench.css';

const display = Martian_Mono({
    subsets: ['latin'],
    variable: '--font-bench-display',
    display: 'swap',
});

const body = Geist({
    subsets: ['latin'],
    variable: '--font-bench-body',
    display: 'swap',
});

export const metadata: Metadata = {
    title: product.brand,
    description: product.description,
    openGraph: {
        title: product.brand,
        description: product.description,
        siteName: product.brand,
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: product.brand,
        description: product.description,
    },
};

const NAV_LINK =
    'bench-legend px-2.5 py-2 text-[var(--bench-text-2)] hover:text-[var(--bench-text)] transition-colors duration-150';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={`bench ${display.variable} ${body.variable} min-h-screen flex flex-col`}>
            <header
                data-testid="marketing-header"
                className="sticky top-0 z-50 border-b border-[var(--bench-seam)] bg-[var(--bench-ground)]/95 backdrop-blur-sm"
            >
                <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
                    <Link href="/" className="flex min-w-0 shrink items-center gap-3">
                        <BrandMark size={32} label={product.brand} />
                        <span className="bench-display text-[15px] tracking-[0.18em]">{product.name}</span>
                    </Link>

                    <span className="hidden h-6 w-px bg-[var(--bench-gunmetal)] lg:block" aria-hidden />

                    <nav aria-label="Product" className="hidden min-w-0 items-center lg:flex">
                        {FEATURE_PAGES.map(page => (
                            <Link key={page.slug} href={`/features/${page.slug}`} className={NAV_LINK}>
                                {page.navLabel}
                            </Link>
                        ))}
                        <Link href="/docs" className={NAV_LINK}>
                            Docs
                        </Link>
                    </nav>

                    <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
                        <Link href="/login" className={`${NAV_LINK} hidden sm:block`}>
                            Sign in
                        </Link>
                        <Link
                            href="/docs/getting-started"
                            data-testid="marketing-open-books"
                            className="bench-key bench-key--putty flex-row items-center gap-2 px-3.5 py-2 sm:px-4"
                        >
                            <IconPower size={14} />
                            <span className="bench-legend text-[11px] whitespace-nowrap">Deploy</span>
                        </Link>
                    </div>
                </div>

                {/* Below lg the six systems move to their own scrollable rail. */}
                <nav
                    aria-label="Product"
                    className="bench-scroll flex items-center gap-1 overflow-x-auto border-t border-[var(--bench-seam)] px-2 py-1 lg:hidden"
                >
                    {FEATURE_PAGES.map(page => (
                        <Link key={page.slug} href={`/features/${page.slug}`} className={`${NAV_LINK} shrink-0 whitespace-nowrap`}>
                            {page.navLabel}
                        </Link>
                    ))}
                    <Link href="/features" className={`${NAV_LINK} shrink-0 whitespace-nowrap`}>
                        All features
                    </Link>
                    <Link href="/docs" className={`${NAV_LINK} shrink-0 whitespace-nowrap`}>
                        Docs
                    </Link>
                    <Link href="/login" className={`${NAV_LINK} shrink-0 whitespace-nowrap sm:hidden`}>
                        Sign in
                    </Link>
                </nav>
            </header>

            <main className="flex-1">{children}</main>

            <footer className="border-t border-[var(--bench-seam)] bg-[var(--bench-chassis)]">
                <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                    <div>
                        <div className="flex items-center gap-3">
                            <BrandMark size={32} />
                            <span className="bench-display text-[15px] tracking-[0.18em]">{product.name}</span>
                        </div>
                        <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--bench-text-2)]">
                            {product.description} Your ledger, your database, your rules.
                        </p>
                    </div>
                    <FooterColumn title="Systems">
                        {FEATURE_PAGES.map(page => (
                            <FooterLink key={page.slug} href={`/features/${page.slug}`}>
                                {page.navLabel}
                            </FooterLink>
                        ))}
                        <FooterLink href="/features">All features</FooterLink>
                    </FooterColumn>
                    <FooterColumn title="Specification">
                        <li className="text-sm text-[var(--bench-text-2)]">Double-entry accounting</li>
                        <li className="text-sm text-[var(--bench-text-2)]">PostgreSQL, exact fractions</li>
                        <li className="text-sm text-[var(--bench-text-2)]">Imports GnuCash files</li>
                        <li className="text-sm text-[var(--bench-text-2)]">One Docker image</li>
                    </FooterColumn>
                    <FooterColumn title="Get started">
                        <FooterLink href="/docs/getting-started">Getting started</FooterLink>
                        <FooterLink href="/docs">Documentation</FooterLink>
                        <FooterLink href="https://github.com/biker2000on/folio">Source on GitHub</FooterLink>
                        <FooterLink href="/login">Sign in</FooterLink>
                    </FooterColumn>
                </div>
                <div className="border-t border-[var(--bench-seam)]">
                    <div className="bench-legend mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-[10px] text-[var(--bench-text-3)] sm:px-6">
                        <span>GnuCash is a trademark of its respective owners. Folio is not affiliated with the GnuCash project.</span>
                        <span>Screen figures are demo data</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="bench-silk bench-legend mb-4 text-[10px]">
                <span>{title}</span>
            </div>
            <ul className="space-y-2.5">{children}</ul>
        </div>
    );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    const external = href.startsWith('http');
    const className = 'text-sm text-[var(--bench-text-2)] hover:text-[var(--bench-text)] transition-colors duration-150';
    return (
        <li>
            {external ? (
                <a href={href} className={className}>
                    {children}
                </a>
            ) : (
                <Link href={href} className={className}>
                    {children}
                </Link>
            )}
        </li>
    );
}
