'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export type AiLevel = 'off' | 'summary' | 'full';

export interface AiAvailabilityState {
    loaded: boolean;
    configured: boolean;
    level: AiLevel;
}

/** Where the AI privacy mode is chosen. */
export const AI_PRIVACY_SETTINGS_HREF = '/settings#ai-privacy';

/**
 * Whether an AI suggestion action can run, from its route's GET
 * ({ configured, level }). Unknown until loaded; a failed check reads as off.
 */
export function useAiAvailability(url: string): AiAvailabilityState {
    const [state, setState] = useState<AiAvailabilityState>({ loaded: false, configured: false, level: 'off' });
    useEffect(() => {
        let cancelled = false;
        fetch(url)
            .then(res => (res.ok ? res.json() : null))
            .then((data: { configured?: boolean; level?: AiLevel } | null) => {
                if (cancelled) return;
                setState({
                    loaded: true,
                    configured: !!data?.configured,
                    level: data?.level === 'summary' || data?.level === 'full' ? data.level : 'off',
                });
            })
            .catch(() => {
                if (!cancelled) setState({ loaded: true, configured: false, level: 'off' });
            });
        return () => {
            cancelled = true;
        };
    }, [url]);
    return state;
}

/** True when the action may run. */
export function aiUsable(state: AiAvailabilityState): boolean {
    return state.loaded && state.configured && state.level !== 'off';
}

/** One line saying why the AI action is disabled, with a link to fix it. Renders nothing when usable. */
export function AiUnavailableNote({ state }: { state: AiAvailabilityState }) {
    if (!state.loaded || aiUsable(state)) return null;
    return (
        <p className="text-xs text-foreground-muted">
            {state.configured ? 'AI analysis is off.' : 'AI is not set up.'}{' '}
            <Link href={AI_PRIVACY_SETTINGS_HREF} className="text-primary hover:underline">
                {state.configured ? 'Change it in Settings → AI.' : 'Set it up in Settings → AI.'}
            </Link>
        </p>
    );
}

/** Shown with summary-mode results: the model never saw the real names. */
export function AiSummaryNote() {
    return (
        <p className="text-xs text-foreground-muted">
            Names were hidden from the AI. It saw placeholders and rounded amounts.
        </p>
    );
}
