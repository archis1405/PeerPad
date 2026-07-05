import { Emitter } from '../lib/emitter';
import { RGADocument } from '../crdt';
import type { Op } from '../crdt';
import type { WebRTCManager } from '../net';
import { diffText } from './textDiff';

// The one message shape this layer puts on the data channel: a batch of
// CRDT ops. A single keystroke produces a batch of size 1; a paste of 50
// characters produces a batch of 50 sent as one data channel message
// rather than 50 separate sends.
interface OpBatchMessage {
  kind: 'ops';
  ops: Op[];
}

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
export class CollabSession {
  readonly doc: RGADocument;
  private readonly manager: WebRTCManager;
  private readonly emitter = new Emitter<CollabSessionEvents>();
  private readonly unsubscribe: () => void;

  constructor(siteId: string, manager: WebRTCManager) {
    this.doc = new RGADocument(siteId);
    this.manager = manager;
    this.unsubscribe = manager.on('message', ({ data }) => this.handleRemoteMessage(data));
  }

  on<K extends keyof CollabSessionEvents>(
    event: K,
    listener: (payload: CollabSessionEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  // Called by the UI whenever the textarea's value changes. Diffs against
  // the previously-known text to recover what the user actually did, adds
  // it to the local RGA, and broadcasts the resulting ops to every peer.
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

    this.manager.broadcast(JSON.stringify({ kind: 'ops', ops } satisfies OpBatchMessage));
    this.emitter.emit('change', { text: this.doc.toText(), remoteEdits: [] });
  }

  close(): void {
    this.unsubscribe();
  }

  private handleRemoteMessage(data: string): void {
    let message: OpBatchMessage;
    try {
      message = JSON.parse(data);
    } catch {
      return; // not JSON we understand; ignore rather than crash the session
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
        const index = this.doc.indexOf(op.id);
        this.doc.applyOp(op);
        if (index !== -1) remoteEdits.push({ index, delta: -1 });
      }
    }

    this.emitter.emit('change', { text: this.doc.toText(), remoteEdits });
  }
}
