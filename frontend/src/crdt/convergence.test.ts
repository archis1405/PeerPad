import { describe, it } from 'vitest';
import { RGADocument } from './RGADocument';
import type { Op } from './types';

// Deterministic PRNG (mulberry32) so a failing run prints a seed you can
// paste back in to reproduce it exactly — plain Math.random() would make
// failures unreproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = 'abcdefghij';

// Simulates a full mesh of peers, each connected to every other peer over
// its own independent, ordered, reliable link (this is what an
// RTCDataChannel gives you) — but with NO ordering guarantee *across*
// different links. That's the realistic failure mode this test is after:
// site B might create an op that depends on something site A sent, and
// forward it to site C faster than A's original op gets to C. C has to
// buffer B's op until A's arrives — exercising exactly the pending-child
// buffering in RGADocument.
function runConvergenceSimulation(seed: number, siteCount: number, rounds: number): void {
  const random = mulberry32(seed);
  const siteIds = Array.from({ length: siteCount }, (_, i) => `site-${i}`);
  const docs = new Map(siteIds.map((id) => [id, new RGADocument(id)]));

  // One FIFO queue per ordered pair (origin, destination) — preserves
  // per-link delivery order while allowing different links to race.
  const channels = new Map<string, Op[]>();
  const channelKey = (from: string, to: string) => `${from}->${to}`;
  for (const from of siteIds) {
    for (const to of siteIds) {
      if (from !== to) channels.set(channelKey(from, to), []);
    }
  }

  function broadcast(from: string, op: Op) {
    for (const to of siteIds) {
      if (to !== from) channels.get(channelKey(from, to))!.push(op);
    }
  }

  function generateLocalEdit(siteId: string) {
    const doc = docs.get(siteId)!;
    const text = doc.toText();
    const insert = text.length === 0 || random() < 0.7;
    if (insert) {
      const index = Math.floor(random() * (text.length + 1));
      const char = ALPHABET[Math.floor(random() * ALPHABET.length)];
      broadcast(siteId, doc.insertAt(index, char));
    } else {
      const index = Math.floor(random() * text.length);
      broadcast(siteId, doc.deleteAt(index));
    }
  }

  function deliverOneRandomPendingOp() {
    const nonEmpty = [...channels.entries()].filter(([, queue]) => queue.length > 0);
    if (nonEmpty.length === 0) return;
    const [key, queue] = nonEmpty[Math.floor(random() * nonEmpty.length)];
    const to = key.split('->')[1];
    const op = queue.shift()!;
    docs.get(to)!.applyOp(op);
  }

  for (let round = 0; round < rounds; round++) {
    for (const siteId of siteIds) {
      if (random() < 0.8) generateLocalEdit(siteId);
    }
    // Interleave delivery with generation so ops from different rounds and
    // different sites end up racing each other realistically, instead of
    // being delivered in tidy round-sized batches.
    const deliveries = Math.floor(random() * siteCount * 2);
    for (let i = 0; i < deliveries; i++) deliverOneRandomPendingOp();
  }

  // Flush: every op must eventually reach every peer.
  let remaining = [...channels.values()].reduce((sum, q) => sum + q.length, 0);
  while (remaining > 0) {
    deliverOneRandomPendingOp();
    remaining = [...channels.values()].reduce((sum, q) => sum + q.length, 0);
  }

  const finalTexts = siteIds.map((id) => docs.get(id)!.toText());
  const mismatch = finalTexts.some((text) => text !== finalTexts[0]);
  if (mismatch) {
    throw new Error(
      `sites diverged for seed=${seed} siteCount=${siteCount} rounds=${rounds}:\n` +
        siteIds.map((id, i) => `  ${id}: ${JSON.stringify(finalTexts[i])}`).join('\n'),
    );
  }
}

describe('RGADocument convergence under randomized concurrent editing', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('converges for seed %i', (seed) => {
    runConvergenceSimulation(seed, /* siteCount */ 4, /* rounds */ 40);
  });

  it('converges with more sites and more rounds', () => {
    runConvergenceSimulation(1337, /* siteCount */ 6, /* rounds */ 80);
  });
});
