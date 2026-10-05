import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/engine/scheduling.js';
import { simulatePaging } from '../src/engine/paging.js';
import { better, compareSchedulingRuns, comparePagingRuns } from '../src/engine/compare.js';

const procs = (rows) => rows.map(([arrival, burst, priority = 0], i) => ({ pid: `P${i + 1}`, arrival, burst, priority }));
const STAGGERED = procs([[0, 8], [1, 4], [2, 9], [3, 5]]);
const BELADY = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
const TEXTBOOK = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];

const metric = (cmp, key) => cmp.metrics.find((m) => m.key === key);

test('better(): lower wins by default, higher wins when asked, equal is a tie', () => {
  assert.equal(better(1, 2), 0);
  assert.equal(better(2, 1), 1);
  assert.equal(better(3, 3), -1);
  assert.equal(better(1, 2, { higherIsBetter: true }), 1);
  assert.equal(better(2, 1, { higherIsBetter: true }), 0);
  assert.equal(better(0.1 + 0.2, 0.3), -1, 'float noise is not a difference');
});

test('SRTF vs SJF on the staggered workload', () => {
  const cmp = compareSchedulingRuns(simulate(STAGGERED, 'srtf'), simulate(STAGGERED, 'sjf'));

  const wait = metric(cmp, 'avgWaiting');
  assert.equal(wait.a, 6.5);
  assert.equal(wait.b, 7.75);
  assert.equal(wait.winner, 0);
  assert.equal(wait.delta, 1.25); // B minus A

  assert.equal(metric(cmp, 'cpuUtilization').winner, -1); // both 100%
  assert.equal(metric(cmp, 'makespan').winner, -1);
  assert.equal(metric(cmp, 'maxWaiting').winner, -1); // P3 waits 15 under both

  const switches = metric(cmp, 'contextSwitches');
  assert.deepEqual([switches.a, switches.b, switches.winner], [4, 3, 1]); // preemption costs switches

  assert.equal(cmp.verdict, 'A has the lower average waiting time: 6.50 vs 7.75 (16% less).');
});

test('per-process rows line up and pick winners', () => {
  const cmp = compareSchedulingRuns(simulate(STAGGERED, 'srtf'), simulate(STAGGERED, 'sjf'));
  assert.deepEqual(cmp.perProcess.map((p) => p.pid), ['P1', 'P2', 'P3', 'P4']);
  // P1 waits 9 under SRTF (preempted) but 0 under SJF; P2 waits 0 vs 7.
  assert.deepEqual(cmp.perProcess[0].waiting, { a: 9, b: 0, winner: 1 });
  assert.deepEqual(cmp.perProcess[1].waiting, { a: 0, b: 7, winner: 0 });
});

test('verdict names the trade-off when the winner has a worse worst case', () => {
  // SJF lets three 1-tick jobs jump ahead of a 3-tick job: average wait falls, but that job waits longer.
  const work = procs([[0, 2], [1, 3], [2, 1], [3, 1], [4, 1]]);
  const cmp = compareSchedulingRuns(simulate(work, 'sjf'), simulate(work, 'fcfs'));

  const wait = metric(cmp, 'avgWaiting');
  assert.deepEqual([wait.a, wait.b, wait.winner], [0.8, 2, 0]);
  const longest = metric(cmp, 'maxWaiting');
  assert.deepEqual([longest.a, longest.b, longest.winner], [4, 3, 1]);
  assert.equal(
    cmp.verdict,
    'A has the lower average waiting time: 0.80 vs 2 (60% less). But its worst-off process waits longer (4 vs 3).',
  );
});

test('identical algorithms tie everywhere', () => {
  const cmp = compareSchedulingRuns(simulate(STAGGERED, 'srtf'), simulate(STAGGERED, 'srtf'));
  assert.ok(cmp.metrics.every((m) => m.winner === -1 && m.delta === 0));
  assert.equal(cmp.verdict, 'Both give the same average waiting time (6.50).');
});

test('the same algorithm with two quanta is comparable', () => {
  const work = procs([[0, 10], [0, 5], [0, 8]]);
  const cmp = compareSchedulingRuns(simulate(work, 'rr', { quantum: 2 }), simulate(work, 'rr', { quantum: 6 }));
  assert.equal(metric(cmp, 'avgResponse').winner, 0); // small quantum reaches everyone sooner
  assert.equal(metric(cmp, 'contextSwitches').winner, 1);
});

// ---------------------------------------------------------------- paging

test('FIFO vs LRU on the textbook string: 15 vs 12 faults', () => {
  const cmp = comparePagingRuns(simulatePaging(TEXTBOOK, 3, 'fifo'), simulatePaging(TEXTBOOK, 3, 'lru'));
  const faults = metric(cmp, 'faults');
  assert.deepEqual([faults.a, faults.b, faults.winner, faults.delta], [15, 12, 1, -3]);
  assert.equal(metric(cmp, 'hits').winner, 1);
  assert.equal(cmp.verdict, 'B has 3 fewer page faults: 12 vs 15.');
  assert.equal(cmp.anomaly, null);
});

test("Belady's anomaly is reported when more frames means more faults", () => {
  const cmp = comparePagingRuns(simulatePaging(BELADY, 3, 'fifo'), simulatePaging(BELADY, 4, 'fifo'));
  assert.equal(metric(cmp, 'faults').winner, 0);
  assert.match(cmp.anomaly, /Belady/);
  assert.match(cmp.anomaly, /4 frames.*10.*3 frames.*9/);

  // Same numbers with the lanes swapped still find it.
  const swapped = comparePagingRuns(simulatePaging(BELADY, 4, 'fifo'), simulatePaging(BELADY, 3, 'fifo'));
  assert.match(swapped.anomaly, /Belady/);
});

test('no anomaly for LRU with more frames, or for different policies', () => {
  assert.equal(comparePagingRuns(simulatePaging(BELADY, 3, 'lru'), simulatePaging(BELADY, 4, 'lru')).anomaly, null);
  assert.equal(comparePagingRuns(simulatePaging(BELADY, 3, 'fifo'), simulatePaging(BELADY, 4, 'lru')).anomaly, null);
});

test('differs marks exactly the references where hit/fault disagree', () => {
  const a = simulatePaging(TEXTBOOK, 3, 'fifo');
  const b = simulatePaging(TEXTBOOK, 3, 'lru');
  const cmp = comparePagingRuns(a, b);
  assert.equal(cmp.differs.length, TEXTBOOK.length);
  cmp.differs.forEach((d, i) => assert.equal(d, a.steps[i].hit !== b.steps[i].hit));
  assert.ok(cmp.differCount > 0);
  assert.equal(comparePagingRuns(a, a).differCount, 0);
});

test('a tie says so', () => {
  const run = simulatePaging(TEXTBOOK, 3, 'lru');
  const cmp = comparePagingRuns(run, run);
  assert.equal(cmp.verdict, 'Both have 12 page faults.');
  assert.ok(cmp.metrics.every((m) => m.winner === -1));
});
