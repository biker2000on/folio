'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmationDialog } from './ConfirmationDialog';
import {
    describeReconciledAccounts,
    hasFrozenSplit,
    type ReconciledSplitErrorBody,
} from '@/lib/reconciled-split-client';

/** What the user was trying to do when the guard fired; shapes the copy. */
export type UnreconcileVerb = 'save' | 'delete';

interface PendingPrompt {
    body: ReconciledSplitErrorBody;
    verb: UnreconcileVerb;
}

/**
 * The "this touches a reconciled split" confirmation, as a hook.
 *
 * `confirmUnreconcile(body, verb)` opens the dialog and resolves with the
 * answer, so a save path can `await` it inline (see `fetchWithUnreconcile`).
 * Render `unreconcileDialog` once in the owning component; `isOpen` lets a
 * host modal hand Escape to this dialog while it is up.
 *
 * Copy follows GnuCash desktop's "change reconciled split" warning: it names
 * the accounts, says plainly that the split will lose its reconciled flag,
 * and leaves the destructive half off the reflexive Enter.
 */
export function useUnreconcileConfirm() {
    const [pending, setPending] = useState<PendingPrompt | null>(null);
    const resolveRef = useRef<((ok: boolean) => void) | null>(null);

    const confirmUnreconcile = useCallback(
        (body: ReconciledSplitErrorBody, verb: UnreconcileVerb = 'save') =>
            new Promise<boolean>(resolve => {
                // A second prompt while one is up answers the first with "no"
                // rather than leaving its promise dangling.
                resolveRef.current?.(false);
                resolveRef.current = resolve;
                setPending({ body, verb });
            }),
        [],
    );

    const settle = useCallback((ok: boolean) => {
        const resolve = resolveRef.current;
        resolveRef.current = null;
        setPending(null);
        resolve?.(ok);
    }, []);

    const verb = pending?.verb ?? 'save';
    const accounts = pending ? describeReconciledAccounts(pending.body) : '';
    const frozen = pending ? hasFrozenSplit(pending.body) : false;
    const stateWord = frozen ? 'frozen' : 'reconciled';
    const plural = pending ? pending.body.splits.length > 1 : false;

    const title = verb === 'delete'
        ? `Delete ${stateWord} transaction?`
        : `Change ${stateWord} split${plural ? 's' : ''}?`;
    const message = verb === 'delete'
        ? `This transaction has a ${stateWord} split on ${accounts}. Deleting it will leave that account's last reconciliation out of balance until you reconcile again.`
        : `This change touches a ${stateWord} split on ${accounts}. Saving will mark ${plural ? 'those splits' : 'it'} unreconciled, and that account's last reconciliation will no longer balance until you reconcile again.`;
    const confirmLabel = verb === 'delete' ? 'Unreconcile and delete' : 'Unreconcile and save';

    const unreconcileDialog: ReactNode = (
        <ConfirmationDialog
            isOpen={pending !== null}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
            title={title}
            message={message}
            confirmLabel={confirmLabel}
            cancelLabel={verb === 'delete' ? 'Keep it' : 'Keep as is'}
            confirmVariant={verb === 'delete' ? 'danger' : 'warning'}
            // Undoing a reconciliation is the irreversible half, so it never
            // sits under a reflexive Enter.
            defaultFocus="cancel"
            confirmOnEnter={false}
        />
    );

    return { confirmUnreconcile, unreconcileDialog, isUnreconcilePromptOpen: pending !== null };
}
