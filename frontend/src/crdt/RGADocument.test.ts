import { describe, expect, it } from 'vitest';
import { RGADocument } from './RGADocument';

describe('RGADocument basics', () => {
  it('builds text from sequential local inserts', () => {
    const doc = new RGADocument('A');
    doc.insertAt(0, 'h');
    doc.insertAt(1, 'i');
    expect(doc.toText()).toBe('hi');
  });

  it('marks nodes deleted instead of removing them', () => {
    const doc = new RGADocument('A');
    doc.insertAt(0, 'h');
    doc.insertAt(1, 'i');
    doc.deleteAt(0); // delete 'h'
    expect(doc.toText()).toBe('i');
  });

  it('lets an insert anchor on a node that has already been deleted', () => {
    // This is exactly why deletes are tombstones rather than physical
    // removals: node 'b' is still a valid anchor for 'c' even after 'b'
    // itself is deleted, because it's still present in the tree.
    const doc = new RGADocument('A');
    const opA = doc.insertAt(0, 'a');
    const opB = doc.insertAfter(opA.id, 'b');
    doc.markDeleted(opB.id);
    doc.insertAfter(opB.id, 'c');
    expect(doc.toText()).toBe('ac');
  });
});

describe('RGADocument concurrent tie-breaking', () => {
  it('resolves two concurrent inserts after the same node the same way regardless of delivery order', () => {
    // Site A and Site B both start from a shared 'a', then concurrently
    // (without having seen each other's edit) insert a character right
    // after it. Convergence means both delivery orders must produce the
    // same final text.
    const seed = new RGADocument('seed');
    const opA = seed.insertAt(0, 'a');

    const insert1 = {
      type: 'insert' as const,
      id: { site: '1', counter: 0 },
      value: 'x',
      parentId: opA.id,
    };
    const insert2 = {
      type: 'insert' as const,
      id: { site: '2', counter: 0 },
      value: 'y',
      parentId: opA.id,
    };

    const docOrder1 = new RGADocument('replica-1');
    docOrder1.applyOp({ type: 'insert', id: opA.id, value: opA.value, parentId: opA.parentId });
    docOrder1.applyOp(insert1);
    docOrder1.applyOp(insert2);

    const docOrder2 = new RGADocument('replica-2');
    docOrder2.applyOp({ type: 'insert', id: opA.id, value: opA.value, parentId: opA.parentId });
    docOrder2.applyOp(insert2);
    docOrder2.applyOp(insert1);

    expect(docOrder1.toText()).toBe(docOrder2.toText());
    // Site '2' sorts after site '1' for equal counters, so id-descending
    // order among siblings puts site '2's insert first, right after 'a'.
    expect(docOrder1.toText()).toBe('ayx');
  });
});

describe('RGADocument out-of-order delivery', () => {
  it('buffers an insert whose parent has not arrived yet, then integrates it once the parent does', () => {
    const source = new RGADocument('A');
    const opA = source.insertAt(0, 'a');
    const opB = source.insertAfter(opA.id, 'b');

    const replica = new RGADocument('replica');
    // Deliver the child before the parent.
    replica.applyOp(opB);
    expect(replica.toText()).toBe(''); // 'b' is buffered, not yet visible

    replica.applyOp(opA);
    expect(replica.toText()).toBe('ab');
  });

  it('buffers a delete whose target has not arrived yet, then applies the tombstone on arrival', () => {
    const source = new RGADocument('A');
    const opA = source.insertAt(0, 'a');
    const delOp = source.markDeleted(opA.id);

    const replica = new RGADocument('replica');
    replica.applyOp(delOp);
    replica.applyOp(opA);

    expect(replica.toText()).toBe('');
  });

  it('applies duplicate delivery of the same op idempotently', () => {
    const doc = new RGADocument('A');
    const opA = doc.insertAt(0, 'a');
    doc.applyOp(opA);
    doc.applyOp(opA);
    expect(doc.toText()).toBe('a');
  });
});

describe('RGADocument state vector', () => {
  it('starts empty for a brand new document', () => {
    const doc = new RGADocument('A');
    expect(doc.getStateVector()).toEqual({});
  });

  it('tracks the highest counter seen per site across inserts', () => {
    const doc = new RGADocument('A');
    doc.insertAt(0, 'a'); // A's counter 0
    doc.insertAt(1, 'b'); // A's counter 1
    expect(doc.getStateVector()).toEqual({ A: 1 });
  });

  it('advances the vector for a delete using its own origin, not its target', () => {
    // A delete op references an existing node (its target), but it also
    // has its own origin — this is exactly why DeleteOp needed an origin
    // field at all: without one, deletes would be invisible here.
    const doc = new RGADocument('A');
    const opA = doc.insertAt(0, 'a'); // A's counter 0
    doc.markDeleted(opA.id); // A's counter 1 (the delete's own origin)
    expect(doc.getStateVector()).toEqual({ A: 1 });
  });

  it('tracks multiple sites independently', () => {
    const doc = new RGADocument('replica');
    const opA0 = { type: 'insert' as const, id: { site: 'A', counter: 0 }, value: 'a', parentId: null };
    const opB0 = { type: 'insert' as const, id: { site: 'B', counter: 0 }, value: 'b', parentId: opA0.id };
    const opB1 = { type: 'insert' as const, id: { site: 'B', counter: 1 }, value: 'c', parentId: opB0.id };
    doc.applyOp(opA0);
    doc.applyOp(opB0);
    doc.applyOp(opB1);
    expect(doc.getStateVector()).toEqual({ A: 0, B: 1 });
  });

  it('records an op as seen even when it is only buffered, not yet integrated', () => {
    // Without this, a peer that already has an op queued (waiting on its
    // parent) would look like it's still missing that op, and a
    // reconnect resync would needlessly resend it.
    const doc = new RGADocument('replica');
    const childOp = { type: 'insert' as const, id: { site: 'A', counter: 1 }, value: 'b', parentId: { site: 'A', counter: 0 } };
    doc.applyOp(childOp); // parent (counter 0) hasn't arrived; this gets buffered
    expect(doc.getStateVector()).toEqual({ A: 1 });
  });
});
