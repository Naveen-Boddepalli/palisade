import { better } from './compare.js';

/** Guards against a typo (a 10^12 KB memory, a 100k-line request list) freezing the page. */
export const MAX_MEMORY = 1_000_000;
export const MAX_OPS = 500;
export const MAX_PARTITIONS = 32;

/**
 * Placement strategies. `pick` gets the holes that are big enough, in address order, and
 * returns the chosen one. Ties always go to the lowest address (Math.min / Math.max style
 * scans below keep the first of equals).
 */
export const STRATEGIES = {
  first: {
    id: 'first',
    label: 'First fit',
    pick: (holes) => holes[0],
    hint: 'Takes the first hole, scanning from address 0, that is big enough. Fast, and tends to leave small holes near the start.',
  },
  best: {
    id: 'best',
    label: 'Best fit',
    pick: (holes) => holes.reduce((best, h) => (h.size < best.size ? h : best)),
    hint: 'Takes the smallest hole that is big enough. Wastes least per request but leaves many tiny, useless holes.',
  },
  worst: {
    id: 'worst',
    label: 'Worst fit',
    pick: (holes) => holes.reduce((best, h) => (h.size > best.size ? h : best)),
    hint: 'Takes the largest hole, hoping the leftover is still big enough to be useful.',
  },
};

export const MODES = {
  fixed: { id: 'fixed', label: 'Fixed partitions', hint: 'Memory is cut into partitions of set sizes. A process takes a whole partition, so the unused rest of it is internal fragmentation.' },
  variable: { id: 'variable', label: 'Variable partitions', hint: 'Each process gets exactly the space it asks for from one hole. Freed space leaves holes between processes: external fragmentation.' },
};

/**
 * Turn "P1 212, P2 417, free P1" into operations. Entries are separated by commas, semicolons
 * or new lines. A request is "name size" (or "name:size"); "free name" (or "-name") releases it.
 */
export function parseOperations(text) {
  const entries = String(text ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!entries.length) throw new Error('Enter at least one memory request, for example "P1 212, P2 417".');
  if (entries.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} operations are supported.`);

  return entries.map((entry) => {
    const free = /^(?:free\s+|-\s*)(\S+)$/i.exec(entry);
    if (free) return { type: 'free', pid: free[1] };
    const alloc = /^(\S+?)\s*[:\s]\s*(\d+)$/.exec(entry);
    if (!alloc) throw new Error(`Cannot read "${entry}". Use "P1 212" to request 212 KB, or "free P1" to release it.`);
    const size = Number(alloc[2]);
    if (size < 1) throw new Error(`"${entry}": a request must be at least 1 KB.`);
    return { type: 'alloc', pid: alloc[1], size };
  });
}

export const formatOperations = (ops) =>
  ops.map((op) => (op.type === 'free' ? `free ${op.pid}` : `${op.pid} ${op.size}`)).join(', ');

/** "100, 500, 200" → [100, 500, 200] */
export function parsePartitions(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) throw new Error('Enter at least one partition size, for example "100, 500, 200".');
  if (parts.length > MAX_PARTITIONS) throw new Error(`At most ${MAX_PARTITIONS} partitions are supported.`);
  return parts.map((token) => {
    if (!/^\d+$/.test(token) || Number(token) < 1) throw new Error(`Partition size "${token}" must be a whole number of KB, 1 or more.`);
    return Number(token);
  });
}

function validate({ mode, partitions, size, ops, strategy }) {
  if (!(mode in MODES)) throw new Error(`Unknown memory scheme "${mode}".`);
  if (!(strategy in STRATEGIES)) throw new Error(`Unknown placement strategy "${strategy}".`);
  if (!Array.isArray(ops) || !ops.length) throw new Error('Enter at least one memory request.');
  if (ops.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} operations are supported.`);
  if (mode === 'fixed') {
    if (!Array.isArray(partitions) || !partitions.length) throw new Error('Enter at least one partition size.');
    if (partitions.length > MAX_PARTITIONS) throw new Error(`At most ${MAX_PARTITIONS} partitions are supported.`);
    for (const p of partitions) {
      if (!Number.isInteger(p) || p < 1) throw new Error('Partition sizes must be whole numbers of KB, 1 or more.');
    }
    if (partitions.reduce((a, b) => a + b, 0) > MAX_MEMORY) throw new Error(`Total memory is limited to ${MAX_MEMORY} KB.`);
  } else if (!Number.isInteger(size) || size < 1 || size > MAX_MEMORY) {
    throw new Error(`Memory size must be a whole number of KB between 1 and ${MAX_MEMORY}.`);
  }
  const resident = new Set();
  for (const op of ops) {
    if (op.type === 'alloc') {
      if (!Number.isInteger(op.size) || op.size < 1) throw new Error(`${op.pid}: a request must be a whole number of KB, 1 or more.`);
      if (resident.has(op.pid)) throw new Error(`${op.pid} is requested twice without being freed in between. Free it first, or use another name.`);
      resident.add(op.pid); // a refused request is only known at run time; the check above is conservative
    } else {
      resident.delete(op.pid);
    }
  }
}

