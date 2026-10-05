# CPU Scheduling & Memory Management Visualizer — Plan

Solo project for BCSE303P (Operating Systems Lab). Source of scope: the proposal in
`CPU_Scheduling_Memory_Management_Visualization-1.docx` (problem, solution, objectives).
Goal right now: **ship a working v1 as fast as possible**.

> `palisade-project-guide.html` in this folder is a different project idea (syscall sandbox).
> It is not part of this plan.

## Run it

```bash
npm start      # serves the folder on http://localhost:8000  (ES modules need http, not file://)
npm test       # engine tests, no dependencies (node --test)
```

## Decisions

- **Stack:** plain JS ES modules + SVG. No framework, no build step. Node 24 for tests.
- **Precompute, then play back.** The engine runs the whole simulation up front and returns
  an array of snapshots. The UI only plays them back (play / pause / step / scrub / speed).
  This gives the "live" animation, makes compare mode a matter of two runs on one clock,
  and keeps the engine free of UI code so it can be tested alone.
- **Unit-time ticks**, not a real event queue: simpler for preemption (SRTF, preemptive
  priority, Round Robin). The Gantt merges consecutive ticks into blocks.
- **Segmentation is out.** The problem statement mentions it; the objectives do not.

## Scope

**v1:** FCFS, SJF (non-preemptive), SRTF, Priority (non-preemptive + preemptive),
Round Robin · FIFO / LRU / Optimal page replacement · metrics for both · custom input and
random workloads · compare mode.

**v1.1:** internal/external fragmentation for fixed and variable partitions
(first / best / worst fit). Most independent piece, so safest to defer.

## Milestones

Hours are rough estimates of focused time.

| # | Build | Done when | Est. | Status |
|---|---|---|---|---|
| M0 | Scaffold: `index.html`, `src/engine/`, `src/ui/`, `tests/`, git | Page loads, `npm test` runs | 0.5h | [x] |
| M1 | Scheduling engine: 6 algorithms, snapshots, metrics (waiting, turnaround, response, CPU utilization) | Golden tests pass | 3h | [x] |
| M2 | Process table input, algorithm picker, animated Gantt, playback controls, metrics panel | Enter processes and watch a Gantt build | 4h | [x] |
| M3 | Paging engine: FIFO, LRU, Optimal + fault rate | Golden tests pass | 2.5h | [x] |
| M4 | Frame-table view with hit / fault / evict highlighting and playback | Reference string animates step by step | 3h | [x] |
| M5 | Compare mode: two algorithms, one input, one shared clock | Both modes work | 2.5h | [x] |
| M6 | Random workload generator, presets, polish, GitHub Pages deploy | Shareable link | 2h | [x] (workflow and README added; link goes live once the repo is pushed with Pages source = GitHub Actions) |
| M7 | *(v1.1)* Fragmentation: fixed / variable partitions, first / best / worst fit | Partition view + tests | 4h | [x] |

v1 = M0–M6 ≈ 18h (about 3 focused days).

## Layout

```
index.html
css/style.css
src/
  main.js
  presets.js                 example workloads
  engine/
    scheduling.js            simulate() for the 6 scheduling algorithms      (M1)
    metrics.js               schedulingMetrics()                             (M1)
    paging.js                simulatePaging(): FIFO / LRU / Optimal          (M3)
    compare.js               winners, deltas and verdicts for two runs       (M5)
    workload.js              seeded random generators                        (M6)
    fragmentation.js         simulateMemory(): fixed / variable partitions,
                             first / best / worst fit, compareMemoryRuns()   (M7)
  ui/
    dom.js                   tiny element helper
    widgets.js               fmt, num, statTile shared by the views
    controls.js              Player (rAF clock) + mountTransport (buttons, scrubber, speed)
    gantt.js                 SVG Gantt, built once per run, cheap update()   (M2)
    schedulingView.js        scheduling tab: one lane, or two in compare mode
    frames.js                frame table, built once per run                 (M4)
    memoryView.js            memory tab: one lane, or two in compare mode
    fragmentationView.js     fragmentation tab: memory map, one lane or two  (M7)
tests/
  scheduling.test.js
  paging.test.js
  player.test.js             playback clock: clamping, stepping, end-of-run
  compare.test.js            winners, deltas, verdict text, Belady detection
  workload.test.js           seeds reproduce, ranges respected, output accepted by engines
  fragmentation.test.js      textbook 100/500/200/300/600 example, merging, invariants
```

`main.js` switches tabs (`#scheduling` / `#memory` in the URL), and pauses the view you leave.

## Engine contract (scheduling)

`simulate(processes, algorithmId, { quantum })` →

```js
{
  algorithm, label, makespan,
  snapshots: [{ t, running, ready, remaining, events }],  // length = makespan + 1
  gantt:     [{ pid | null, start, end }],                // null = CPU idle
  processes: [{ pid, arrival, burst, priority, firstStart, completion,
                turnaround, waiting, response }],
  metrics:   { avgWaiting, avgTurnaround, avgResponse, cpuUtilization,
               throughput, contextSwitches, makespan },
}
```

