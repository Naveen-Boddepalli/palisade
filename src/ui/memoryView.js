import { PAGING_ALGORITHMS, parseReferenceString, simulatePaging } from '../engine/paging.js';
import { comparePagingRuns, describePagingRun } from '../engine/compare.js';
import { randomReferenceString, newSeed } from '../engine/workload.js';
import { MEMORY_PRESETS, DEFAULT_MEMORY_PRESET } from '../presets.js';
import { Player, mountTransport } from './controls.js';
import { createFrameTable } from './frames.js';
import { $, h } from './dom.js';
import { fmt, num, statTile, laneTag } from './widgets.js';

const pct = (fraction) => `${(fraction * 100).toFixed(1)}%`;
const formatMetric = (key, value) => (key === 'faultRate' || key === 'hitRate' ? pct(value) : String(value));
const signed = (delta, key) => {
  if (delta === 0) return '0';
  const rate = key === 'faultRate' || key === 'hitRate';
  return `${delta > 0 ? '+' : '−'}${rate ? pct(Math.abs(delta)) : fmt(Math.abs(delta))}`;
};

/** Why the policy picked this victim, in the words a textbook would use. */
function explain(run, step) {
  const frame = `frame ${step.slot + 1}`;
  if (step.hit) return `Page ${step.page} is already in ${frame}, so there is no fault.`;
  if (!step.evicted) return `Page ${step.page} is not in memory. ${frame[0].toUpperCase()}${frame.slice(1)} is free, so it is loaded there.`;

  const e = step.evicted;
  const reason = {
    fifo: `it has been in memory longest (loaded at reference ${e.loadedAt + 1})`,
    lru: `it was used least recently (last used at reference ${e.lastUsed + 1})`,
    opt: e.nextUse === null ? 'it is never used again' : `it is needed farthest in the future (next at reference ${e.nextUse + 1})`,
  }[run.algorithm];
  return `Page ${step.page} is not in memory and every frame is full. ${run.label} evicts page ${e.page} from ${frame} because ${reason}.`;
}

