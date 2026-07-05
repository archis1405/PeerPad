import { describe, expect, it } from 'vitest';
import { colorForId } from './presenceColor';

describe('colorForId', () => {
  it('returns the same color for the same id every time', () => {
    expect(colorForId('abc123')).toBe(colorForId('abc123'));
  });

  it('returns different colors for different ids (usually)', () => {
    // Not a mathematical guarantee (hash collisions exist), but true for
    // this specific, fixed set of sample ids.
    const ids = ['a58d3e7d1e784cbb', '0d162c6af6f5c832', 'site-0', 'site-1', 'site-2'];
    const colors = new Set(ids.map(colorForId));
    expect(colors.size).toBe(ids.length);
  });

  it('always returns a valid hsl() string', () => {
    expect(colorForId('anything')).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
  });
});
