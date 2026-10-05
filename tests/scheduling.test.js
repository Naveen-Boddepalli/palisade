import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, ALGORITHMS } from '../src/engine/scheduling.js';

/** [burst, arrival = 0, priority = 0] rows → process objects named P1, P2, … */
const procs = (rows) =>
  rows.map(([burst, arrival = 0, priority = 0], i) => ({ pid: `P${i + 1}`, arrival, burst, priority }));

const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

const blocks = (run) => run.gantt.map((g) => [g.pid, g.start, g.end]);
const byPid = (run, pid) => run.processes.find((p) => p.pid === pid);

// ---------------------------------------------------------------- golden results (Silberschatz)

test('FCFS: 24/3/3 → avg wait 17, avg turnaround 27', () => {
  const run = simulate(procs([[24], [3], [3]]), 'fcfs');
  assert.deepEqual(blocks(run), [['P1', 0, 24], ['P2', 24, 27], ['P3', 27, 30]]);
  near(run.metrics.avgWaiting, 17);
  near(run.metrics.avgTurnaround, 27);
  near(run.metrics.avgResponse, 17); // non-preemptive: response == waiting
});

test('SJF non-preemptive: 6/8/7/3 → avg wait 7', () => {
  const run = simulate(procs([[6], [8], [7], [3]]), 'sjf');
  assert.deepEqual(run.gantt.map((g) => g.pid), ['P4', 'P1', 'P3', 'P2']);
  near(run.metrics.avgWaiting, 7);
});

test('SJF non-preemptive with staggered arrivals → avg wait 7.75', () => {
  const run = simulate(procs([[8, 0], [4, 1], [9, 2], [5, 3]]), 'sjf');
  assert.deepEqual(blocks(run), [['P1', 0, 8], ['P2', 8, 12], ['P4', 12, 17], ['P3', 17, 26]]);
  near(run.metrics.avgWaiting, 7.75);
});

test('SRTF with the same arrivals → avg wait 6.5', () => {
  const run = simulate(procs([[8, 0], [4, 1], [9, 2], [5, 3]]), 'srtf');
  assert.deepEqual(blocks(run), [['P1', 0, 1], ['P2', 1, 5], ['P4', 5, 10], ['P1', 10, 17], ['P3', 17, 26]]);
  near(run.metrics.avgWaiting, 6.5);
  assert.equal(byPid(run, 'P1').response, 0);
});

test('Priority non-preemptive: 5 processes → avg wait 8.2', () => {
  const run = simulate(procs([[10, 0, 3], [1, 0, 1], [2, 0, 4], [1, 0, 5], [5, 0, 2]]), 'priority-np');
  assert.deepEqual(run.gantt.map((g) => g.pid), ['P2', 'P5', 'P1', 'P3', 'P4']);
  near(run.metrics.avgWaiting, 8.2);
});

test('Round Robin q=4: 24/3/3 → avg wait 17/3', () => {
  const run = simulate(procs([[24], [3], [3]]), 'rr', { quantum: 4 });
  assert.deepEqual(blocks(run), [['P1', 0, 4], ['P2', 4, 7], ['P3', 7, 10], ['P1', 10, 30]]);
  near(run.metrics.avgWaiting, 17 / 3);
  assert.deepEqual([byPid(run, 'P1').response, byPid(run, 'P2').response, byPid(run, 'P3').response], [0, 4, 7]);
  assert.equal(run.metrics.contextSwitches, 3);
});

// ---------------------------------------------------------------- the documented rules

test('preemptive priority: a higher-priority arrival takes the CPU', () => {
  const run = simulate(procs([[5, 0, 2], [2, 1, 1]]), 'priority-p');
  assert.deepEqual(blocks(run), [['P1', 0, 1], ['P2', 1, 3], ['P1', 3, 7]]);
});

test('SRTF does not preempt on a tie', () => {
  const run = simulate(procs([[4, 0], [3, 1]]), 'srtf'); // at t=1 both have 3 left
  assert.deepEqual(blocks(run), [['P1', 0, 4], ['P2', 4, 7]]);
});

test('ties go to earlier arrival, then input order', () => {
  const run = simulate(procs([[3, 0], [3, 0], [3, 0]]), 'sjf');
  assert.deepEqual(run.gantt.map((g) => g.pid), ['P1', 'P2', 'P3']);
});

test('Round Robin: an arrival at the instant a quantum expires queues before the preempted process', () => {
  const run = simulate(procs([[5, 0], [3, 4]]), 'rr', { quantum: 4 });
  assert.deepEqual(blocks(run), [['P1', 0, 4], ['P2', 4, 7], ['P1', 7, 8]]);
  assert.deepEqual(
    run.snapshots[4].events.map((e) => [e.type, e.pid]),
    [['arrive', 'P2'], ['preempt', 'P1'], ['dispatch', 'P2']],
  );
});

test('Round Robin: a lone process keeps the CPU when its quantum expires (one block, no events)', () => {
  const run = simulate(procs([[7]]), 'rr', { quantum: 2 });
  assert.deepEqual(blocks(run), [['P1', 0, 7]]);
  assert.deepEqual(run.snapshots[2].events, []);
  assert.equal(run.metrics.contextSwitches, 0);
});

