import { schedulingMetrics } from './metrics.js';

/** Guard against a typo like burst = 99999999 freezing the browser tab. */
export const MAX_TICKS = 100_000;

/**
 * `value(p)` is the primary sort key: the process with the smallest value runs next.
 * Ties go to earlier arrival, then input order. Round Robin ignores it and uses a FIFO queue.
 */
export const ALGORITHMS = {
  fcfs: {
    id: 'fcfs',
    label: 'FCFS',
    preemptive: false,
    value: (p) => p.arrival,
    hint: 'Runs processes in arrival order. Simple, but short jobs get stuck behind a long one (the convoy effect).',
  },
  sjf: {
    id: 'sjf',
    label: 'SJF (non-preemptive)',
    preemptive: false,
    value: (p) => p.burst,
    hint: 'Picks the shortest burst next and never interrupts a running process. Long jobs can starve.',
  },
  srtf: {
    id: 'srtf',
    label: 'SRTF (preemptive SJF)',
    preemptive: true,
    value: (p) => p.remaining,
    hint: 'Whenever a job arrives with less time remaining than the running one, it takes the CPU.',
  },
  'priority-np': {
    id: 'priority-np',
    label: 'Priority (non-preemptive)',
    preemptive: false,
    usesPriority: true,
    value: (p) => p.priority,
    hint: 'Lowest priority number runs first (1 = highest). A running process is never interrupted.',
  },
  'priority-p': {
    id: 'priority-p',
    label: 'Priority (preemptive)',
    preemptive: true,
    usesPriority: true,
    value: (p) => p.priority,
    hint: 'Lowest priority number runs first. A newly arrived higher-priority process preempts the running one.',
  },
  rr: {
    id: 'rr',
    label: 'Round Robin',
    kind: 'rr',
    preemptive: true,
    usesQuantum: true,
    hint: 'Each process runs for at most one time quantum, then goes to the back of the queue.',
  },
};

function normalize(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Add at least one process.');
  const seen = new Set();
  return input.map((raw, idx) => {
    const pid = String(raw.pid ?? '').trim();
    if (!pid) throw new Error(`Process ${idx + 1} needs a name.`);
    if (seen.has(pid)) throw new Error(`Duplicate process name "${pid}".`);
    seen.add(pid);

    const { arrival, burst } = raw;
    const priority = raw.priority ?? 0;
    if (!Number.isInteger(arrival) || arrival < 0) throw new Error(`${pid}: arrival must be a whole number ≥ 0.`);
    if (!Number.isInteger(burst) || burst < 1) throw new Error(`${pid}: burst must be a whole number ≥ 1.`);
    if (!Number.isInteger(priority)) throw new Error(`${pid}: priority must be a whole number.`);

    return { pid, idx, arrival, burst, priority, remaining: burst, firstStart: null, completion: null };
  });
}

/** Merge per-tick pids into [{ pid | null, start, end }] blocks. */
function toGantt(ticks) {
  const gantt = [];
  ticks.forEach((pid, t) => {
    const last = gantt[gantt.length - 1];
    if (last && last.pid === pid) last.end = t + 1;
    else gantt.push({ pid, start: t, end: t + 1 });
  });
  return gantt;
}

/**
 * Run one scheduling algorithm over a workload and return everything the UI needs.
 *
 * @param {{pid:string, arrival:number, burst:number, priority?:number}[]} input
 * @param {keyof typeof ALGORITHMS} algorithmId
 * @param {{quantum?:number}} [options]
 */
