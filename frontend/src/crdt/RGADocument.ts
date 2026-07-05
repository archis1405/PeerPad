import { compareOpId, opIdKey, type OpId, type SiteId } from './id';
import type { DeleteOp, InsertOp, Op, RGANode } from './types';

// RGADocument models the document as a tree, not a flat list:
//
//   - Every node's `parentId` is the id of the node it was typed immediately
//     after. That parent/child relationship is a causal fact recorded at
//     insert time and never changes.
//   - A node's `children` are every node ever inserted directly after it,
//     kept sorted by descending id.
//   - The document's visible text is a pre-order traversal of this tree:
//     visit a node, then its children (which are each other's siblings,
//     already sorted), recursively.
//
// Why a tree instead of the "linked list with tie-break scanning" that RGA
// is usually pictured as: a naive flat scan ("walk right from the anchor,
// skipping any node with a higher id than the one being inserted, stop at
// the first lower id") looks right for simple cases but is subtly wrong —
// it can walk past the *entire* subtree of an unrelated earlier sibling and
// interleave a new node inside content it has no causal relationship to,
// if that sibling's own descendants happen to have lower ids than the new
// node. The tree formulation sidesteps the bug entirely: when inserting
// after node P, the new node only ever needs to be compared against P's
// *direct* children, because everything already nested under one of those
// children stays nested under it — the pre-order traversal handles keeping
// each subtree contiguous for free. Two sites that both derive the same
// tree from the same set of ops always produce the same traversal, which
// is the whole convergence guarantee.
//
// Tombstones: markDeleted never removes a node, it just flips `deleted` to
// true. The node (and its id) stays in the tree forever. This matters
// because other nodes may be anchored on it (parentId pointing at it) —
// physically removing it would strand those children with no anchor to
// reattach to. toText() simply skips deleted nodes when building the
// string; everything else about the tree is unaffected by deletion.

// A virtual root that every top-level node (parentId === null) is a child
// of. Giving the root a `children` array lets insertSorted and the
// pre-order traversal treat "inserted at the start of the document" the
// same as "inserted after some real node" — no special-casing needed.
interface RootNode {
  readonly children: RGANode[];
}

export class RGADocument {
  private readonly siteId: SiteId;
  private counter = 0;
  private readonly root: RootNode = { children: [] };
  private readonly nodesById = new Map<string, RGANode>();

  // Ops that arrived before the node they depend on. Keyed by the id of the
  // node being waited on.
  private readonly pendingChildren = new Map<string, InsertOp[]>();
  // Delete ops that arrived before the insert they target. We can't set
  // `deleted` on a node that doesn't exist yet, so we remember the id and
  // apply the tombstone the moment the insert shows up.
  private readonly pendingDeletes = new Set<string>();

  // Highest counter seen from each site, across every op (insert or
  // delete) ever passed through applyOp — this is the document's state
  // vector, used to figure out what a reconnecting or newly-met peer is
  // missing (see CollabSession). It's updated even for ops that end up
  // buffered rather than immediately integrated: once we've received an
  // op at all, we don't want a peer to resend it to us.
  private readonly stateVector = new Map<SiteId, number>();

  constructor(siteId: SiteId) {
    this.siteId = siteId;
  }

  // --- Local edit generation -------------------------------------------
  // These are called when *this* site makes an edit. They allocate a fresh
  // id from the local counter, apply the op to the local tree immediately,
  // and return the op so the caller can broadcast it to other peers.

  insertAfter(parentId: OpId | null, value: string): InsertOp {
    const op: InsertOp = {
      type: 'insert',
      id: { site: this.siteId, counter: this.counter++ },
      value,
      parentId,
    };
    this.integrateInsert(op);
    return op;
  }

  markDeleted(target: OpId): DeleteOp {
    const op: DeleteOp = {
      type: 'delete',
      origin: { site: this.siteId, counter: this.counter++ },
      target,
    };
    this.integrateDelete(op);
    return op;
  }

  // Convenience wrappers around insertAfter/markDeleted for callers (tests,
  // and eventually the textarea UI) that think in terms of visible text
  // positions rather than node ids. The index is resolved to a stable id
  // *before* the op is created, so the op itself is still anchor-based —
  // only the local translation from "cursor position" to "anchor" is
  // index-based.
  insertAt(index: number, value: string): InsertOp {
    const visible = this.visibleNodesInOrder();
    const parentId = index === 0 ? null : visible[index - 1].id;
    return this.insertAfter(parentId, value);
  }

