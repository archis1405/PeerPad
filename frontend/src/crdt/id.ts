// Every character inserted into the document gets a globally unique,
// totally-ordered id. Uniqueness comes from pairing a site's own name with a
// counter that only that site increments; ordering comes from comparing
// those pairs. We deliberately do NOT use wall-clock time or a Lamport clock
// synchronized across sites — a site's counter only ever needs to avoid
// repeating a value it has already used itself, since the `site` field
// already tells two ids from different sites apart. That means a brand new
// site can join with counter starting at 0 without coordinating with anyone.

export type SiteId = string;

export interface OpId {
  readonly site: SiteId;
  readonly counter: number;
}

// Total order over ids: compare counters first, and only fall back to
// comparing site names when two sites happen to be at the same counter
// value (which will usually mean they're concurrent edits). Because no two
// ids are ever equal (a site never reuses a counter value), this comparator
// never returns 0 for distinct ids, which is what lets sibling ordering
// (see RGADocument's insertSorted) be fully deterministic.
export function compareOpId(a: OpId, b: OpId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.site < b.site) return -1;
  if (a.site > b.site) return 1;
  return 0;
}

export function opIdEquals(a: OpId, b: OpId): boolean {
  return a.counter === b.counter && a.site === b.site;
}

// String key for Map/Set lookups, since OpId objects aren't reference-equal
// across sites even when they represent the same id.
export function opIdKey(id: OpId): string {
  return `${id.counter}:${id.site}`;
}
