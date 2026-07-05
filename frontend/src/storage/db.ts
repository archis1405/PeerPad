import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Op } from '../crdt';

// A document's persisted state is just its op log — the same append-only
// history that already gets broadcast over the data channel. Restoring
// after a refresh means replaying every op for this room, in the order it
// was recorded, through the exact same RGADocument.applyOp used for live
// network messages. There's no separate "snapshot" format to keep in
// sync with the CRDT's internals.
interface StoredOp {
  id?: number; // assigned by IndexedDB (autoIncrement); we never set it
  room: string;
  op: Op;
}

interface PeerPadDB extends DBSchema {
  ops: {
    key: number;
    value: StoredOp;
    indexes: { 'by-room': string };
  };
}

let dbPromise: Promise<IDBPDatabase<PeerPadDB>> | null = null;

function getDB(): Promise<IDBPDatabase<PeerPadDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PeerPadDB>('peerpad', 1, {
      upgrade(db) {
        const store = db.createObjectStore('ops', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-room', 'room');
      },
    });
  }
  return dbPromise;
}

// Returns every op ever recorded for `room`, in the order they were
// originally applied (IndexedDB's autoIncrement key order matches
// insertion order, and the by-room index preserves that ordering within
// the matching subset).
export async function loadOps(room: string): Promise<Op[]> {
  const db = await getDB();
  const records = await db.getAllFromIndex('ops', 'by-room', room);
  return records.map((record) => record.op);
}

export async function appendOp(room: string, op: Op): Promise<void> {
  const db = await getDB();
  await db.add('ops', { room, op });
}

// Test-only escape hatch: lets tests start from a fresh in-memory database
// instead of reusing whatever fake-indexeddb state a previous test left
// behind. Not used by application code.
export function _resetDBForTests(): void {
  dbPromise = null;
}
