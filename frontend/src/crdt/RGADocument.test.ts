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
