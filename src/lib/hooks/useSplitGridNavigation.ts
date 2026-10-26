'use client';

import { useCallback, useRef } from 'react';

/**
 * Row navigation shared by the two split editors — the transaction modal's
 * Advanced grid (`SplitRow`) and the journal's inline `EditableSplitRows`.
 *
 * The two editors keep focus differently: the modal is a plain DOM grid where
 * every row's inputs are mounted, while the journal mounts inputs only for
 * the focused row and tracks that row as state in the ledger. What they
 * share is the DECISION: from row `index`, ArrowUp/ArrowDown either moves to
 * the adjacent row or leaves the grid at either end. `resolveRowMove` is that
 * decision as a pure function; the hook adds DOM focus for editors that
 * mount every row. Both editors route through here so the keyboard model
 * cannot drift between them again.
 */

export type RowMoveDirection = 'up' | 'down';

export type RowMove =
    | { kind: 'move'; to: number }
    | { kind: 'pastStart' }
    | { kind: 'pastEnd' };

/** Where ArrowUp/ArrowDown from `index` lands, given `lastIndex` rows. */
export function resolveRowMove(direction: RowMoveDirection, index: number, lastIndex: number): RowMove {
    if (direction === 'up') {
        return index <= 0 ? { kind: 'pastStart' } : { kind: 'move', to: index - 1 };
    }
    return index >= lastIndex ? { kind: 'pastEnd' } : { kind: 'move', to: index + 1 };
}

/** The attributes that mark a focusable cell for `focusCell`. */
export function splitCellAttrs(row: number, col: string): { 'data-split-row': number; 'data-split-col': string } {
    return { 'data-split-row': row, 'data-split-col': col };
}

const FOCUSABLE = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface SplitGridNavigationOptions {
    /** ArrowUp on the first row. Default: stay put. */
    onPastStart?: () => void;
    /** ArrowDown on the last row. Default: stay put. */
    onPastEnd?: () => void;
}

/**
 * DOM-grid flavour: give `gridRef` to the element that contains every row,
 * mark each cell's wrapper with `splitCellAttrs(row, col)`, and call
 * `moveFrom('down', row, col)` from a cell's ArrowDown. The same column in
 * the next row receives focus (and, for a text input, selects its text so
 * typing replaces it). The row count is read from the DOM, so a placeholder
 * row that appears and disappears is navigable the moment it renders.
 */
export function useSplitGridNavigation(options: SplitGridNavigationOptions = {}) {
    const gridRef = useRef<HTMLDivElement>(null);
    const { onPastStart, onPastEnd } = options;

    const lastRowIndex = useCallback((): number => {
        const grid = gridRef.current;
        if (!grid) return -1;
        let last = -1;
        grid.querySelectorAll<HTMLElement>('[data-split-row]').forEach(el => {
            const row = Number(el.dataset.splitRow);
            if (Number.isInteger(row) && row > last) last = row;
        });
        return last;
    }, []);

    const focusCell = useCallback((row: number, col: string): boolean => {
        const grid = gridRef.current;
        if (!grid) return false;
        const cell = grid.querySelector<HTMLElement>(`[data-split-row="${row}"][data-split-col="${col}"]`);
        if (!cell) return false;
        const target = cell.matches(FOCUSABLE) ? cell : cell.querySelector<HTMLElement>(FOCUSABLE);
        if (!target) return false;
        target.focus();
        if (target instanceof HTMLInputElement && target.type === 'text') target.select();
        return true;
    }, []);

    const moveFrom = useCallback((direction: RowMoveDirection, row: number, col: string): RowMove => {
        const move = resolveRowMove(direction, row, lastRowIndex());
        if (move.kind === 'move') focusCell(move.to, col);
        else if (move.kind === 'pastStart') onPastStart?.();
        else onPastEnd?.();
        return move;
    }, [focusCell, lastRowIndex, onPastStart, onPastEnd]);

    return { gridRef, focusCell, moveFrom, lastRowIndex };
}