  deleteAt(index: number): DeleteOp {
    const visible = this.visibleNodesInOrder();
    const target = visible[index];
    if (!target) {
      throw new Error(`deleteAt: index ${index} is out of range`);
    }
    return this.markDeleted(target.id);
  }

  // --- Remote op application --------------------------------------------
  // Applying a remote op goes through the exact same integrate* functions
  // as a local edit, which is what makes replay from IndexedDB and live
  // application over the data channel behave identically.

  applyOp(op: Op): void {
    if (op.type === 'insert') {
      this.integrateInsert(op);
    } else {
      this.integrateDelete(op);
    }
  }

  toText(): string {
    return this.visibleNodesInOrder()
      .map((node) => node.value)
      .join('');
  }

  // Position of `id` among currently-visible nodes, or -1 if it doesn't
  // exist (not yet integrated, or on the other side of a causal buffer)
  // or is deleted. This is how UI code maps a remote op back onto a
  // textarea offset (see CollabSession) — the CRDT itself only ever deals
  // in ids, never positions, but the DOM only understands positions.
  indexOf(id: OpId): number {
    const node = this.nodesById.get(opIdKey(id));
    if (!node || node.deleted) return -1;
    // Fine at demo scale; a production version would keep an
    // order-statistics structure instead of walking the whole tree per call.
    return this.visibleNodesInOrder().findIndex((n) => n === node);
  }

  // Highest counter seen per site, covering both inserts and deletes.
  // Compared against a peer's own vector during reconnection to work out
  // what to send them (see CollabSession.sendMissingOps).
  getStateVector(): Record<SiteId, number> {
    return Object.fromEntries(this.stateVector);
  }

  // --- Internals ----------------------------------------------------------

  private recordSeen(origin: OpId): void {
    const current = this.stateVector.get(origin.site) ?? -1;
    if (origin.counter > current) this.stateVector.set(origin.site, origin.counter);
  }

  private integrateInsert(op: InsertOp): void {
    this.recordSeen(op.id);
    const key = opIdKey(op.id);
    if (this.nodesById.has(key)) return; // already applied; ops are idempotent

    const parent = op.parentId === null ? this.root : this.nodesById.get(opIdKey(op.parentId));
    if (!parent) {
      // Causal dependency not met yet (this can happen when ops arrive over
      // separate peer-to-peer links with independent timing) — hold onto
      // it until the parent shows up.
      const key2 = opIdKey(op.parentId as OpId);
      const waiting = this.pendingChildren.get(key2) ?? [];
      waiting.push(op);
      this.pendingChildren.set(key2, waiting);
      return;
    }

    // If a delete for this id arrived before the insert did, apply the
    // tombstone immediately instead of losing it.
    const alreadyDeleted = this.pendingDeletes.delete(key);

    const node: RGANode = {
      id: op.id,
      value: op.value,
      deleted: alreadyDeleted,
      parentId: op.parentId,
      children: [],
    };
    this.nodesById.set(key, node);
    insertSorted(parent.children, node);

    // Now that this node exists, any buffered children waiting on it can
    // be integrated too (recursively, in case they unblock further ops).
    const unblocked = this.pendingChildren.get(key);
    if (unblocked) {
      this.pendingChildren.delete(key);
      for (const childOp of unblocked) this.integrateInsert(childOp);
    }
  }

  private integrateDelete(op: DeleteOp): void {
    this.recordSeen(op.origin);
    const node = this.nodesById.get(opIdKey(op.target));
    if (node) {
      node.deleted = true;
    } else {
      this.pendingDeletes.add(opIdKey(op.target));
    }
  }

  private visibleNodesInOrder(): RGANode[] {
    const result: RGANode[] = [];
    const visit = (node: RGANode) => {
      if (!node.deleted) result.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.root.children) visit(child);
    return result;
  }
}

// Places `node` among `siblings`, which are kept sorted by descending id
// (highest id first). Descending vs. ascending is an arbitrary but
// load-bearing choice: it only matters that every site applies the *same*
// rule, since that's what makes two sites that received the same set of
// inserts-after-this-parent, in any order, end up with an identical
// `children` array. Because compareOpId is a strict total order (ids are
// never equal), this splice position is fully determined by the id set —
// not by arrival order.
function insertSorted(siblings: RGANode[], node: RGANode): void {
  let i = 0;
  while (i < siblings.length && compareOpId(siblings[i].id, node.id) > 0) {
    i++;
  }
  siblings.splice(i, 0, node);
}
