export const MAX_REFS = 1000;
export const MAX_FRAMES = 64;

export const PAGING_ALGORITHMS = {
  fifo: {
    id: 'fifo',
    label: 'FIFO',
    hint: 'Evicts the page that has been in memory longest, however often it is used. Can get worse with more frames (Belady’s anomaly).',
  },
  lru: {
    id: 'lru',
    label: 'LRU',
    hint: 'Evicts the page that has gone unused longest. More frames never hurt, but real hardware needs bookkeeping on every access.',
  },
  opt: {
    id: 'opt',
    label: 'Optimal',
    hint: 'Evicts the page whose next use is farthest away. It needs to know the future, so it is a benchmark rather than a real policy.',
  },
};

/** "7, 0 1;2" → [7, 0, 1, 2]. Throws a readable message on anything else. */
export function parseReferenceString(text) {
  const tokens = String(text ?? '').split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error('Enter a reference string, e.g. 7, 0, 1, 2, 0, 3.');
  return tokens.map((token) => {
    const page = Number(token);
    if (!/^\d+$/.test(token) || !Number.isSafeInteger(page)) {
      throw new Error(`"${token}" is not a page number. Use whole numbers ≥ 0 separated by commas or spaces.`);
    }
    return page;
  });
}

/** Index of the slot to evict. Every slot is occupied when this is called. */
function pickVictim(algorithm, slots) {
  const better = {
    fifo: (a, b) => a.loadedAt < b.loadedAt,
    lru: (a, b) => a.lastUsed < b.lastUsed,
    // Farthest next use wins; among pages never used again, the one loaded first.
    opt: (a, b) => a.nextUse > b.nextUse || (a.nextUse === b.nextUse && a.loadedAt < b.loadedAt),
  }[algorithm];
  let best = 0;
  for (let s = 1; s < slots.length; s++) if (better(slots[s], slots[best])) best = s;
  return best;
}

/**
 * Run one page-replacement policy over a reference string.
 *
 * Pages keep their frame until evicted (as in textbook tables). Frame and reference
 * numbers here are 0-based indices; the UI adds 1 when it displays them.
 *
 * @param {number[]} refs
 * @param {number} frameCount
 * @param {keyof typeof PAGING_ALGORITHMS} algorithmId
 * @returns steps[i] = state after processing refs[i]:
 *   { i, page, hit, slot, evicted: null | { page, loadedAt, lastUsed, nextUse|null }, frames, faultsSoFar }
 */
export function simulatePaging(refs, frameCount, algorithmId) {
  const algo = PAGING_ALGORITHMS[algorithmId];
  if (!algo) throw new Error(`Unknown algorithm "${algorithmId}".`);
  if (!Array.isArray(refs) || refs.length === 0) throw new Error('Enter at least one page reference.');
  if (refs.length > MAX_REFS) throw new Error(`Reference string is too long (${refs.length}; the limit is ${MAX_REFS}).`);
  if (!refs.every((p) => Number.isSafeInteger(p) && p >= 0)) throw new Error('Pages must be whole numbers ≥ 0.');
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > MAX_FRAMES) {
    throw new Error(`Frames must be a whole number from 1 to ${MAX_FRAMES}.`);
  }

  const n = refs.length;

  // nextUse[i]: index of the next reference to refs[i]'s page after i, or Infinity.
  const nextUse = new Array(n);
  const upcoming = new Map();
  for (let i = n - 1; i >= 0; i--) {
    nextUse[i] = upcoming.get(refs[i]) ?? Infinity;
    upcoming.set(refs[i], i);
  }

  const slots = new Array(frameCount).fill(null); // { page, loadedAt, lastUsed, nextUse }
  const steps = [];
  let faults = 0;

  for (let i = 0; i < n; i++) {
    const page = refs[i];
    let slot = slots.findIndex((s) => s && s.page === page);
    const hit = slot !== -1;
    let evicted = null;

    if (hit) {
      slots[slot].lastUsed = i;
      slots[slot].nextUse = nextUse[i];
    } else {
      faults++;
      slot = slots.indexOf(null); // lowest free frame first
      if (slot === -1) {
        slot = pickVictim(algo.id, slots);
        const v = slots[slot];
        evicted = {
          page: v.page,
          loadedAt: v.loadedAt,
          lastUsed: v.lastUsed,
          nextUse: v.nextUse === Infinity ? null : v.nextUse,
        };
      }
      slots[slot] = { page, loadedAt: i, lastUsed: i, nextUse: nextUse[i] };
    }

    steps.push({ i, page, hit, slot, evicted, frames: slots.map((s) => (s ? s.page : null)), faultsSoFar: faults });
  }

  return {
    algorithm: algo.id,
    label: algo.label,
    frames: frameCount,
    refs: [...refs],
    steps,
    faults,
    hits: n - faults,
    faultRate: faults / n, // fractions in [0, 1]
    hitRate: (n - faults) / n,
    distinctPages: upcoming.size,
  };
}
