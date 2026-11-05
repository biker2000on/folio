import Link from 'next/link';

/**
 * A settings-hub row that opens another page. Same frame as
 * CollapsibleConfigSection's header, so a hub mixes the two without a seam,
 * but it navigates instead of pretending to expand.
 */
export function SettingsLinkRow({ href, title, summary }: { href: string; title: string; summary: string }) {
    return (
        <Link
            href={href}
            className="group flex items-center justify-between gap-3 px-4 py-3 bg-surface border border-border rounded-lg hover:bg-surface-hover transition-colors"
        >
            <span className="min-w-0 flex items-baseline gap-3 flex-wrap">
                <span className="text-sm font-semibold text-foreground">{title}</span>
                <span className="text-sm text-foreground-secondary">{summary}</span>
            </span>
            <svg
                aria-hidden
                className="w-4 h-4 shrink-0 text-foreground-muted group-hover:text-foreground transition-colors"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
        </Link>
    );
}
