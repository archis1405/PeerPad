import type { RemoteEdit } from './CollabSession';

// Without this, a remote insert/delete that lands before the local
// cursor would leave the cursor at the same raw numeric offset — which
// now points at a different character than before, since everything
// after the edit shifted. This keeps the cursor attached to the same
// surrounding content instead.
//
// Ties: an insertion exactly at the cursor is treated as landing to the
// cursor's left (cursor moves forward with it); a deletion exactly at the
// cursor (removing the character immediately to its right) doesn't move
// it. Neither is more "correct" than the other — it's a judgment call
// about how concurrent edits at the same spot should feel, not a
// convergence requirement (that's the CRDT's job, and it's already
// satisfied regardless of this choice).
export function shiftOffsetForRemoteEdits(offset: number, edits: RemoteEdit[]): number {
  let result = offset;
  for (const edit of edits) {
    if (edit.delta > 0) {
      if (edit.index <= result) result += 1;
    } else if (edit.index < result) {
      result -= 1;
    }
  }
  return result;
}
