import { Emitter } from '../lib/emitter';
import { RGADocument } from '../crdt';
import type { Op, SiteId } from '../crdt';
import type { WebRTCManager } from '../net';
import { appendOp, loadOps } from '../storage';
import { diffText } from './textDiff';

// The two message shapes this layer puts on the data channel.
//
// A batch of CRDT ops: a single keystroke produces a batch of size 1; a
// paste of 50 characters produces a batch of 50 sent as one message.
interface OpBatchMessage {
  kind: 'ops';
  ops: Op[];
}
// "Here's everything I have, by site." Sent the moment a data channel
// opens — whether that's a brand new peer joining the room for the first
// time (an empty vector) or a peer reconnecting after being offline (a
// vector missing whatever happened while it was gone). Either way, the
// fix is the same: the recipient works out what the sender is missing
// and sends exactly those ops back.
interface StateVectorMessage {
  kind: 'state-vector';
  vector: Record<SiteId, number>;
}
type WireMessage = OpBatchMessage | StateVectorMessage;

// Describes one remote op's effect on visible text, in the same terms a
// textarea understands (an offset and how much it shifted), so the UI
// layer can keep the local cursor pinned to the same *content* rather
// than the same numeric offset when someone else's edit lands underneath
// it.
export interface RemoteEdit {
  index: number;
  delta: 1 | -1;
}

type CollabSessionEvents = {
  change: { text: string; remoteEdits: RemoteEdit[] };
};

// Wires an RGADocument to a WebRTCManager: local edits (given as an
// old/new text pair from a textarea) become ops that are applied locally
// and broadcast; incoming data channel messages are parsed as op batches
// and applied to the local document. Deliberately knows nothing about
// React — `on('change', ...)` is the entire interface the UI needs.
//
// It also persists every op (local or remote) to IndexedDB, keyed by
// room, and replays that history into the document before going live —
// this is the entire mechanism behind surviving a page refresh: the
// document IS its op log, and reloading just means running that same log
// through applyOp again from a blank RGADocument.
//
// And it resyncs whenever a data channel (re)opens: both sides exchange
// state vectors, and each independently sends whatever ops the other is
// missing. Because applyOp is already idempotent and order-independent
// (that's what makes the CRDT a CRDT), catching up after an arbitrary
// offline period needs no special-casing beyond "figure out what's
// missing, send it through the same pipe live ops already use."
export class CollabSession {
  readonly doc: RGADocument;
  private manager: WebRTCManager;
  private readonly roomId: string;
  private readonly emitter = new Emitter<CollabSessionEvents>();
  private unsubscribeMessage: () => void;
  private unsubscribeConnected: () => void;

  private constructor(siteId: string, manager: WebRTCManager, roomId: string) {
    this.doc = new RGADocument(siteId);
    this.manager = manager;
    this.roomId = roomId;
    this.unsubscribeMessage = manager.on('message', ({ peerId, data }) => this.handleRemoteMessage(peerId, data));
    this.unsubscribeConnected = manager.on('peer-connected', ({ peerId }) => this.sendStateVector(peerId));
  }

  // Async factory rather than a plain constructor: loading persisted
  // history from IndexedDB is inherently async, and this guarantees the
  // session is never handed to the UI mid-replay — by the time
  // `create()` resolves, `doc` already reflects every op this room has
  // ever seen.
  static async create(siteId: string, manager: WebRTCManager, roomId: string): Promise<CollabSession> {
    const session = new CollabSession(siteId, manager, roomId);
    const persistedOps = await loadOps(roomId);
    for (const op of persistedOps) session.doc.applyOp(op);
    return session;
  }

  // Points this session at a new WebRTCManager — used when "going back
  // online" after a simulated (or real) network drop. Deliberately does
  // NOT touch `doc`: anything typed while offline is already sitting in
  // the in-memory document and in IndexedDB, so there's nothing to
  // reload. The RGA site id (allocated once, in the constructor) is also
  // untouched, even though the new manager's connections will likely
  // carry a brand new signaling peer id — site id (who authored this op,
  // for CRDT ordering) and peer id (which data channel to send to right
  // now) are different identities on purpose, and a network blip should
  // only ever change the latter. Once rebound, the usual peer-connected
  // -> state-vector handshake takes care of resyncing with whoever's
  // reachable now.
  rebind(manager: WebRTCManager): void {
    this.unsubscribeMessage();
    this.unsubscribeConnected();
    this.manager = manager;
    this.unsubscribeMessage = manager.on('message', ({ peerId, data }) => this.handleRemoteMessage(peerId, data));
    this.unsubscribeConnected = manager.on('peer-connected', ({ peerId }) => this.sendStateVector(peerId));
  }

