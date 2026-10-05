/** 7 → "7", 5.6667 → "5.67". */
export const formatNumber = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Summary numbers for one scheduling run.
 * `processes` carry turnaround / waiting / response; `gantt` is the merged timeline.
 */
export function schedulingMetrics(processes, gantt, makespan) {
  const busy = gantt.reduce((sum, seg) => (seg.pid === null ? sum : sum + seg.end - seg.start), 0);

  // A context switch is the CPU being handed to a process other than the last one that ran.
  let contextSwitches = 0;
  let last = null;
  for (const seg of gantt) {
    if (seg.pid === null) continue;
    if (last !== null && seg.pid !== last) contextSwitches++;
    last = seg.pid;
  }

  return {
    avgWaiting: mean(processes.map((p) => p.waiting)),
    avgTurnaround: mean(processes.map((p) => p.turnaround)),
    avgResponse: mean(processes.map((p) => p.response)),
    cpuUtilization: makespan > 0 ? (busy / makespan) * 100 : 0,
    throughput: makespan > 0 ? processes.length / makespan : 0,
    contextSwitches,
    makespan,
  };
}