export function mountMemoryView() {
  const el = Object.fromEntries(
    ['preset', 'random', 'seed', 'refs', 'frames', 'algo', 'hint', 'compare', 'lane-b', 'frames-b', 'algo-b', 'hint-b', 'lane-a-frames',
      'lane-a-algo', 'error', 'clock', 'tables', 'legend-diff', 'transport', 'now', 'stats', 'compare-results']
      .map((id) => [id, $(`#mem-${id}`)]),
  );
  const fields = [
    { frames: el.frames, algo: el.algo, hint: el.hint },
    { frames: el['frames-b'], algo: el['algo-b'], hint: el['hint-b'] },
  ];

  const model = {
    refs: '',
    compare: false,
    lanes: [{ algorithm: 'fifo', frames: '3' }, { algorithm: 'lru', frames: '3' }],
  };
  let runs = []; // one simulation per active lane
  let tables = [];
  let lastK = -1;

  const player = new Player(onFrame);
  player.speed = 2; // a reference has more to read than a tick does
  const transport = mountTransport(el.transport, player, { unit: 'refs' });
  const activeLanes = () => model.lanes.slice(0, model.compare ? 2 : 1);

  // ---------------------------------------------------------------- simulate + render

  function recompute() {
    try {
      const refs = parseReferenceString(model.refs);
      runs = activeLanes().map((lane, i) => {
        try {
          return simulatePaging(refs, num(lane.frames), lane.algorithm);
        } catch (err) {
          throw new Error(model.compare ? `Setup ${'AB'[i]}: ${err.message}` : err.message);
        }
      });
      el.error.hidden = true;
    } catch (err) {
      runs = [];
      el.error.textContent = err.message;
      el.error.hidden = false;
    }

    lastK = -1;
    transport.setEnabled(runs.length > 0);
    el['legend-diff'].hidden = !(model.compare && runs.length === 2);
    if (runs.length) {
      buildTables();
      transport.setDuration(runs[0].refs.length);
      if (model.compare) renderComparison();
      else renderStats(runs[0]);
      player.load(runs[0].refs.length);
    } else {
      tables = [];
      el.tables.replaceChildren(h('p', { class: 'placeholder' }, 'Fix the workload to see the frames.'));
      for (const node of [el.stats, el.now, el['compare-results']]) node.replaceChildren();
      el.clock.textContent = 'ref – / –';
      player.load(0);
    }
  }

  function buildTables() {
    const lanes = runs.map((run, i) =>
      h('div', { class: 'lane' },
        model.compare ? h('div', { class: 'lane-label' }, laneTag(i), describePagingRun(run)) : null,
        h('div', { class: 'frames-scroll' })));
    el.tables.replaceChildren(...lanes);
    tables = runs.map((run, i) =>
      createFrameTable($('.frames-scroll', lanes[i]), run, { other: runs.length === 2 ? runs[1 - i] : null }));
  }

  function renderStats(run) {
    el.stats.replaceChildren(
      statTile('Page faults', run.faults),
      statTile('Hits', run.hits),
      statTile('Fault rate', (run.faultRate * 100).toFixed(1), '%'),
      statTile('Hit rate', (run.hitRate * 100).toFixed(1), '%'),
      statTile('Frames', run.frames),
      statTile('Distinct pages', run.distinctPages),
    );
  }

  function renderComparison() {
    const cmp = comparePagingRuns(runs[0], runs[1]);
    const laneHead = (i) => h('th', { scope: 'col', class: 'n' }, laneTag(i), h('span', { class: 'lane-name' }, ` ${describePagingRun(runs[i])}`));
    const best = (winner, i) => `n${winner === i ? ' best' : ''}`;

    const table = h('table', { class: 'results compare' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Metric'), laneHead(0), laneHead(1),
        h('th', { scope: 'col', class: 'n', title: 'setup B minus setup A' }, 'B − A'))),
      h('tbody', {}, ...cmp.metrics.map((m) =>
        h('tr', {},
          h('th', { scope: 'row' }, m.label),
          h('td', { class: best(m.winner, 0) }, formatMetric(m.key, m.a)),
          h('td', { class: best(m.winner, 1) }, formatMetric(m.key, m.b)),
          h('td', { class: 'n muted' }, signed(m.delta, m.key))))));

    el['compare-results'].replaceChildren(
      h('p', { class: 'verdict' }, cmp.verdict),
      ...(cmp.anomaly ? [h('p', { class: 'anomaly' }, cmp.anomaly)] : []),
      h('div', { class: 'table-scroll' }, table),
      h('p', { class: 'muted small' },
        `The two setups handle ${cmp.differCount} of ${runs[0].refs.length} references differently (flagged with a corner mark in the tables). Shaded cells are the better result.`),
    );
  }

  function statusBlock(run, k, lane) {
    const step = run.steps[k - 1];
    return h('div', { class: 'now-block' },
      model.compare ? h('div', { class: 'lane-label' }, laneTag(lane), describePagingRun(run)) : null,
      h('div', { class: 'now-head' },
        h('span', { class: `badge ${step.hit ? 'hit' : 'fault'}` }, step.hit ? 'Hit' : 'Page fault'),
        h('span', {}, `Reference ${k} of ${run.refs.length}: page ${step.page}`)),
      h('p', { class: 'explain' }, explain(run, step)),
      h('p', { class: 'counters muted' }, `So far: ${step.faultsSoFar} faults, ${k - step.faultsSoFar} hits, fault rate ${pct(step.faultsSoFar / k)}`));
  }

  function onFrame(time, playing) {
    transport.update(time, playing);
    if (!runs.length) return;
    const k = Math.min(Math.floor(time + 1e-9), player.duration);
    if (k === lastK) return;
    lastK = k;
    el.clock.textContent = `ref ${k} / ${player.duration}`;
    for (const table of tables) table.update(k);
    el.now.replaceChildren(...(k === 0
      ? [h('p', { class: 'muted' }, 'Press Play or Step + to process the first reference.')]
      : runs.map((run, i) => statusBlock(run, k, i))));
  }

  // ---------------------------------------------------------------- wiring

  function syncControls() {
    model.lanes.forEach((lane, i) => {
      if (fields[i].algo.value !== lane.algorithm) fields[i].algo.value = lane.algorithm;
      if (fields[i].frames.value !== lane.frames) fields[i].frames.value = lane.frames;
      fields[i].hint.textContent = PAGING_ALGORITHMS[lane.algorithm].hint;
    });
    if (el.refs.value !== model.refs) el.refs.value = model.refs;
    el.compare.checked = model.compare;
    el['lane-b'].hidden = !model.compare;
    el['lane-a-frames'].textContent = model.compare ? 'Frames A' : 'Frames';
    el['lane-a-algo'].textContent = model.compare ? 'Algorithm A' : 'Algorithm';
    el.stats.hidden = model.compare;
    el.now.classList.toggle('cols', model.compare);
    el['compare-results'].hidden = !model.compare;
  }

  function loadPreset(id) {
    const preset = MEMORY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    model.refs = preset.refs.join(', ');
    model.lanes[0] = { algorithm: preset.algorithm, frames: String(preset.frames) };
    if (preset.versus) {
      model.lanes[1] = { algorithm: preset.versus.algorithm, frames: String(preset.versus.frames ?? preset.frames) };
    }
    model.compare = !!preset.compare;
    syncControls();
    recompute();
  }

  function loadRandom(seed) {
    model.refs = randomReferenceString({ seed }).join(', ');
    syncControls();
    recompute();
  }

  el.random.addEventListener('click', () => { el.seed.value = newSeed(); loadRandom(Number(el.seed.value)); });
  el.seed.addEventListener('input', () => { if (Number(el.seed.value) >= 1) loadRandom(Number(el.seed.value)); });
  el.refs.addEventListener('input', () => { model.refs = el.refs.value; recompute(); });
  fields.forEach((f, i) => {
    f.frames.addEventListener('input', () => { model.lanes[i].frames = f.frames.value; recompute(); });
    f.algo.addEventListener('change', () => { model.lanes[i].algorithm = f.algo.value; syncControls(); recompute(); });
  });

  el.compare.addEventListener('change', () => {
    model.compare = el.compare.checked;
    const [a, b] = model.lanes;
    if (model.compare && a.algorithm === b.algorithm && a.frames === b.frames) {
      const ids = Object.keys(PAGING_ALGORITHMS);
      b.algorithm = ids[(ids.indexOf(a.algorithm) + 1) % ids.length];
    }
    syncControls();
    recompute();
  });

  el.preset.addEventListener('change', () => { loadPreset(el.preset.value); el.preset.value = ''; });

  // ---------------------------------------------------------------- start

  const algoOptions = () => Object.values(PAGING_ALGORITHMS).map((a) => h('option', { value: a.id }, a.label));
  el.algo.replaceChildren(...algoOptions());
  el['algo-b'].replaceChildren(...algoOptions());
  el.preset.replaceChildren(
    h('option', { value: '' }, 'Load an example…'),
    ...MEMORY_PRESETS.map((p) => h('option', { value: p.id }, p.label)),
  );
  loadPreset(DEFAULT_MEMORY_PRESET);

  return { pause: () => player.pause() };
}