const copy = (blocks) => blocks.map((b) => ({ ...b }));

function stats(blocks, total, mode) {
  const used = blocks.filter((b) => b.pid !== null);
  const holes = blocks.filter((b) => b.pid === null);
  const freeTotal = holes.reduce((s, b) => s + b.size, 0);
  const largestHole = holes.reduce((m, b) => Math.max(m, b.size), 0);
  const allocated = used.reduce((s, b) => s + b.used, 0);
  return {
    allocated,
    internal: used.reduce((s, b) => s + (b.size - b.used), 0),
    freeTotal,
    largestHole,
    holes: holes.length,
    // Free space that could not serve one request as big as the largest hole: it is cut off from it.
    external: mode === 'fixed' ? 0 : freeTotal - largestHole,
    utilization: (allocated / total) * 100,
  };
}

/**
 * simulateMemory({ mode, partitions | size, ops, strategy }) →
 * {
 *   mode, strategy, label, total,
 *   initial: { blocks, stats },                       // memory before the first operation
 *   steps: [{ i, op, ok, reason, at, note, blocks: [{ start, size, pid | null, used }], stats }],
 *   summary: { placed, refused, refusedExternal, ...stats of the final state }
 * }
 *
 * `steps[i]` is the memory map after operation i. `reason` for a refused request is
 * 'external' (enough free memory exists in total, but no single hole / partition is big enough)
 * or 'full'. Freeing a process that is not resident is a no-op with reason 'not-loaded'.
 * In fixed mode `used < size` inside a block is internal fragmentation; in variable mode a block
 * is always exactly as big as its process (used === size) and holes merge when neighbours free.
 */
