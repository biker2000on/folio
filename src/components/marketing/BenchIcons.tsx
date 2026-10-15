import type { JSX, SVGProps } from 'react';

/**
 * Silkscreen icon set for the marketing instrument. One 24px grid, 1.5 stroke,
 * square caps, so every key legend reads as the same print run.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }): JSX.Element {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden
            focusable={false}
            {...rest}
        >
            {children}
        </svg>
    );
}

/** Platform: a target reticle (what needs attention). */
export const IconPlatform = (p: IconProps) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
    </Icon>
);

/** Accounting: a ruled two-column ledger. */
export const IconAccounting = (p: IconProps) => (
    <Icon {...p}>
        <rect x="3" y="3" width="18" height="18" />
        <path d="M3 8h18M3 13h18M3 18h18M14 3v18" />
    </Icon>
);

/** Investments: stacked lots rising. */
export const IconInvestments = (p: IconProps) => (
    <Icon {...p}>
        <path d="M4 21V15M10 21V10M16 21V13M22 21H2" />
        <path d="M3 9l6-5 5 4 7-6" />
    </Icon>
);

/** Planning & tax: a horizon line with a waypoint. */
export const IconPlanning = (p: IconProps) => (
    <Icon {...p}>
        <path d="M2 18h20" />
        <path d="M2 18c4-2 6-8 10-8s6 4 10 2" />
        <circle cx="12" cy="10" r="2" />
    </Icon>
);

/** Business: an invoice with a total rule. */
export const IconBusiness = (p: IconProps) => (
    <Icon {...p}>
        <path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
    </Icon>
);

/** Automation: a closed loop with a tick. */
export const IconAutomation = (p: IconProps) => (
    <Icon {...p}>
        <path d="M20 12a8 8 0 1 1-2.3-5.6" />
        <path d="M20 3v4h-4" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </Icon>
);

export const IconArrow = (p: IconProps) => (
    <Icon {...p}>
        <path d="M4 12h15M13 6l6 6-6 6" />
    </Icon>
);

export const IconPower = (p: IconProps) => (
    <Icon {...p}>
        <path d="M12 2v9" />
        <path d="M6.3 5.7a8 8 0 1 0 11.4 0" />
    </Icon>
);

export const IconSource = (p: IconProps) => (
    <Icon {...p}>
        <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </Icon>
);

export const IconDocs = (p: IconProps) => (
    <Icon {...p}>
        <path d="M4 3h11l5 5v13H4z" />
        <path d="M15 3v5h5M8 13h8M8 17h6" />
    </Icon>
);

export const IconSearch = (p: IconProps) => (
    <Icon {...p}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5L21 21" />
    </Icon>
);

export const SYSTEM_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
    platform: IconPlatform,
    accounting: IconAccounting,
    investments: IconInvestments,
    planning: IconPlanning,
    business: IconBusiness,
    automation: IconAutomation,
};
