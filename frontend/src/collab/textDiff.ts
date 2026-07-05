export interface TextDiff {
  start: number;
  deleteCount: number;
  inserted: string;
}

// A textarea's onChange only ever gives you the resulting full string, not
// what the user actually did (typed a char, pasted a paragraph, selected
// half the document and replaced it, ...). To turn that into RGA ops we
// need to know what actually changed, so we recover it by diffing: find
// how much of the start matches, how much of the end matches, and treat
// whatever's left in the middle as "delete this many chars, insert this
// string" at the position where they diverge.
//
// This only ever recovers *one* contiguous edit, not the true minimal
// edit script for every possible change (that's the general LCS problem,
// which for a single textarea event is overkill) — but a single
// contiguous edit is exactly what "select some text and type/delete"
// always produces, which covers typing, deleting, and pasting.
export function diffText(oldText: string, newText: string): TextDiff {
  const maxCommon = Math.min(oldText.length, newText.length);

  let start = 0;
  while (start < maxCommon && oldText[start] === newText[start]) {
    start++;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return { start, deleteCount: oldEnd - start, inserted: newText.slice(start, newEnd) };
}
