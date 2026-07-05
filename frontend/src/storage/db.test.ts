// Vitest runs in Node, which has no IndexedDB — fake-indexeddb provides a
// real (if in-memory) implementation of the API so this module can be
// tested without a browser.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetDBForTests, appendOp, loadOps } from './db';
import type { InsertOp } from '../crdt';

function insertOp(site: string, counter: number, value: string, parentId: InsertOp['parentId'] = null): InsertOp {
  return { type: 'insert', id: { site, counter }, value, parentId };
}

beforeEach(() => {
  // Fresh in-memory database per test, so tests can't see each other's
  // writes through the module-level `dbPromise` cache in db.ts.
  globalThis.indexedDB = new IDBFactory();
  _resetDBForTests();
});

describe('storage/db', () => {
  it('returns an empty list for a room with no persisted ops', async () => {
    expect(await loadOps('empty-room')).toEqual([]);
  });

  it('round-trips a single op', async () => {
    const op = insertOp('A', 0, 'h');
    await appendOp('room-1', op);
    expect(await loadOps('room-1')).toEqual([op]);
  });

  it('preserves insertion order across multiple ops', async () => {
    const ops = [insertOp('A', 0, 'h'), insertOp('A', 1, 'e'), insertOp('A', 2, 'l')];
    for (const op of ops) await appendOp('room-1', op);
    expect(await loadOps('room-1')).toEqual(ops);
  });

  it('keeps different rooms independent', async () => {
    const opForRoom1 = insertOp('A', 0, 'x');
    const opForRoom2 = insertOp('A', 0, 'y');
    await appendOp('room-1', opForRoom1);
    await appendOp('room-2', opForRoom2);

    expect(await loadOps('room-1')).toEqual([opForRoom1]);
    expect(await loadOps('room-2')).toEqual([opForRoom2]);
  });
});
