'use client';

import { Tip } from '@/components/ui/Tooltip';

/**
 * What a click on the R column does from each state — GnuCash desktop's
 * register behaviour: not-reconciled and cleared toggle freely, while a
 * reconciled (or frozen) split asks first, because clearing that flag
 * breaks the statement agreement the reconcile wizard built.
 */
const STATES: Record<string, { icon: string; label: string; action: string; color: string }> = {
    n: {
        icon: 'N',
        label: 'Not reconciled',
        action: 'Mark cleared',
        color: 'text-foreground-muted bg-surface/10 hover:bg-surface-hover',
    },
    c: {
        icon: 'C',
        label: 'Cleared',
        action: 'Mark not reconciled',
        color: 'text-warning bg-warning/10 hover:bg-warning/20',
    },
    y: {
        icon: 'Y',
        label: 'Reconciled',
        action: 'Unreconcile…',
        color: 'text-primary bg-primary/10 hover:bg-primary/20',
    },
    f: {
        icon: 'F',
        label: 'Frozen',
        action: 'Unreconcile…',
        color: 'text-primary bg-primary/10 hover:bg-primary/20',
    },
};

function describe(state: string) {
    return STATES[state] ?? STATES.n;
}

interface ReconcileStateButtonProps {
    state: string;
    /** Called on click; the owner decides whether to toggle or ask first. */
    onClick?: () => void;
    /** `cell` is the ledger's 20px square; `pill` matches the detail modal's status badge. */
    variant?: 'cell' | 'pill';
    disabled?: boolean;
}

/**
 * The reconcile-state marker as a control. Without `onClick` it renders the
 * same read-only marker the ledger always had, so read-only surfaces can
 * share the look without gaining a button they cannot use.
 */
export function ReconcileStateButton({ state, onClick, variant = 'cell', disabled = false }: ReconcileStateButtonProps) {
    const info = describe(state);
    const shape = variant === 'pill'
        ? 'text-xs px-2 py-1 rounded-full'
        : 'w-5 h-5 rounded text-[10px] font-bold';
    const text = variant === 'pill' ? state.toUpperCase() : info.icon;

    if (!onClick) {
        return (
            <Tip content={info.label}>
                <span className={`inline-flex items-center justify-center ${shape} ${info.color}`}>
                    {text}
                </span>
            </Tip>
        );
    }

    return (
        <Tip content={`${info.label} · ${info.action}`} describedBy={false}>
            <button
                type="button"
                disabled={disabled}
                aria-label={`${info.label}. ${info.action}`}
                onClick={(e) => {
                    // The row around this cell opens the detail view or
                    // focuses the row on click; a state toggle is neither.
                    e.stopPropagation();
                    onClick();
                }}
                onKeyDown={(e) => {
                    // Enter/Space activate the button; the ledger's own
                    // window-level key handler must not also act on them.
                    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                className={`inline-flex items-center justify-center ${shape} ${info.color} transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:cursor-default`}
            >
                {text}
            </button>
        </Tip>
    );
}
