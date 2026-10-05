import {
  MODES, STRATEGIES, simulateMemory, parseOperations, parsePartitions, formatOperations, compareMemoryRuns, describeMemoryRun,
} from '../engine/fragmentation.js';
import { randomMemoryWorkload, newSeed } from '../engine/workload.js';
import { FRAG_PRESETS, DEFAULT_FRAG_PRESET } from '../presets.js';
import { Player, mountTransport } from './controls.js';
import { pidColor } from './gantt.js';
import { $, h } from './dom.js';
import { fmt, num, statTile, laneTag } from './widgets.js';

const pct = (value) => `${value.toFixed(1)}%`;
const formatMetric = (key, value) => (key === 'utilization' ? pct(value) : String(value));
const signed = (delta, key) => (delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${key === 'utilization' ? pct(Math.abs(delta)) : fmt(Math.abs(delta))}`);

export function mountFragmentationView() {
  const el = Object.fromEntries(
    ['preset', 'mode', 'mode-hint', 'partitions', 'partitions-wrap', 'size', 'size-wrap', 'ops', 'random', 'seed',
      'strategy', 'hint', 'lane-a-title', 'compare', 'lane-b', 'strategy-b', 'hint-b', 'error',
      'clock', 'maps', 'transport', 'now', 'single-results', 'stats', 'blocks', 'compare-results']
      .map((id) => [id, $(`#frag-${id}`)]),
  );
  const lanes = [
    { select: el.strategy, hint: el.hint },
    { select: el['strategy-b'], hint: el['hint-b'] },
  ];

  const model = { mode: 'fixed', partitions: '', size: '', ops: '', compare: false, strategies: ['first', 'best'] };
  let runs = [];
  let colors = new Map(); // process name → colour, in order of first request
  let lastK = -1;
  let maps = [];

  const player = new Player(onFrame);
  player.speed = 1;
  const transport = mountTransport(el.transport, player, { unit: 'requests' });
  const activeStrategies = () => model.strategies.slice(0, model.compare ? 2 : 1);

  // ---------------------------------------------------------------- simulate + render

  function recompute() {
    try {
      const ops = parseOperations(model.ops);
      const config = model.mode === 'fixed' ? { partitions: parsePartitions(model.partitions) } : { size: num(model.size) };
      runs = activeStrategies().map((strategy, i) => {
        try {
          return simulateMemory({ mode: model.mode, ...config, ops, strategy });
        } catch (err) {
          throw new Error(model.compare ? `Strategy ${'AB'[i]}: ${err.message}` : err.message);
        }
      });
      colors = new Map();
      for (const op of ops) if (op.type === 'alloc' && !colors.has(op.pid)) colors.set(op.pid, pidColor(colors.size));
      el.error.hidden = true;
    } catch (err) {
      runs = [];
      el.error.textContent = err.message;
      el.error.hidden = false;
    }

    lastK = -1;
    transport.setEnabled(runs.length > 0);
    if (runs.length) {
      const n = runs[0].steps.length;
      buildMaps();
      transport.setDuration(n);
      if (model.compare) renderComparison();
      player.load(n);
    } else {
      maps = [];
      el.maps.replaceChildren(h('p', { class: 'placeholder' }, 'Fix the workload to see the memory.'));
      for (const node of [el.stats, el.now, el.blocks, el['compare-results']]) node.replaceChildren();
      el.clock.textContent = 'request – / –';
      player.load(0);
    }
  }

  function buildMaps() {
    maps = runs.map((run, i) => {
      const bar = h('div', { class: 'memmap', role: 'img' });
      const root = h('div', { class: 'lane' },
        model.compare ? h('div', { class: 'lane-label' }, laneTag(i), describeMemoryRun(run)) : null,
        bar,
        h('div', { class: 'memmap-axis muted' }, h('span', {}, '0'), h('span', {}, `${run.total} KB`)));
      return { root, bar };
    });
    el.maps.replaceChildren(...maps.map((m) => m.root));
  }

  function drawBar(map, run, blocks) {
    map.bar.setAttribute('aria-label', blocks.map((b) => `${b.pid ?? 'free'} ${b.size} KB`).join(', '));
    map.bar.replaceChildren(...blocks.map((b) => {
      const owner = b.pid !== null;
      const waste = b.size - b.used;
      const title = owner
        ? `${b.pid}: ${b.used} KB in a ${b.size} KB block at ${b.start}${waste ? `, ${waste} KB wasted` : ''}`
        : `Free: ${b.size} KB at ${b.start}`;
      return h('div', { class: `blk ${owner ? 'owner' : 'free'}`, style: { flexGrow: b.size }, title },
        owner
          ? [h('div', { class: 'used', style: { flexGrow: b.used, background: colors.get(b.pid) } }, h('span', {}, b.pid)),
            waste ? h('div', { class: 'waste', style: { flexGrow: waste } }) : null]
          : h('span', { class: 'free-label' }, b.size));
    }));
  }

  function statusBlock(run, k, lane) {
    const step = k > 0 ? run.steps[k - 1] : null;
    const s = (step ?? run.initial).stats;
    return h('div', { class: 'now-block' },
      model.compare ? h('div', { class: 'lane-label' }, laneTag(lane), describeMemoryRun(run)) : null,
      step
        ? h('div', { class: 'now-head' },
          h('span', { class: `badge ${step.ok ? 'hit' : 'fault'}` }, step.ok ? (step.op.type === 'alloc' ? 'Placed' : 'Freed') : 'Refused'),
          h('span', {}, `Request ${k} of ${run.steps.length}: ${step.op.type === 'alloc' ? `${step.op.pid} needs ${step.op.size} KB` : `free ${step.op.pid}`}`))
        : h('p', { class: 'muted' }, 'Press Play or Step + to process the first request.'),
      step ? h('p', { class: 'explain' }, step.note) : null,
      h('p', { class: 'counters muted' },
        `Free: ${s.freeTotal} KB in ${s.holes} ${s.holes === 1 ? 'piece' : 'pieces'} (largest ${s.largestHole} KB). Wasted inside blocks: ${s.internal} KB.`));
  }

  function renderStats(run) {
    const s = run.summary;
    el.stats.replaceChildren(
      statTile('Placed', s.placed),
      statTile('Refused', s.refused),
      statTile('Internal fragmentation', s.internal, ' KB'),
      statTile('External fragmentation', s.external, ' KB'),
      statTile('Largest free hole', s.largestHole, ' KB'),
      statTile('Memory in use', s.utilization.toFixed(1), '%'),
    );
  }

  function renderBlocks(blocks) {
    el.blocks.replaceChildren(...blocks.map((b) =>
      h('tr', {},
        h('th', { scope: 'row' }, `${b.start}–${b.start + b.size - 1}`),
        h('td', { class: 'n' }, `${b.size} KB`),
        h('td', {}, b.pid === null ? h('span', { class: 'muted' }, 'free') : h('span', { class: 'pill', style: { background: colors.get(b.pid) } }, b.pid)),
        h('td', { class: 'n' }, b.pid !== null && b.size > b.used ? `${b.size - b.used} KB` : '–'))));
  }

  function renderComparison() {
    const cmp = compareMemoryRuns(runs[0], runs[1]);
    const laneHead = (i) => h('th', { scope: 'col', class: 'n' }, laneTag(i), h('span', { class: 'lane-name' }, ` ${describeMemoryRun(runs[i])}`));
    const best = (winner, i) => `n${winner === i ? ' best' : ''}`;
    const table = h('table', { class: 'results compare' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Metric'), laneHead(0), laneHead(1), h('th', { scope: 'col', class: 'n', title: 'strategy B minus strategy A' }, 'B − A'))),
      h('tbody', {}, ...cmp.metrics.map((m) =>
        h('tr', {},
          h('th', { scope: 'row' }, m.label),
          h('td', { class: best(m.winner, 0) }, formatMetric(m.key, m.a)),
          h('td', { class: best(m.winner, 1) }, formatMetric(m.key, m.b)),
          h('td', { class: 'n muted' }, signed(m.delta, m.key))))));
    el['compare-results'].replaceChildren(
      h('p', { class: 'verdict' }, cmp.verdict),
      h('div', { class: 'table-scroll' }, table),
      h('p', { class: 'muted small' }, 'Shaded cells are the better result. External fragmentation is the free space outside the largest hole: memory that exists but cannot be joined to it.'));
  }

  function onFrame(time, playing) {
    transport.update(time, playing);
    if (!runs.length) return;
    const k = Math.min(Math.floor(time + 1e-9), player.duration);
    if (k === lastK) return;
    lastK = k;
    el.clock.textContent = `request ${k} / ${player.duration}`;
    runs.forEach((run, i) => drawBar(maps[i], run, k > 0 ? run.steps[k - 1].blocks : run.initial.blocks));
    el.now.replaceChildren(...runs.map((run, i) => statusBlock(run, k, i)));
    if (!model.compare) {
      renderBlocks(k > 0 ? runs[0].steps[k - 1].blocks : runs[0].initial.blocks);
      renderSingleStats(runs[0], k);
    }
  }

  /** While playing, the tiles show the state so far; at the end they equal the run summary. */
  function renderSingleStats(run, k) {
    if (k === run.steps.length) return renderStats(run);
    const steps = run.steps.slice(0, k);
    const s = k > 0 ? run.steps[k - 1].stats : run.initial.stats;
    el.stats.replaceChildren(
      statTile('Placed', steps.filter((x) => x.op.type === 'alloc' && x.ok).length),
      statTile('Refused', steps.filter((x) => x.op.type === 'alloc' && !x.ok).length),
      statTile('Internal fragmentation', s.internal, ' KB'),
      statTile('External fragmentation', s.external, ' KB'),
      statTile('Largest free hole', s.largestHole, ' KB'),
      statTile('Memory in use', s.utilization.toFixed(1), '%'),
    );
  }

  // ---------------------------------------------------------------- wiring

  function syncControls() {
    el.mode.value = model.mode;
    el['mode-hint'].textContent = MODES[model.mode].hint;
    el['partitions-wrap'].hidden = model.mode !== 'fixed';
    el['size-wrap'].hidden = model.mode !== 'variable';
    if (el.partitions.value !== model.partitions) el.partitions.value = model.partitions;
    if (el.size.value !== model.size) el.size.value = model.size;
    if (el.ops.value !== model.ops) el.ops.value = model.ops;
    lanes.forEach((lane, i) => {
      lane.select.value = model.strategies[i];
      lane.hint.textContent = STRATEGIES[model.strategies[i]].hint;
    });
    el.compare.checked = model.compare;
    el['lane-b'].hidden = !model.compare;
    el['lane-a-title'].textContent = model.compare ? 'Strategy A' : 'Placement strategy';
    el.now.classList.toggle('cols', model.compare);
    el['single-results'].hidden = model.compare;
    el['compare-results'].hidden = !model.compare;
  }

  function loadPreset(id) {
    const preset = FRAG_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    Object.assign(model, { mode: preset.mode, partitions: preset.partitions, size: String(preset.size), ops: preset.ops });
    model.strategies[0] = preset.strategy;
    if (preset.versus) model.strategies[1] = preset.versus.strategy;
    model.compare = !!preset.compare;
    syncControls();
    recompute();
  }

  function loadRandom(seed) {
    const { size, partitions, ops } = randomMemoryWorkload({ seed });
    Object.assign(model, { partitions: partitions.join(', '), size: String(size), ops: formatOperations(ops) });
    syncControls();
    recompute();
  }

  el.mode.addEventListener('change', () => { model.mode = el.mode.value; syncControls(); recompute(); });
  el.partitions.addEventListener('input', () => { model.partitions = el.partitions.value; recompute(); });
  el.size.addEventListener('input', () => { model.size = el.size.value; recompute(); });
  el.ops.addEventListener('input', () => { model.ops = el.ops.value; recompute(); });
  lanes.forEach((lane, i) => lane.select.addEventListener('change', () => {
    model.strategies[i] = lane.select.value;
    syncControls();
    recompute();
  }));

  el.compare.addEventListener('change', () => {
    model.compare = el.compare.checked;
    const [a, b] = model.strategies;
    if (model.compare && a === b) {
      const ids = Object.keys(STRATEGIES);
      model.strategies[1] = ids[(ids.indexOf(a) + 1) % ids.length];
    }
    syncControls();
    recompute();
  });

  el.preset.addEventListener('change', () => { loadPreset(el.preset.value); el.preset.value = ''; });
  el.random.addEventListener('click', () => { el.seed.value = newSeed(); loadRandom(Number(el.seed.value)); });
  el.seed.addEventListener('input', () => { if (Number(el.seed.value) >= 1) loadRandom(Number(el.seed.value)); });

  // ---------------------------------------------------------------- start

  const strategyOptions = () => Object.values(STRATEGIES).map((s) => h('option', { value: s.id }, s.label));
  el.mode.replaceChildren(...Object.values(MODES).map((m) => h('option', { value: m.id }, m.label)));
  el.strategy.replaceChildren(...strategyOptions());
  el['strategy-b'].replaceChildren(...strategyOptions());
  el.preset.replaceChildren(
    h('option', { value: '' }, 'Load an example…'),
    ...FRAG_PRESETS.map((p) => h('option', { value: p.id }, p.label)),
  );
  loadPreset(DEFAULT_FRAG_PRESET);

  return { pause: () => player.pause() };
}
