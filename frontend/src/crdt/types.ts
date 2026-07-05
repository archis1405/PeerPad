import type { OpId } from './id';

// The two operations a site can broadcast. Both are commutative and
// idempotent once applied through RGADocument.applyOp, which is what lets
// peers apply them in whatever order the network delivers them.
export interface InsertOp {
  readonly type: 'insert';
  readonly id: OpId;
  readonly value: string;
  // The id of the node this character was inserted immediately after, or
  // null to mean "at the very start of the document". This is the causal
  // anchor: applying this op requires that node to already exist locally.
  readonly parentId: OpId | null;
}

export interface DeleteOp {
  readonly type: 'delete';
  // This delete's own place in its author's sequence — distinct from
  // `target`. Without its own origin, a delete would be invisible to a
  // per-site state vector (see RGADocument.getStateVector): the vector
  // tracks "highest counter I've seen from site X", and a delete that
  // only carried the id of the node it removes wouldn't consume a slot
  // in the deleting site's own sequence at all.
  readonly origin: OpId;
  // The id of the node being deleted (an existing InsertOp's id).
  readonly target: OpId;
}

export type Op = InsertOp | DeleteOp;

// A live node in the document tree. `children` holds every node that was
// inserted directly after this one, kept sorted by descending id (see
// RGADocument.insertSorted for why descending, and why only direct
// siblings ever need to be compared).
export interface RGANode {
  readonly id: OpId;
  readonly value: string;
  deleted: boolean;
  readonly parentId: OpId | null;
  readonly children: RGANode[];
}
