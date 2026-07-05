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
  // The id of the node being deleted (an existing InsertOp's id).
  readonly id: OpId;
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