  on<K extends keyof CollabSessionEvents>(
    event: K,
    listener: (payload: CollabSessionEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  // Called by the UI whenever the textarea's value changes. Diffs against
  // the previously-known text to recover what the user actually did, adds
  // it to the local RGA, persists it, and broadcasts the resulting ops to
  // every peer.
  applyLocalEdit(oldText: string, newText: string): void {
    const { start, deleteCount, inserted } = diffText(oldText, newText);
    if (deleteCount === 0 && inserted.length === 0) return;

    const ops: Op[] = [];
    // Deletes first: they free up the index range the new characters (if
    // any) are about to be inserted into.
    for (let i = 0; i < deleteCount; i++) {
      ops.push(this.doc.deleteAt(start));
    }
    for (let i = 0; i < inserted.length; i++) {
      // Each char anchors on the one before it (including ones just
      // inserted in this same loop), matching how a real person typing
      // sequential characters naturally chains them.
      ops.push(this.doc.insertAt(start + i, inserted[i]));
    }

    for (const op of ops) void appendOp(this.roomId, op);
    // If every peer is currently offline, broadcast() is simply a no-op —
    // there's no outbox or retry here. That's fine: these ops are already
    // persisted, so whenever a data channel next opens, the state-vector
    // exchange below will catch whoever's missing them up from storage.
    this.manager.broadcast(JSON.stringify({ kind: 'ops', ops } satisfies OpBatchMessage));
    this.emitter.emit('change', { text: this.doc.toText(), remoteEdits: [] });
  }

  close(): void {
    this.unsubscribeMessage();
    this.unsubscribeConnected();
  }

  private sendStateVector(peerId: string): void {
    const vector = this.doc.getStateVector();
    this.manager.send(peerId, JSON.stringify({ kind: 'state-vector', vector } satisfies StateVectorMessage));
  }

  // Called when a peer tells us what they have. Loads this room's full
  // persisted history (not just whatever's in the live tree — same
  // thing, but storage is the canonical source) and sends back only the
  // ops whose origin's counter is past what they reported for that site.
  private async sendMissingOps(peerId: string, theirVector: Record<SiteId, number>): Promise<void> {
    const allOps = await loadOps(this.roomId);
    const missing = allOps.filter((op) => {
      const origin = op.type === 'insert' ? op.id : op.origin;
      const theirMax = theirVector[origin.site] ?? -1;
      return origin.counter > theirMax;
    });
    if (missing.length === 0) return;
    this.manager.send(peerId, JSON.stringify({ kind: 'ops', ops: missing } satisfies OpBatchMessage));
  }

  private handleRemoteMessage(peerId: string, data: string): void {
    let message: WireMessage;
    try {
      message = JSON.parse(data);
    } catch {
      return; // not JSON we understand; ignore rather than crash the session
    }

    if (message.kind === 'state-vector') {
      void this.sendMissingOps(peerId, message.vector);
      return;
    }
    if (message.kind !== 'ops') return;

    const remoteEdits: RemoteEdit[] = [];
    for (const op of message.ops) {
      if (op.type === 'insert') {
        this.doc.applyOp(op);
        const index = this.doc.indexOf(op.id);
        // index is -1 if the op got buffered (its parent hasn't arrived
        // yet) rather than actually landing in the visible text yet.
        if (index !== -1) remoteEdits.push({ index, delta: 1 });
      } else {
        // Capture position *before* applying: once deleted, the node no
        // longer shows up in indexOf at all.
        const index = this.doc.indexOf(op.target);
        this.doc.applyOp(op);
        if (index !== -1) remoteEdits.push({ index, delta: -1 });
      }
      void appendOp(this.roomId, op);
    }

    this.emitter.emit('change', { text: this.doc.toText(), remoteEdits });
  }
}
