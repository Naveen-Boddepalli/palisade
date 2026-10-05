# OS Visualizer

Interactive CPU scheduling, page replacement and memory fragmentation simulator for
BCSE303P (Operating Systems Lab). Plain JavaScript modules and SVG, no framework, no build step.

## Run it

```bash
npm start      # http://localhost:8000  (ES modules need http, not file://)
npm test       # 79 engine tests, no dependencies (node --test)
```

## What it does

| Tab | Algorithms | Shows |
|---|---|---|
| **CPU scheduling** | FCFS, SJF, SRTF, Priority (non-preemptive and preemptive), Round Robin | Animated Gantt chart, ready queue, per-process table; average waiting / turnaround / response time, CPU utilization, throughput, context switches |
| **Paging** | FIFO, LRU, Optimal | Frame table with hit / fault / eviction marks and a plain-language reason for every victim; fault and hit rate |
| **Fragmentation** | First, best and worst fit on fixed and variable partitions | Memory map that updates request by request; internal and external fragmentation, refused requests, largest free hole |

Every tab has:

- **Playback**: play, pause, step, scrub, speed, and Space / arrow keys.
- **Compare**: tick *Compare* to run two algorithms (or two frame counts, or two placement strategies) on the same workload, on one clock, with a metrics table and a verdict.
- **Random workload**: a seed is shown next to the button; type it back in to reproduce the same workload.
- **Examples**: presets for the classic textbook cases.

Tabs are addressable: `#scheduling`, `#memory`, `#fragmentation`.

## Demo script (about 5 minutes)

1. **Convoy effect.** CPU scheduling → *FCFS: convoy effect*. Play it; the two 3-unit jobs wait behind a 24-unit job (average wait 17).
2. **Preemption.** *SRTF: preemption*, then *Compare: SRTF vs SJF*. Step through t = 1 where P2 takes the CPU; the comparison shows 6.50 against 7.75 average wait.
3. **Starvation trade-off.** *Compare: SJF vs FCFS (worst case)*: the verdict calls out when the lower average wait comes with a longer worst-case wait.
4. **Round Robin.** *Compare: Round Robin q = 2 vs q = 6* to show response time against waiting time and context switches.
5. **Belady's anomaly.** Paging → *Compare: FIFO with 3 vs 4 frames*: 9 faults become 10. Scrub to the references flagged with a corner mark. LRU does not do this.
6. **Optimal as the lower bound.** *Compare: LRU vs Optimal* on the cyclic scan.
7. **Internal fragmentation.** Fragmentation → *Compare: first vs best fit (fixed)*: first fit refuses P4, best fit places all four and shows the wasted space inside each partition.
8. **External fragmentation.** *Variable: external fragmentation*: after B and D leave, 688 KB is free but request Y (417 KB) is refused because no single hole is big enough.
9. **Random workload.** Press *Random workload* on any tab, then compare two algorithms on it live.

## How it is built

- **Precompute, then play back.** Each engine runs the whole simulation and returns snapshots / steps; the views only render them. The engine has no browser code and is tested alone in Node.
- **One clock.** A single `Player` drives every view and both lanes of compare mode.
- Details and the exact rules (tie-breaking, Round Robin queue order, Optimal ties, fragmentation placement) are in [PLAN.md](PLAN.md).

```
src/engine/   scheduling.js  metrics.js  paging.js  fragmentation.js  compare.js  workload.js
src/ui/       one view per tab, plus Gantt, frame table, playback controls
src/presets.js  src/main.js
tests/        textbook golden results + randomised invariants
```

## Deploy

`.github/workflows/pages.yml` runs the tests and publishes `index.html`, `css/` and `src/` to GitHub Pages
on every push to `main`. In the repository settings choose **Pages → Source: GitHub Actions** once.
