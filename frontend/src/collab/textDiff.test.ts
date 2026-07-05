import { describe, expect, it } from 'vitest';
import { diffText } from './textDiff';

describe('diffText', () => {
  it('reports no change for identical strings', () => {
    expect(diffText('hello', 'hello')).toEqual({ start: 5, deleteCount: 0, inserted: '' });
  });

  it('detects a pure append at the end', () => {
    expect(diffText('hello', 'hello world')).toEqual({ start: 5, deleteCount: 0, inserted: ' world' });
  });

  it('detects a pure prepend at the start', () => {
    expect(diffText('world', 'hello world')).toEqual({ start: 0, deleteCount: 0, inserted: 'hello ' });
  });

  it('detects a single character typed in the middle', () => {
    expect(diffText('helo', 'hello')).toEqual({ start: 3, deleteCount: 0, inserted: 'l' });
  });

  it('detects a pure deletion', () => {
    expect(diffText('hello world', 'hello')).toEqual({ start: 5, deleteCount: 6, inserted: '' });
  });

  it('detects a single backspace', () => {
    expect(diffText('hello', 'hell')).toEqual({ start: 4, deleteCount: 1, inserted: '' });
  });

  it('detects a selection replaced by typing (delete + insert at the same spot)', () => {
    expect(diffText('hello world', 'hello there')).toEqual({ start: 6, deleteCount: 5, inserted: 'there' });
  });

  it('detects the whole string being replaced', () => {
    expect(diffText('abc', 'xyz')).toEqual({ start: 0, deleteCount: 3, inserted: 'xyz' });
  });

  it('detects clearing the document entirely', () => {
    expect(diffText('abc', '')).toEqual({ start: 0, deleteCount: 3, inserted: '' });
  });

  it('detects typing into an empty document', () => {
    expect(diffText('', 'abc')).toEqual({ start: 0, deleteCount: 0, inserted: 'abc' });
  });

  it('does not falsely match repeated characters across the diff boundary', () => {
    // Common prefix/suffix scanning can be fooled by repeated characters;
    // 'aaaa' -> 'aaXaa' should recognize the insertion in the middle, not
    // misplace it due to the repeated 'a's on either side.
    expect(diffText('aaaa', 'aaXaa')).toEqual({ start: 2, deleteCount: 0, inserted: 'X' });
  });
});
