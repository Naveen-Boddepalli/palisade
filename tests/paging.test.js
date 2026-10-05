import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulatePaging, parseReferenceString, PAGING_ALGORITHMS } from '../src/engine/paging.js';

const TEXTBOOK = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];
const BELADY = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
const CYCLE = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5];

const faults = (refs, frames, algo) => simulatePaging(refs, frames, algo).faults;

// ---------------------------------------------------------------- golden results (Silberschatz)

test('textbook string, 3 frames: FIFO 15, LRU 12, Optimal 9', () => {
  assert.equal(faults(TEXTBOOK, 3, 'fifo'), 15);
  assert.equal(faults(TEXTBOOK, 3, 'lru'), 12);
  assert.equal(faults(TEXTBOOK, 3, 'opt'), 9);
});

test("Belady's anomaly: FIFO faults 9 with 3 frames but 10 with 4", () => {
  assert.equal(faults(BELADY, 3, 'fifo'), 9);
  assert.equal(faults(BELADY, 4, 'fifo'), 10);
});

test('LRU and Optimal do not show the anomaly on the same string', () => {
  assert.ok(faults(BELADY, 4, 'lru') <= faults(BELADY, 3, 'lru'));
  assert.ok(faults(BELADY, 4, 'opt') <= faults(BELADY, 3, 'opt'));
});

test('cyclic scan over frames+1 pages: FIFO and LRU fault every time, Optimal does not', () => {
  assert.equal(faults(CYCLE, 4, 'fifo'), 15);
  assert.equal(faults(CYCLE, 4, 'lru'), 15);
  assert.equal(faults(CYCLE, 4, 'opt'), 7);
});

// ---------------------------------------------------------------- step-level behaviour

test('FIFO steps: free frames fill lowest-first, then the oldest page is replaced in place', () => {
  const run = simulatePaging(TEXTBOOK, 3, 'fifo');
  const [s0, s1, s2, s3, s4, s5] = run.steps;

  assert.deepEqual(s0.frames, [7, null, null]);
  assert.deepEqual(s1.frames, [7, 0, null]);
  assert.deepEqual(s2.frames, [7, 0, 1]);
  assert.deepEqual([s0.slot, s1.slot, s2.slot], [0, 1, 2]);
  assert.equal(s2.evicted, null);

  // Page 2 faults with all frames full: 7 was loaded first, so it goes.
  assert.equal(s3.hit, false);
  assert.deepEqual(s3.frames, [2, 0, 1]);
  assert.equal(s3.slot, 0);
  assert.deepEqual(s3.evicted, { page: 7, loadedAt: 0, lastUsed: 0, nextUse: 17 });

  assert.equal(s4.hit, true); // page 0 is still resident
  assert.equal(s4.evicted, null);
  assert.deepEqual(s5.frames, [2, 3, 1]); // 0 was next-oldest
});

test('LRU evicts the least recently used, not the oldest', () => {
  // 1,2 fill; 1 is touched again, so 2 is the LRU victim when 3 arrives (FIFO would evict 1).
  const lru = simulatePaging([1, 2, 1, 3], 2, 'lru');
  assert.deepEqual(lru.steps[3].frames, [1, 3]);
  assert.equal(lru.steps[3].evicted.page, 2);
  assert.equal(lru.steps[3].evicted.lastUsed, 1);

  const fifo = simulatePaging([1, 2, 1, 3], 2, 'fifo');
  assert.deepEqual(fifo.steps[3].frames, [3, 2]);
  assert.equal(fifo.steps[3].evicted.page, 1);
});

test('Optimal evicts the page used farthest ahead and reports when it is next needed', () => {
  const run = simulatePaging([1, 2, 3, 1, 2, 3], 2, 'opt');
  // At ref 3 frames hold {1,2}; 1 is needed at index 3, 2 at index 4 → evict 2.
  assert.equal(run.steps[2].evicted.page, 2);
  assert.equal(run.steps[2].evicted.nextUse, 4);
});

test('Optimal: pages never used again are evicted first, ties go to the one loaded first', () => {
  const run = simulatePaging([1, 2, 3], 2, 'opt');
  assert.equal(run.steps[2].evicted.page, 1);
  assert.equal(run.steps[2].evicted.nextUse, null);
  assert.deepEqual(run.steps[2].frames, [3, 2]);
});

test('with a single frame every change of page faults', () => {
  const run = simulatePaging([1, 1, 2, 2, 1], 1, 'lru');
  assert.deepEqual(run.steps.map((s) => s.hit), [false, true, false, true, false]);
  assert.equal(run.faults, 3);
});

test('more frames than distinct pages: only cold faults', () => {
  for (const id of Object.keys(PAGING_ALGORITHMS)) {
    const run = simulatePaging(TEXTBOOK, 10, id);
    assert.equal(run.faults, run.distinctPages, id);
  }
});