export function simulateMemory({ mode, partitions = [], size = 0, ops, strategy }) {
  validate({ mode, partitions, size, ops, strategy });
  const { pick } = STRATEGIES[strategy];

  let blocks;
  if (mode === 'fixed') {
    let start = 0;
    blocks = partitions.map((s) => {
      const block = { start, size: s, pid: null, used: 0 };
      start += s;
      return block;
    });
  } else {
    blocks = [{ start: 0, size, pid: null, used: 0 }];
  }
  const total = blocks.reduce((s, b) => s + b.size, 0);
  const initial = { blocks: copy(blocks), stats: stats(blocks, total, mode) };

  let placed = 0;
  let refused = 0;
  let refusedExternal = 0;
  const steps = ops.map((op, i) => {
    const step = { i, op, ok: true, reason: null, at: null, note: '' };

    if (op.type === 'alloc') {
      const holes = blocks.filter((b) => b.pid === null && b.size >= op.size);
      if (!holes.length) {
        const free = blocks.filter((b) => b.pid === null).reduce((s, b) => s + b.size, 0);
        step.ok = false;
        step.reason = free >= op.size ? 'external' : 'full';
        refused++;
        if (step.reason === 'external') refusedExternal++;
        const where = mode === 'fixed' ? 'partition' : 'hole';
        step.note = step.reason === 'external'
          ? `${op.pid} (${op.size} KB) is refused. ${free} KB is free in total, but no single ${where} is big enough: external fragmentation.`
          : `${op.pid} (${op.size} KB) is refused. Only ${free} KB is free in total.`;
      } else {
        const hole = pick(holes);
        const index = blocks.indexOf(hole);
        step.at = hole.start;
        placed++;
        if (mode === 'fixed') {
          hole.pid = op.pid;
          hole.used = op.size;
          const waste = hole.size - op.size;
          step.note = `${op.pid} (${op.size} KB) goes into the ${hole.size} KB partition at ${hole.start}${waste ? `, wasting ${waste} KB inside it (internal fragmentation)` : ', a perfect fit'}.`;
        } else if (hole.size === op.size) {
          hole.pid = op.pid;
          hole.used = op.size;
          step.note = `${op.pid} (${op.size} KB) exactly fills the ${hole.size} KB hole at ${hole.start}.`;
        } else {
          blocks.splice(index, 1,
            { start: hole.start, size: op.size, pid: op.pid, used: op.size },
            { start: hole.start + op.size, size: hole.size - op.size, pid: null, used: 0 });
          step.note = `${op.pid} (${op.size} KB) is placed in the ${hole.size} KB hole at ${hole.start}, leaving a ${hole.size - op.size} KB hole.`;
        }
      }
    } else {
      const index = blocks.findIndex((b) => b.pid === op.pid);
      if (index === -1) {
        step.ok = false;
        step.reason = 'not-loaded';
        step.note = `${op.pid} is not in memory, so there is nothing to free.`;
      } else {
        const block = blocks[index];
        step.at = block.start;
        block.pid = null;
        block.used = 0;
        step.note = `${op.pid} leaves memory and frees ${block.size} KB at ${block.start}.`;
        if (mode === 'variable') {
          // Merge with free neighbours so one big hole is not mistaken for several small ones.
          if (blocks[index + 1]?.pid === null) {
            block.size += blocks[index + 1].size;
            blocks.splice(index + 1, 1);
          }
          if (blocks[index - 1]?.pid === null) {
            blocks[index - 1].size += block.size;
            blocks.splice(index, 1);
          }
        }
      }
    }

    step.blocks = copy(blocks);
    step.stats = stats(blocks, total, mode);
    return step;
  });

  const final = steps.at(-1).stats;
  return {
    mode,
    strategy,
    label: STRATEGIES[strategy].label,
    total,
    initial,
    steps,
    summary: { placed, refused, refusedExternal, ...final },
  };
}

export const describeMemoryRun = (run) => `${run.label}, ${MODES[run.mode].label.toLowerCase()}`;

/** Two memory runs of the same workload. `winner`: 0 = A, 1 = B, -1 = tie. Lower is better except where noted. */
export function compareMemoryRuns(a, b) {
  const row = (key, label, higherIsBetter = false) => {
    const x = a.summary[key];
    const y = b.summary[key];
    return { key, label, a: x, b: y, delta: x === y ? 0 : y - x, winner: better(x, y, { higherIsBetter }) };
  };
  const metrics = [
    row('refused', 'Requests refused'),
    row('refusedExternal', 'Refused by fragmentation'),
    row('internal', 'Internal fragmentation (KB)'),
    row('external', 'External fragmentation (KB)'),
    row('largestHole', 'Largest free hole (KB)', true),
    row('utilization', 'Memory in use (%)', true),
  ];

  const refused = metrics[0];
  let verdict;
  if (refused.winner === -1) {
    verdict = refused.a === 0
      ? 'Both place every request.'
      : `Both refuse ${refused.a} request${refused.a === 1 ? '' : 's'}.`;
  } else {
    const [w, l] = refused.winner === 0 ? [refused.a, refused.b] : [refused.b, refused.a];
    verdict = `${'AB'[refused.winner]} places more requests: it refuses ${w}, the other refuses ${l}.`;
  }
  return { metrics, verdict };
}