test('idle CPU is shown on the Gantt and counted against utilization', () => {
  const run = simulate(procs([[3, 2]]), 'fcfs');
  assert.deepEqual(blocks(run), [[null, 0, 2], ['P1', 2, 5]]);
  near(run.metrics.cpuUtilization, 60);
  assert.equal(byPid(run, 'P1').response, 0);
});

// ---------------------------------------------------------------- snapshots

test('snapshots: one per tick plus the final state', () => {
  const run = simulate(procs([[4, 0], [2, 1]]), 'fcfs');
  assert.equal(run.snapshots.length, run.makespan + 1);
  assert.deepEqual(run.snapshots.map((s) => s.t), [0, 1, 2, 3, 4, 5, 6]);

  const s1 = run.snapshots[1];
  assert.equal(s1.running, 'P1');
  assert.deepEqual(s1.ready, ['P2']);
  assert.deepEqual(s1.remaining, { P1: 3, P2: 2 });
  assert.deepEqual(s1.events, [{ type: 'arrive', pid: 'P2' }]);

  const last = run.snapshots.at(-1);
  assert.equal(last.running, null);
  assert.deepEqual(last.remaining, { P1: 0, P2: 0 });
  assert.deepEqual(last.events, [{ type: 'complete', pid: 'P2' }]);
});

test('snapshot ready list is shown in the order the scheduler will pick', () => {
  const run = simulate(procs([[10, 0], [7, 1], [3, 1], [5, 1]]), 'sjf');
  assert.deepEqual(run.snapshots[1].ready, ['P3', 'P4', 'P2']);
});

// ---------------------------------------------------------------- validation

test('bad input is rejected with a message that names the process', () => {
  const ok = { pid: 'P1', arrival: 0, burst: 3 };
  assert.throws(() => simulate([], 'fcfs'), /at least one/);
  assert.throws(() => simulate([{ ...ok, burst: 0 }], 'fcfs'), /P1: burst/);
  assert.throws(() => simulate([{ ...ok, burst: 2.5 }], 'fcfs'), /P1: burst/);
  assert.throws(() => simulate([{ ...ok, burst: NaN }], 'fcfs'), /P1: burst/);
  assert.throws(() => simulate([{ ...ok, arrival: -1 }], 'fcfs'), /P1: arrival/);
  assert.throws(() => simulate([ok, { ...ok }], 'fcfs'), /Duplicate/);
  assert.throws(() => simulate([ok], 'nope'), /Unknown algorithm/);
  assert.throws(() => simulate([ok], 'rr', { quantum: 0 }), /quantum/);
  assert.throws(() => simulate([{ ...ok, burst: 10 ** 9 }], 'fcfs'), /too long/);
});

test('quantum is only validated for Round Robin', () => {
  assert.doesNotThrow(() => simulate(procs([[3]]), 'fcfs', { quantum: NaN }));
});

// ---------------------------------------------------------------- invariants on random workloads

function rng(seed) {
  // mulberry32: small deterministic PRNG so failures are reproducible
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('invariants hold for every algorithm on 200 random workloads', () => {
  const rand = rng(12345);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  for (let round = 0; round < 200; round++) {
    const rows = Array.from({ length: int(1, 8) }, () => [int(1, 12), int(0, 15), int(1, 5)]);
    for (const id of Object.keys(ALGORITHMS)) {
      const label = `round ${round}, ${id}, ${JSON.stringify(rows)}`;
      const run = simulate(procs(rows), id, { quantum: int(1, 5) });

      // The Gantt is one contiguous timeline from 0 to the makespan.
      assert.equal(run.gantt[0].start, 0, label);
      for (let i = 1; i < run.gantt.length; i++) assert.equal(run.gantt[i].start, run.gantt[i - 1].end, label);
      assert.equal(run.gantt.at(-1).end, run.makespan, label);
      assert.equal(run.snapshots.length, run.makespan + 1, label);

      for (const p of run.processes) {
        const ran = run.gantt.filter((g) => g.pid === p.pid).reduce((s, g) => s + g.end - g.start, 0);
        assert.equal(ran, p.burst, `${label}: ${p.pid} ran ${ran}, burst ${p.burst}`);
        assert.ok(p.firstStart >= p.arrival, `${label}: ${p.pid} ran before arriving`);
        assert.equal(p.turnaround, p.waiting + p.burst, label);
        assert.ok(p.waiting >= 0 && p.response >= 0 && p.response <= p.waiting, label);
        assert.ok(p.completion <= run.makespan, label);
      }
      assert.ok(run.metrics.cpuUtilization > 0 && run.metrics.cpuUtilization <= 100, label);
    }
  }
});

test('non-preemptive algorithms never split a process across two Gantt blocks', () => {
  const rand = rng(99);
  for (let round = 0; round < 100; round++) {
    const rows = Array.from({ length: 6 }, () => [1 + Math.floor(rand() * 9), Math.floor(rand() * 10), 1 + Math.floor(rand() * 4)]);
    for (const id of ['fcfs', 'sjf', 'priority-np']) {
      const seen = run_pids(simulate(procs(rows), id));
      assert.equal(new Set(seen).size, seen.length, `${id} ${JSON.stringify(rows)}`);
    }
  }
});

const run_pids = (run) => run.gantt.filter((g) => g.pid !== null).map((g) => g.pid);
