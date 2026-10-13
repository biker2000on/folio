import { describe, expect, it } from 'vitest';
import { applyMarks, markFromPoints } from '../capture';

describe('markFromPoints', () => {
  it('normalizes a drag in any direction into a box', () => {
    const flipped = markFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });
    expect([flipped.x, flipped.y]).toEqual([0.2, 0.3]);
    expect(flipped.w).toBeCloseTo(0.4);
    expect(flipped.h).toBeCloseTo(0.5);
    const box = markFromPoints({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.2 });
    expect(box.x).toBe(0.1);
    expect(box.w).toBeCloseTo(0.3);
    expect(box.h).toBeCloseTo(0.1);
  });
});

describe('applyMarks', () => {
  it('returns the screenshot untouched when nothing is highlighted', async () => {
    await expect(applyMarks('data:image/png;base64,AAAA', [])).resolves.toBe('data:image/png;base64,AAAA');
  });
});
