import { describe, expect, it } from 'vitest';
import { resolveRowMove, splitCellAttrs } from '../hooks/useSplitGridNavigation';

describe('resolveRowMove', () => {
    it('moves within the grid', () => {
        expect(resolveRowMove('down', 0, 2)).toEqual({ kind: 'move', to: 1 });
        expect(resolveRowMove('down', 1, 2)).toEqual({ kind: 'move', to: 2 });
        expect(resolveRowMove('up', 2, 2)).toEqual({ kind: 'move', to: 1 });
    });

    it('leaves the grid at either end', () => {
        expect(resolveRowMove('up', 0, 2)).toEqual({ kind: 'pastStart' });
        expect(resolveRowMove('down', 2, 2)).toEqual({ kind: 'pastEnd' });
    });

    it('treats an empty or single-row grid as both ends', () => {
        expect(resolveRowMove('down', 0, 0)).toEqual({ kind: 'pastEnd' });
        expect(resolveRowMove('up', 0, 0)).toEqual({ kind: 'pastStart' });
        expect(resolveRowMove('down', 0, -1)).toEqual({ kind: 'pastEnd' });
    });
});

describe('splitCellAttrs', () => {
    it('marks a cell by row and column', () => {
        expect(splitCellAttrs(3, 'debit')).toEqual({ 'data-split-row': 3, 'data-split-col': 'debit' });
    });
});