test('summary numbers', () => {
  const run = simulatePaging(TEXTBOOK, 3, 'lru');
  assert.equal(run.faults + run.hits, 20);
  assert.equal(run.faults, 12);
  assert.equal(run.faultRate, 0.6);
  assert.equal(run.hitRate, 0.4);
  assert.equal(run.distinctPages, 6); // pages 7, 0, 1, 2, 3, 4
  assert.equal(run.steps.at(-1).faultsSoFar, 12);
});

// ---------------------------------------------------------------- parsing + validation

test('parseReferenceString accepts commas, spaces and semicolons', () => {
  assert.deepEqual(parseReferenceString('7, 0,1  2;0\n3'), [7, 0, 1, 2, 0, 3]);
  assert.deepEqual(parseReferenceString('  12 , 105 '), [12, 105]);
});

test('parseReferenceString rejects junk with a message that quotes it', () => {
  assert.throws(() => parseReferenceString(''), /Enter a reference string/);
  assert.throws(() => parseReferenceString('  , '), /Enter a reference string/);
  assert.throws(() => parseReferenceString('1, x, 3'), /"x"/);
  assert.throws(() => parseReferenceString('1, -2'), /"-2"/);
  assert.throws(() => parseReferenceString('1, 2.5'), /"2.5"/);
  assert.throws(() => parseReferenceString('99999999999999999999'), /not a page number/);
});

test('simulatePaging rejects bad input', () => {
  assert.throws(() => simulatePaging([], 3, 'fifo'), /at least one/);
  assert.throws(() => simulatePaging([1, 2], 0, 'fifo'), /Frames/);
  assert.throws(() => simulatePaging([1, 2], 2.5, 'fifo'), /Frames/);
  assert.throws(() => simulatePaging([1, 2], NaN, 'fifo'), /Frames/);
  assert.throws(() => simulatePaging([1, 2], 999, 'fifo'), /Frames/);
  assert.throws(() => simulatePaging([1, -2], 2, 'fifo'), /whole numbers/);
  assert.throws(() => simulatePaging([1, 2], 2, 'clock'), /Unknown algorithm/);
  assert.throws(() => simulatePaging(new Array(5000).fill(1), 2, 'fifo'), /too long/);
});

// ---------------------------------------------------------------- properties on random strings

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('invariants hold for every algorithm on 300 random strings', () => {
  const rand = rng(2024);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  for (let round = 0; round < 300; round++) {
    const refs = Array.from({ length: int(1, 40) }, () => int(0, 9));
    const frames = int(1, 6);
    const results = {};

    for (const id of Object.keys(PAGING_ALGORITHMS)) {
      const label = `round ${round}, ${id}, ${frames} frames, ${refs}`;
      const run = simulatePaging(refs, frames, id);
      results[id] = run;

      assert.equal(run.steps.length, refs.length, label);
      assert.equal(run.faults + run.hits, refs.length, label);
      assert.ok(run.faults >= run.distinctPages, `${label}: cannot beat one fault per distinct page`);

      let prev = new Array(frames).fill(null);
      run.steps.forEach((s, i) => {
        assert.equal(s.page, refs[i], label);
        assert.ok(s.frames.includes(s.page), `${label}: page ${s.page} must be resident after its reference`);
        assert.equal(s.frames[s.slot], s.page, label);
        const resident = s.frames.filter((p) => p !== null);
        assert.equal(new Set(resident).size, resident.length, `${label}: duplicate page in frames`);
        assert.equal(s.hit, prev.includes(s.page), `${label}: hit iff resident before`);
        // Only the touched slot may change.
        s.frames.forEach((p, f) => { if (f !== s.slot) assert.equal(p, prev[f], `${label}: slot ${f} changed`); });
        if (s.hit) assert.equal(s.evicted, null, label);
        if (s.evicted) assert.equal(s.evicted.page, prev[s.slot], label);
        prev = s.frames;
      });
    }

    assert.ok(results.opt.faults <= results.lru.faults, `round ${round}: Optimal must not lose to LRU`);
    assert.ok(results.opt.faults <= results.fifo.faults, `round ${round}: Optimal must not lose to FIFO`);
  }
});

test('LRU and Optimal are stack algorithms: more frames never means more faults', () => {
  const rand = rng(777);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  for (let round = 0; round < 200; round++) {
    const refs = Array.from({ length: int(5, 40) }, () => int(0, 8));
    for (const id of ['lru', 'opt']) {
      for (let f = 1; f < 7; f++) {
        assert.ok(faults(refs, f + 1, id) <= faults(refs, f, id), `${id}, ${f}→${f + 1} frames, ${refs}`);
      }
    }
  }
});
