/**
 * Random workload generators. Every generator takes a `seed`, so a workload that taught
 * something can be reproduced exactly (the UI shows the seed next to the Random button).
 * No browser code here: the output is plain data the views load like a preset.
 */

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function createRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a fresh seed for the "Random" button. */
export const newSeed = () => Math.floor(Math.random() * 90_000) + 10_000;

const clamp = (value, lo, hi) => Math.min(Math.max(Math.round(Number(value)), lo), hi);
const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive

/**
 * Rows of [arrival, burst, priority], the shape presets use. The earliest arrival is shifted to 0
 * so a random run never starts with a pointless idle gap.
 */
export function randomProcesses({ seed, count = 5, maxArrival = 8, maxBurst = 10, maxPriority = 5 } = {}) {
  const rng = createRng(seed);
  const n = clamp(count, 1, 12);
  const rows = Array.from({ length: n }, () => [
    between(rng, 0, clamp(maxArrival, 0, 100)),
    between(rng, 1, clamp(maxBurst, 1, 100)),
    between(rng, 1, clamp(maxPriority, 1, 20)),
  ]);
  const first = Math.min(...rows.map((r) => r[0]));
  return rows.map(([arrival, burst, priority]) => [arrival - first, burst, priority]);
}

/**
 * A reference string over pages 0..pages-1. `locality` (0 to 1) is the chance that a reference
 * stays inside a small hot set that drifts over time; 0 gives uniform random pages.
 */
export function randomReferenceString({ seed, length = 20, pages = 7, locality = 0.5 } = {}) {
  const rng = createRng(seed);
  const len = clamp(length, 1, 60);
  const pageCount = clamp(pages, 1, 20);
  const p = Math.min(Math.max(Number(locality), 0), 1);
  const hotSize = Math.max(1, Math.min(3, pageCount));
  let hotStart = between(rng, 0, pageCount - 1);
  const refs = [];
  for (let i = 0; i < len; i++) {
    if (rng() < 0.08) hotStart = between(rng, 0, pageCount - 1);
    refs.push(rng() < p ? (hotStart + between(rng, 0, hotSize - 1)) % pageCount : between(rng, 0, pageCount - 1));
  }
  return refs;
}

/**
 * Memory requests for the fragmentation tab: sizes in KB, and now and then a process leaves.
 * Returns { size, partitions, ops } where `ops` uses the same objects parseOperations() produces.
 */
export function randomMemoryWorkload({ seed, count = 8, minSize = 40, maxSize = 300 } = {}) {
  const rng = createRng(seed);
  const n = clamp(count, 2, 20);
  const lo = clamp(minSize, 1, 10_000);
  const hi = clamp(maxSize, lo, 10_000);
  const step = (value) => Math.max(1, Math.round(value / 10) * 10);

  const ops = [];
  const resident = [];
  let next = 1;
  while (ops.filter((o) => o.type === 'alloc').length < n) {
    if (resident.length > 1 && rng() < 0.3) {
      const [pid] = resident.splice(between(rng, 0, resident.length - 1), 1);
      ops.push({ type: 'free', pid });
    } else {
      const pid = `P${next++}`;
      ops.push({ type: 'alloc', pid, size: step(between(rng, lo, hi)) });
      resident.push(pid);
    }
  }

  const partitions = Array.from({ length: between(rng, 4, 6) }, () => step(between(rng, lo, Math.round(hi * 1.6))));
  const size = Math.max(step(partitions.reduce((a, b) => a + b, 0)), hi);
  return { size, partitions, ops };
}
