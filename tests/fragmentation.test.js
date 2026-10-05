import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateMemory, parseOperations, parsePartitions, formatOperations, compareMemoryRuns, STRATEGIES,
} from '../src/engine/fragmentation.js';
import { randomMemoryWorkload } from '../src/engine/workload.js';

// Silberschatz / Tanenbaum worked example: partitions 100, 500, 200, 300, 600 KB; requests 212, 417, 112, 426.
const PARTITIONS = [100, 500, 200, 300, 600];
const REQUESTS = parseOperations('P1 212, P2 417, P3 112, P4 426');
const fixed = (strategy, ops = REQUESTS) => simulateMemory({ mode: 'fixed', partitions: PARTITIONS, ops, strategy });
const placedIn = (run) => run.steps.map((s) => (s.ok ? run.steps[s.i].blocks.find((b) => b.start === s.at).size : null));

// ---------------------------------------------------------------- golden results

test('fixed partitions, first fit: 212→500, 417→600, 112→200, 426 refused', () => {
  const run = fixed('first');
  assert.deepEqual(placedIn(run), [500, 600, 200, null]);
  assert.equal(run.summary.refused, 1);
});

test('fixed partitions, best fit: 212→300, 417→500, 112→200, 426→600, nothing refused', () => {
  const run = fixed('best');
  assert.deepEqual(placedIn(run), [300, 500, 200, 600]);
  assert.equal(run.summary.refused, 0);
});

test('fixed partitions, worst fit: 212→600, 417→500, 112→300, 426 refused', () => {
  const run = fixed('worst');
  assert.deepEqual(placedIn(run), [600, 500, 300, null]);
  assert.equal(run.summary.refused, 1);
});

test('internal fragmentation is partition size minus process size', () => {
  const run = fixed('best'); // wastes 88 + 83 + 88 + 174
  assert.equal(run.summary.internal, 88 + 83 + 88 + 174);
  assert.equal(run.summary.allocated, 212 + 417 + 112 + 426);
});

test('variable partitions: a freed hole leaves 417 refused despite 688 KB being free', () => {
  // Memory 1800: A 100, B 500, C 200, D 300, E 600 fill 1700 KB. Free B and D, then ask for 212 and 417.
  const ops = parseOperations('A 100, B 500, C 200, D 300, E 600, free B, free D, X 212, Y 417');
  const run = simulateMemory({ mode: 'variable', size: 1800, ops, strategy: 'first' });
  const x = run.steps[7];
  assert.equal(x.ok, true);
  assert.equal(x.at, 100); // the 500 KB hole left by B
  const y = run.steps[8];
  assert.equal(y.ok, false);
  assert.equal(y.reason, 'external');
  assert.equal(y.stats.freeTotal, 288 + 300 + 100);
  assert.equal(run.summary.refusedExternal, 1);
});

test('variable partitions: strategies choose different holes', () => {
  // Holes of 500 (at 100), 300 (at 800), 100 (at 1700) after freeing B and D.
  const base = 'A 100, B 500, C 200, D 300, E 600, free B, free D, X 90';
  const at = (strategy) => simulateMemory({ mode: 'variable', size: 1800, ops: parseOperations(base), strategy }).steps.at(-1).at;
  assert.equal(at('first'), 100);
  assert.equal(at('best'), 1700); // the 100 KB hole is the tightest
  assert.equal(at('worst'), 100); // the 500 KB hole is the largest
});

test('variable partitions: freeing merges neighbouring holes', () => {
  const ops = parseOperations('A 100, B 100, C 100, free A, free C, free B');
  const run = simulateMemory({ mode: 'variable', size: 400, ops, strategy: 'first' });
  assert.deepEqual(run.steps.at(-1).blocks, [{ start: 0, size: 400, pid: null, used: 0 }]);
  assert.equal(run.summary.external, 0);
  // After freeing A and C only, B still separates two holes: A's, and C's merged with the 100 KB tail.
  assert.equal(run.steps[4].stats.holes, 2);
  assert.deepEqual(run.steps[4].blocks.map((b) => b.size), [100, 100, 200]);
});

test('variable partitions have no internal fragmentation', () => {
  const run = simulateMemory({ mode: 'variable', size: 1000, ops: parseOperations('A 300, B 250, C 100'), strategy: 'best' });
  assert.equal(run.summary.internal, 0);
});

test('an exact fit uses the whole hole and leaves no zero-size block', () => {
  const run = simulateMemory({ mode: 'variable', size: 100, ops: parseOperations('A 100'), strategy: 'first' });
  assert.deepEqual(run.steps[0].blocks, [{ start: 0, size: 100, pid: 'A', used: 100 }]);
});

