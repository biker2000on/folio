'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { Tip } from '@/components/ui/Tooltip';

export interface ActionMenuItem {
    label: string;
    onSelect: () => void;
    icon?: ReactNode;
    /** Render in the destructive style (the `--error` role, never money red). */
    destructive?: boolean;
    disabled?: boolean;
}

interface ActionMenuProps {
    items: ActionMenuItem[];
    /** Accessible label for the trigger button. */
    label?: string;
    className?: string;
    /** `touch` gives the trigger a 44px target, for row menus on phones. */
    size?: 'default' | 'touch';
}

/**
 * Compact overflow ("...") menu for secondary page actions. Keeps headers
 * uncluttered: primary actions stay as buttons, everything else lives here.
 */
export function ActionMenu({ items, label = 'More actions', className = '', size = 'default' }: ActionMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Keyboard: focus enters the menu on open, arrows move, Escape closes and
    // hands focus back to the trigger.
    useEffect(() => {
        if (!open) return;
        const enabled = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
        enabled()[0]?.focus();
        function handleKey(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const options = enabled();
            if (options.length === 0) return;
            event.preventDefault();
            const at = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? (at + 1) % options.length : (at - 1 + options.length) % options.length;
            options[next].focus();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    if (items.length === 0) return null;

    return (
        <div className={`relative ${className}`} ref={ref}>
            <Tip content={label} describedBy={false}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`flex items-center justify-center ${size === 'touch' ? 'w-11 h-11' : 'w-9 h-9'} rounded-lg border border-border bg-surface/50 text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors`}
            >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="1.75" />
                    <circle cx="12" cy="12" r="1.75" />
                    <circle cx="19" cy="12" r="1.75" />
                </svg>
            </button>
            </Tip>
            {open && (
                <div ref={menuRef} role="menu" aria-label={label} className="absolute right-0 top-full mt-1 min-w-48 bg-surface-elevated border border-border rounded-lg shadow-xl z-50 py-1">
                    {items.map((item, i) => (
                        <button
                            key={i}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                            disabled={item.disabled}
                            className={`flex items-center gap-2 w-full px-3 ${size === 'touch' ? 'min-h-11' : ''} py-2 text-sm text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                item.destructive
                                    ? 'text-error hover:bg-error/10'
                                    : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
                            }`}
                        >
                            {item.icon && <span className="w-4 h-4 shrink-0">{item.icon}</span>}
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
