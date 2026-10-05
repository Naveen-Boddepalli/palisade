import { formatNumber as f } from './metrics.js';

const EPS = 1e-9;

/** Which of two values wins: 0 = the first, 1 = the second, -1 = a tie. */
export function better(a, b, { higherIsBetter = false } = {}) {
  if (Math.abs(a - b) < EPS) return -1;
  return a < b !== higherIsBetter ? 0 : 1;
}

export const describeSchedulingRun = (run) => (run.quantum ? `${run.label}, q = ${run.quantum}` : run.label);
export const describePagingRun = (run) => `${run.label}, ${run.frames} ${run.frames === 1 ? 'frame' : 'frames'}`;

const row = (key, label, a, b, higherIsBetter) => ({
  key,
  label,
  a,
  b,
  delta: Math.abs(b - a) < EPS ? 0 : b - a, // B minus A
  winner: better(a, b, { higherIsBetter }),
});

/**
 * Two scheduling runs of the same workload, side by side.
 * `winner` is 0 for run A, 1 for run B, -1 for a tie. Fewer context switches count as better.
 * Verdicts name runs by lane letter; the UI's table headers say which algorithm is which.
 */
export function compareSchedulingRuns(a, b) {
  const longestWait = (run) => Math.max(...run.processes.map((p) => p.waiting));
  const metrics = [
    row('avgWaiting', 'Avg waiting time', a.metrics.avgWaiting, b.metrics.avgWaiting),
    row('avgTurnaround', 'Avg turnaround time', a.metrics.avgTurnaround, b.metrics.avgTurnaround),
    row('avgResponse', 'Avg response time', a.metrics.avgResponse, b.metrics.avgResponse),
    row('maxWaiting', 'Longest wait', longestWait(a), longestWait(b)),
    row('cpuUtilization', 'CPU utilization', a.metrics.cpuUtilization, b.metrics.cpuUtilization, true),
    row('contextSwitches', 'Context switches', a.metrics.contextSwitches, b.metrics.contextSwitches),
    row('makespan', 'Total time', a.metrics.makespan, b.metrics.makespan),
  ];

  const perProcess = a.processes.map((p, i) => {
    const q = b.processes[i];
    const pair = (key) => ({ a: p[key], b: q[key], winner: better(p[key], q[key]) });
    return { pid: p.pid, waiting: pair('waiting'), turnaround: pair('turnaround'), response: pair('response') };
  });

  return { metrics, perProcess, verdict: schedulingVerdict(a, b, metrics) };
}

function schedulingVerdict(a, b, metrics) {
  const wait = metrics.find((m) => m.key === 'avgWaiting');
  if (wait.winner === -1) return `Both give the same average waiting time (${f(wait.a)}).`;

  const win = wait.winner;
  const [wv, lv] = win === 0 ? [wait.a, wait.b] : [wait.b, wait.a];
  const percent = Math.round((1 - wv / lv) * 100);
  let text = `${'AB'[win]} has the lower average waiting time: ${f(wv)} vs ${f(lv)}${percent ? ` (${percent}% less)` : ''}.`;

  const longest = metrics.find((m) => m.key === 'maxWaiting');
  if (longest.winner !== -1 && longest.winner !== win) {
    const [w, l] = win === 0 ? [longest.a, longest.b] : [longest.b, longest.a];
    text += ` But its worst-off process waits longer (${f(w)} vs ${f(l)}).`;
  }
  return text;
}

/** Two paging runs over the same reference string. */
export function comparePagingRuns(a, b) {
  const metrics = [
    row('faults', 'Page faults', a.faults, b.faults),
    row('hits', 'Hits', a.hits, b.hits, true),
    row('faultRate', 'Fault rate', a.faultRate, b.faultRate),
    row('hitRate', 'Hit rate', a.hitRate, b.hitRate, true),
  ];

  const faults = metrics[0];
  let verdict;
  if (faults.winner === -1) {
    verdict = `Both have ${faults.a} page faults.`;
  } else {
    const [wv, lv] = faults.winner === 0 ? [faults.a, faults.b] : [faults.b, faults.a];
    const fewer = lv - wv;
    verdict = `${'AB'[faults.winner]} has ${fewer} fewer page fault${fewer === 1 ? '' : 's'}: ${wv} vs ${lv}.`;
  }

  // Same policy, more frames, yet more faults.
  let anomaly = null;
  if (a.algorithm === b.algorithm && a.frames !== b.frames) {
    const [small, large] = a.frames < b.frames ? [a, b] : [b, a];
    if (large.faults > small.faults) {
      anomaly = `Belady's anomaly: ${describePagingRun(large)} faults more (${large.faults}) than ${describePagingRun(small)} (${small.faults}), even though it has more frames.`;
    }
  }

  // Which references the two policies handle differently (one hit, one fault).
  const differs = a.steps.map((step, i) => step.hit !== b.steps[i].hit);

  return { metrics, verdict, anomaly, differs, differCount: differs.filter(Boolean).length };
}