`snapshots[t]` is the state at instant `t`, before tick `t` executes: `running` is who holds
the CPU during `[t, t+1)`, `remaining` is per-process time left, `events` are what happened
at that instant (`arrive`, `complete`, `preempt`, `dispatch`). The last snapshot is at
`t = makespan` and is the finished state.

## Engine contract (paging)

`simulatePaging(refs, frameCount, algorithmId)` →

```js
{
  algorithm, label, frames, refs,
  steps: [{ i, page, hit, slot, evicted, frames, faultsSoFar }],  // one per reference
  faults, hits, faultRate, hitRate, distinctPages,                // rates are fractions 0–1
}
```

`steps[i]` is the state *after* processing `refs[i]`. `frames` is the contents of every frame
(`null` = empty) and `slot` is the frame that was touched. `evicted` is `null` on a hit or when
a free frame was used; otherwise `{ page, loadedAt, lastUsed, nextUse | null }` (reference
indices, 0-based), which is what the "Now" panel uses to explain *why* that page was chosen.
Frame and reference numbers are 0-based in the engine and shown 1-based in the UI.
`parseReferenceString("7, 0 1")` turns user text into the `refs` array.

## Compare mode

Each tab has a "Compare" checkbox. The **workload is shared** (processes, or the reference
string); each **lane** has its own configuration: algorithm + quantum for scheduling, algorithm +
frame count for memory. That is what makes "FIFO with 3 vs 4 frames" (Belady's anomaly) and
"Round Robin q = 2 vs q = 6" possible. Both lanes run on **one Player clock**; a shorter run holds
at its final state while the longer one finishes. Presets with `compare: true` turn it on.

`compareSchedulingRuns(a, b)` / `comparePagingRuns(a, b)` return
`{ metrics: [{ key, label, a, b, delta, winner }], verdict, ... }`:

- `winner` is `0` (lane A), `1` (lane B) or `-1` (tie). `delta` is B − A.
- Lower is better, except CPU utilization, hits and hit rate. Fewer context switches count as better.
- Scheduling adds `perProcess` rows and a **longest wait** metric. The verdict names the trade-off
  when the average-wait winner has a worse worst case (the starvation effect of SJF).
- Paging adds `anomaly` (same policy, more frames, more faults) and `differs` (references where one
  lane hits and the other faults; the UI flags those with a corner mark).

## Engine contract (fragmentation)

`simulateMemory({ mode: 'fixed' | 'variable', partitions | size, ops, strategy })` →
`{ mode, strategy, label, total, initial, steps: [{ i, op, ok, reason, at, note, blocks, stats }], summary }`.
`ops` come from `parseOperations("P1 212, P2 417, free P1")`. `blocks` is the whole memory map as
`{ start, size, pid | null, used }`; `steps[i]` is the map after operation `i`.

- Strategies: first = lowest-address hole that fits; best = smallest that fits; worst = largest.
  Ties go to the lowest address.
- **Fixed:** a process takes a whole partition; `size − used` is internal fragmentation.
- **Variable:** a hole is split exactly (no internal fragmentation); freeing merges adjacent holes.
- A refused request has `reason: 'external'` when total free space would have been enough
  (no single hole is big enough), else `'full'`. Freeing an unknown process is a no-op (`'not-loaded'`).
- **External fragmentation** = free space − largest hole (free memory cut off from the largest hole).
- Golden test: partitions 100/500/200/300/600 with requests 212/417/112/426 →
  first fit refuses the last, best fit places all four, worst fit refuses the last.

## Rules (tests depend on these)

- **Ties:** earlier arrival wins, then input order (P1 before P2).
- **No preemption on ties:** SRTF / preemptive priority only switch for a *strictly* better process.
- **Priority:** lower number = higher priority.
- **Round Robin:** a process arriving at the same tick a quantum expires enters the queue
  *before* the preempted one. If the queue is empty the process simply keeps the CPU.
- **Idle:** CPU gaps show on the Gantt and count against utilization.
- **CPU utilization** = busy ticks ÷ elapsed ticks (t = 0 to last completion).
- **Context switches:** 0 cost in v1; the count is the number of times the CPU is handed to a
  process different from the previous one.
- **Response time:** first time on the CPU − arrival.
- **Optimal ties (M3):** if several pages are never used again, evict the one loaded first.

## Golden tests (from Silberschatz)

- FCFS, bursts 24 / 3 / 3, all at 0 → avg wait **17**
- SJF, bursts 6 / 8 / 7 / 3 → avg wait **7**
- SJF vs SRTF, P1 0/8, P2 1/4, P3 2/9, P4 3/5 → avg wait **7.75** (SJF) and **6.5** (SRTF)
- Priority (non-preemptive), 5 processes at 0 → avg wait **8.2**
- Round Robin, bursts 24 / 3 / 3, q = 4 → avg wait **5.66**
- Paging, `7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1`, 3 frames → FIFO **15**, LRU **12**, Optimal **9** faults
- Belady's anomaly, `1,2,3,4,1,2,5,1,2,3,4,5`, FIFO → **9** faults at 3 frames, **10** at 4

## After v1 (not planned in detail)

Report and demo for the course. The proposal only covers problem, solution and objectives,
so deliverables and deadline are unknown.