export function simulate(input, algorithmId, { quantum = 4 } = {}) {
  const algo = ALGORITHMS[algorithmId];
  if (!algo) throw new Error(`Unknown algorithm "${algorithmId}".`);
  const isRR = algo.kind === 'rr';
  if (isRR && !(Number.isInteger(quantum) && quantum >= 1)) {
    throw new Error('Time quantum must be a whole number ≥ 1.');
  }

  const procs = normalize(input);
  const n = procs.length;
  const horizon = Math.max(...procs.map((p) => p.arrival)) + procs.reduce((sum, p) => sum + p.burst, 0);
  if (horizon > MAX_TICKS) throw new Error(`Workload is too long (${horizon} ticks; the limit is ${MAX_TICKS}).`);

  const byKey = (a, b) => algo.value(a) - algo.value(b) || a.arrival - b.arrival || a.idx - b.idx;
  const byArrival = [...procs].sort((a, b) => a.arrival - b.arrival || a.idx - b.idx);
  const displayOrder = (list) => (isRR ? [...list] : [...list].sort(byKey));
  const takeBest = (list) => list.splice(list.indexOf(displayOrder(list)[0]), 1)[0];

  const ready = [];
  const snapshots = [];
  const ticks = [];
  let next = 0; // next process in byArrival to admit
  let done = 0;
  let t = 0;
  let current = null; // unfinished process holding the CPU
  let used = 0; // ticks the current process has run in its quantum (RR)
  let prev = null; // process that ran during tick t-1
  let prevDone = false;

  while (done < n) {
    if (t > horizon) throw new Error('Internal error: simulation did not terminate.');
    const events = [];

    if (prev && prevDone) events.push({ type: 'complete', pid: prev.pid });

    while (next < n && byArrival[next].arrival <= t) {
      const p = byArrival[next++];
      ready.push(p);
      events.push({ type: 'arrive', pid: p.pid });
    }

    if (current) {
      if (isRR && used >= quantum) {
        // Pushed after this instant's arrivals, so a simultaneous arrival queues first.
        ready.push(current);
        current = null;
      } else if (!isRR && algo.preemptive && ready.length) {
        const best = displayOrder(ready)[0];
        // Strictly better only: a tie never preempts.
        if (algo.value(best) < algo.value(current)) {
          ready.push(current);
          current = null;
        }
      }
    }

    if (!current && ready.length) {
      current = isRR ? ready.shift() : takeBest(ready);
      used = 0;
    }

    if (prev && !prevDone && current !== prev) {
      events.push({ type: 'preempt', pid: prev.pid, reason: isRR ? 'quantum' : 'policy' });
    }
    if (current && current !== prev) events.push({ type: 'dispatch', pid: current.pid });

    snapshots.push({
      t,
      running: current ? current.pid : null,
      ready: displayOrder(ready).map((p) => p.pid),
      remaining: Object.fromEntries(procs.map((p) => [p.pid, p.remaining])),
      events,
    });

    if (current) {
      if (current.firstStart === null) current.firstStart = t;
      current.remaining--;
      used++;
      ticks.push(current.pid);
      prev = current;
      prevDone = current.remaining === 0;
      if (prevDone) {
        current.completion = t + 1;
        done++;
        current = null;
      }
    } else {
      ticks.push(null);
      prev = null;
      prevDone = false;
    }
    t++;
  }

  // Final state at t = makespan: everything finished.
  snapshots.push({
    t,
    running: null,
    ready: [],
    remaining: Object.fromEntries(procs.map((p) => [p.pid, 0])),
    events: prev && prevDone ? [{ type: 'complete', pid: prev.pid }] : [],
  });

  const gantt = toGantt(ticks);
  const processes = procs.map((p) => ({
    pid: p.pid,
    arrival: p.arrival,
    burst: p.burst,
    priority: p.priority,
    firstStart: p.firstStart,
    completion: p.completion,
    turnaround: p.completion - p.arrival,
    waiting: p.completion - p.arrival - p.burst,
    response: p.firstStart - p.arrival,
  }));

  return {
    algorithm: algo.id,
    label: algo.label,
    quantum: isRR ? quantum : null,
    makespan: t,
    snapshots,
    gantt,
    processes,
    metrics: schedulingMetrics(processes, gantt, t),
  };
}
