import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randomProcesses, randomReferenceString, randomMemoryWorkload } from '../src/engine/workload.js';
import { simulate, ALGORITHMS } from '../src/engine/scheduling.js';
import { simulatePaging } from '../src/engine/paging.js';

test('the same seed always gives the same workload', () => {
  assert.deepEqual(randomProcesses({ seed: 42 }), randomProcesses({ seed: 42 }));
  assert.deepEqual(randomReferenceString({ seed: 42 }), randomReferenceString({ seed: 42 }));
  assert.deepEqual(randomMemoryWorkload({ seed: 42 }), randomMemoryWorkload({ seed: 42 }));
});

test('different seeds give different workloads', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(randomProcesses({ seed })));
  assert.ok(seen.size > 15);
});

test('rng stays in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 10_000; i++) {
    const x = rng();
    assert.ok(x >= 0 && x < 1);
  }
});

test('processes respect the requested ranges and start at time 0', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rows = randomProcesses({ seed, count: 6, maxArrival: 9, maxBurst: 7, maxPriority: 4 });
    assert.equal(rows.length, 6);
    assert.equal(Math.min(...rows.map((r) => r[0])), 0);
    for (const [arrival, burst, priority] of rows) {
      assert.ok(arrival >= 0 && arrival <= 9);
      assert.ok(burst >= 1 && burst <= 7);
      assert.ok(priority >= 1 && priority <= 4);
    }
  }
});

test('random processes are always accepted by every scheduling algorithm', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const input = randomProcesses({ seed }).map(([arrival, burst, priority], i) => ({ pid: `P${i + 1}`, arrival, burst, priority }));
    for (const id of Object.keys(ALGORITHMS)) assert.doesNotThrow(() => simulate(input, id, { quantum: 3 }));
  }
});

test('reference strings stay inside the page range and are accepted by the paging engine', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const refs = randomReferenceString({ seed, length: 25, pages: 6, locality: (seed % 5) / 4 });
    assert.equal(refs.length, 25);
    assert.ok(refs.every((p) => Number.isInteger(p) && p >= 0 && p < 6));
    assert.doesNotThrow(() => simulatePaging(refs, 3, 'lru'));
  }
});

test('high locality repeats pages more than none', () => {
  const distinct = (locality) => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) total += new Set(randomReferenceString({ seed, length: 20, pages: 10, locality })).size;
    return total;
  };
  assert.ok(distinct(1) < distinct(0));
});

test('out-of-range options are clamped instead of throwing', () => {
  assert.equal(randomProcesses({ seed: 1, count: 999 }).length, 12);
  assert.equal(randomReferenceString({ seed: 1, length: 0, pages: 0 }).length, 1);
});

test('memory workloads have positive sizes, unique process names and a sensible memory size', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { size, partitions, ops } = randomMemoryWorkload({ seed });
    assert.ok(partitions.length >= 4 && partitions.every((p) => p >= 1));
    assert.ok(size >= 1);
    const allocs = ops.filter((o) => o.type === 'alloc');
    assert.equal(new Set(allocs.map((o) => o.pid)).size, allocs.length);
    assert.ok(allocs.every((o) => o.size >= 1));
  }
});
