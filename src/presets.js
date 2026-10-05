/**
 * Example workloads. Rows are [arrival, burst, priority]; process names are assigned P1, P2, …
 * A preset with `compare: true` switches compare mode on and configures lane B from `versus`.
 */
export const PRESETS = [
  {
    id: 'convoy',
    label: 'FCFS: convoy effect',
    algorithm: 'fcfs',
    rows: [[0, 24, 1], [0, 3, 1], [0, 3, 1]],
  },
  {
    id: 'srtf',
    label: 'SRTF: preemption',
    algorithm: 'srtf',
    rows: [[0, 8, 1], [1, 4, 1], [2, 9, 1], [3, 5, 1]],
  },
  {
    id: 'sjf',
    label: 'SJF: shortest first',
    algorithm: 'sjf',
    rows: [[0, 6, 1], [0, 8, 1], [0, 7, 1], [0, 3, 1]],
  },
  {
    id: 'priority',
    label: 'Priority: five jobs',
    algorithm: 'priority-np',
    rows: [[0, 10, 3], [0, 1, 1], [0, 2, 4], [0, 1, 5], [0, 5, 2]],
  },
  {
    id: 'rr',
    label: 'Round Robin: q = 4',
    algorithm: 'rr',
    quantum: 4,
    rows: [[0, 24, 1], [0, 3, 1], [0, 3, 1]],
  },
  {
    id: 'idle',
    label: 'Idle gap: late arrivals',
    algorithm: 'fcfs',
    rows: [[2, 3, 1], [4, 2, 1], [12, 4, 1]],
  },
  {
    id: 'cmp-srtf-sjf',
    label: 'Compare: SRTF vs SJF',
    algorithm: 'srtf',
    compare: true,
    versus: { algorithm: 'sjf' },
    rows: [[0, 8, 1], [1, 4, 1], [2, 9, 1], [3, 5, 1]],
  },
  {
    id: 'cmp-sjf-fcfs',
    label: 'Compare: SJF vs FCFS (worst case)',
    algorithm: 'sjf',
    compare: true,
    versus: { algorithm: 'fcfs' },
    rows: [[0, 2, 1], [1, 3, 1], [2, 1, 1], [3, 1, 1], [4, 1, 1]],
  },
  {
    id: 'cmp-rr-quantum',
    label: 'Compare: Round Robin q = 2 vs q = 6',
    algorithm: 'rr',
    quantum: 2,
    compare: true,
    versus: { algorithm: 'rr', quantum: 6 },
    rows: [[0, 10, 1], [0, 5, 1], [0, 8, 1]],
  },
];

export const DEFAULT_PRESET = 'srtf';

/** Page-replacement examples: a reference string, a frame count and a starting algorithm. */
export const MEMORY_PRESETS = [
  {
    id: 'textbook',
    label: 'Textbook string, 3 frames',
    algorithm: 'fifo',
    frames: 3,
    refs: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1],
  },
  {
    id: 'belady-3',
    label: "Belady's anomaly: FIFO, 3 frames",
    algorithm: 'fifo',
    frames: 3,
    refs: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
  },
  {
    id: 'belady-4',
    label: "Belady's anomaly: FIFO, 4 frames",
    algorithm: 'fifo',
    frames: 4,
    refs: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
  },
  {
    id: 'cycle',
    label: 'Cyclic scan: LRU thrashes',
    algorithm: 'lru',
    frames: 4,
    refs: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
  },
  {
    id: 'locality',
    label: 'Locality: a hot working set',
    algorithm: 'lru',
    frames: 3,
    refs: [1, 2, 1, 3, 1, 2, 1, 4, 1, 2, 1, 3, 5, 1, 2, 1, 3, 1],
  },
  {
    id: 'cmp-belady',
    label: "Compare: FIFO with 3 vs 4 frames (Belady's anomaly)",
    algorithm: 'fifo',
    frames: 3,
    compare: true,
    versus: { algorithm: 'fifo', frames: 4 },
    refs: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
  },
  {
    id: 'cmp-fifo-lru',
    label: 'Compare: FIFO vs LRU',
    algorithm: 'fifo',
    frames: 3,
    compare: true,
    versus: { algorithm: 'lru', frames: 3 },
    refs: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1],
  },
  {
    id: 'cmp-lru-opt',
    label: 'Compare: LRU vs Optimal',
    algorithm: 'lru',
    frames: 4,
    compare: true,
    versus: { algorithm: 'opt', frames: 4 },
    refs: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
  },
];

export const DEFAULT_MEMORY_PRESET = 'textbook';

/**
 * Fragmentation examples. `ops` is the request text the tab parses; `partitions` is used by the
 * fixed scheme and `size` (KB) by the variable one. `versus` configures lane B in compare mode.
 */
export const FRAG_PRESETS = [
  {
    id: 'fixed-textbook',
    label: 'Fixed: textbook partitions (first fit)',
    mode: 'fixed',
    strategy: 'first',
    partitions: '100, 500, 200, 300, 600',
    size: 1700,
    ops: 'P1 212, P2 417, P3 112, P4 426',
  },
  {
    id: 'fixed-cmp',
    label: 'Compare: first vs best fit (fixed)',
    mode: 'fixed',
    strategy: 'first',
    compare: true,
    versus: { strategy: 'best' },
    partitions: '100, 500, 200, 300, 600',
    size: 1700,
    ops: 'P1 212, P2 417, P3 112, P4 426',
  },
  {
    id: 'variable-external',
    label: 'Variable: external fragmentation',
    mode: 'variable',
    strategy: 'first',
    partitions: '100, 500, 200, 300, 600',
    size: 1800,
    ops: 'A 100, B 500, C 200, D 300, E 600, free B, free D, X 212, Y 417',
  },
  {
    id: 'variable-cmp',
    label: 'Compare: best vs worst fit (variable)',
    mode: 'variable',
    strategy: 'best',
    compare: true,
    versus: { strategy: 'worst' },
    partitions: '100, 500, 200, 300, 600',
    size: 1000,
    ops: 'A 100, B 200, C 150, D 100, E 250, free B, free D, F 90, G 200, H 150, I 280',
  },
  {
    id: 'variable-churn',
    label: 'Variable: processes come and go',
    mode: 'variable',
    strategy: 'first',
    partitions: '100, 500, 200, 300, 600',
    size: 1000,
    ops: 'P1 250, P2 150, P3 300, free P2, P4 100, free P1, P5 200, P6 120, free P3, P7 350',
  },
];

export const DEFAULT_FRAG_PRESET = 'fixed-textbook';
