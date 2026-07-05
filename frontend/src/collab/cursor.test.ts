import { describe, expect, it } from 'vitest';
import { shiftOffsetForRemoteEdits } from './cursor';

describe('shiftOffsetForRemoteEdits', () => {
  it('leaves the cursor unchanged when there are no edits', () => {
    expect(shiftOffsetForRemoteEdits(5, [])).toBe(5);
  });

  it('pushes the cursor forward for an insert before it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 2, delta: 1 }])).toBe(6);
  });

  it('pushes the cursor forward for an insert exactly at it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 5, delta: 1 }])).toBe(6);
  });

  it('leaves the cursor unchanged for an insert after it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 6, delta: 1 }])).toBe(5);
  });

  it('pulls the cursor back for a delete before it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 2, delta: -1 }])).toBe(4);
  });

  it('leaves the cursor unchanged for a delete exactly at it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 5, delta: -1 }])).toBe(5);
  });

  it('leaves the cursor unchanged for a delete after it', () => {
    expect(shiftOffsetForRemoteEdits(5, [{ index: 6, delta: -1 }])).toBe(5);
  });

  it('applies a batch of edits in order', () => {
    // Two inserts before the cursor, then a delete before the (already
    // shifted) cursor position.
    const edits: Array<{ index: number; delta: 1 | -1 }> = [
      { index: 0, delta: 1 },
      { index: 1, delta: 1 },
      { index: 0, delta: -1 },
    ];
    expect(shiftOffsetForRemoteEdits(5, edits)).toBe(6);
  });

  it('never lets the cursor go negative', () => {
    expect(shiftOffsetForRemoteEdits(0, [{ index: 0, delta: -1 }])).toBe(0);
  });
});