test('requests larger than all free memory are refused as "full", not as fragmentation', () => {
  const run = simulateMemory({ mode: 'variable', size: 100, ops: parseOperations('A 80, B 50'), strategy: 'first' });
  assert.equal(run.steps[1].reason, 'full');
  assert.equal(run.summary.refusedExternal, 0);
});

test('freeing a process that is not in memory is a harmless no-op', () => {
  const run = simulateMemory({ mode: 'variable', size: 100, ops: parseOperations('free Z'), strategy: 'first' });
  assert.equal(run.steps[0].ok, false);
  assert.equal(run.steps[0].reason, 'not-loaded');
});

test('a freed partition can be reused in fixed mode', () => {
  const ops = parseOperations('A 90, free A, B 80');
  const run = simulateMemory({ mode: 'fixed', partitions: [100], ops, strategy: 'first' });
  assert.equal(run.steps[2].ok, true);
  assert.equal(run.summary.internal, 20);
});

// ---------------------------------------------------------------- parsing and validation

test('parseOperations accepts commas, semicolons, new lines, "name:size" and "-name"', () => {
  assert.deepEqual(parseOperations('P1 212; P2:417\nfree P1, -P2'), [
    { type: 'alloc', pid: 'P1', size: 212 },
    { type: 'alloc', pid: 'P2', size: 417 },
    { type: 'free', pid: 'P1' },
    { type: 'free', pid: 'P2' },
  ]);
});

test('formatOperations round-trips through parseOperations', () => {
  const ops = parseOperations('P1 212, free P1, P2 40');
  assert.deepEqual(parseOperations(formatOperations(ops)), ops);
});

test('bad text names the offending entry', () => {
  assert.throws(() => parseOperations('P1 212, banana'), /"banana"/);
  assert.throws(() => parseOperations('P1 0'), /at least 1 KB/);
  assert.throws(() => parseOperations(''), /at least one/);
  assert.throws(() => parsePartitions('100, x'), /"x"/);
  assert.throws(() => parsePartitions('100, 0'), /"0"/);
});

test('invalid configurations are rejected with a message', () => {
  const ops = parseOperations('A 10');
  assert.throws(() => simulateMemory({ mode: 'variable', size: 0, ops, strategy: 'first' }), /Memory size/);
  assert.throws(() => simulateMemory({ mode: 'fixed', partitions: [], ops, strategy: 'first' }), /partition/);
  assert.throws(() => simulateMemory({ mode: 'variable', size: 100, ops, strategy: 'next' }), /strategy/);
  assert.throws(() => simulateMemory({ mode: 'paged', size: 100, ops, strategy: 'first' }), /scheme/);
  assert.throws(() => simulateMemory({ mode: 'variable', size: 100, ops: parseOperations('A 10, A 20'), strategy: 'first' }), /twice/);
});

// ---------------------------------------------------------------- invariants on random workloads

test('invariants hold for every mode and strategy on 200 random workloads', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { size, partitions, ops } = randomMemoryWorkload({ seed });
    for (const mode of ['fixed', 'variable']) {
      for (const strategy of Object.keys(STRATEGIES)) {
        const run = simulateMemory({ mode, size, partitions, ops, strategy });
        for (const step of run.steps) {
          const total = step.blocks.reduce((s, b) => s + b.size, 0);
          assert.equal(total, run.total, `blocks always add up to memory size (seed ${seed})`);
          let at = 0;
          for (const b of step.blocks) {
            assert.equal(b.start, at, 'blocks are contiguous');
            assert.ok(b.size > 0 && b.used <= b.size);
            at += b.size;
          }
          if (mode === 'variable') {
            assert.equal(step.stats.internal, 0);
            step.blocks.forEach((b, i) => {
              if (i > 0) assert.ok(b.pid !== null || step.blocks[i - 1].pid !== null, 'no two adjacent holes');
            });
          }
          assert.ok(step.stats.external >= 0 && step.stats.external <= step.stats.freeTotal);
        }
        const s = run.summary;
        assert.equal(s.placed + s.refused, ops.filter((o) => o.type === 'alloc').length);
        assert.ok(s.refusedExternal <= s.refused);
      }
    }
  }
});

// ---------------------------------------------------------------- compare

test('compareMemoryRuns: best fit beats first fit on the textbook example', () => {
  const cmp = compareMemoryRuns(fixed('first'), fixed('best'));
  const refused = cmp.metrics.find((m) => m.key === 'refused');
  assert.equal(refused.winner, 1);
  assert.equal(refused.delta, -1);
  assert.match(cmp.verdict, /^B places more requests/);
});

test('compareMemoryRuns: identical runs tie', () => {
  const cmp = compareMemoryRuns(fixed('best'), fixed('best'));
  assert.ok(cmp.metrics.every((m) => m.winner === -1));
  assert.equal(cmp.verdict, 'Both place every request.');
});
