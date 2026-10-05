import { ALGORITHMS, simulate } from '../engine/scheduling.js';
import { compareSchedulingRuns, describeSchedulingRun } from '../engine/compare.js';
import { randomProcesses, newSeed } from '../engine/workload.js';
import { PRESETS, DEFAULT_PRESET } from '../presets.js';
import { Player, mountTransport } from './controls.js';
import { createGantt, pidColor } from './gantt.js';
import { $, h } from './dom.js';
import { fmt, num, statTile, laneTag } from './widgets.js';

const pidOf = (i) => `P${i + 1}`;
const indexOf = (pid) => Number(pid.slice(1)) - 1;
const colorOf = (pid) => pidColor(indexOf(pid));
const pill = (pid) => h('span', { class: 'pill', style: { background: colorOf(pid) } }, pid);

/** What actually configures a lane: the quantum only matters to algorithms that use one. */
const laneKey = (lane) => (ALGORITHMS[lane.algorithm].usesQuantum ? `${lane.algorithm}:${lane.quantum}` : lane.algorithm);

const formatMetric = (key, value) => (key === 'cpuUtilization' ? `${value.toFixed(1)}%` : fmt(value));
const signed = (delta, unit = '') => (delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}${unit}`);

function eventText(e) {
  switch (e.type) {
    case 'arrive': return `${e.pid} arrives`;
    case 'complete': return `${e.pid} completes`;
    case 'dispatch': return `${e.pid} gets the CPU`;
    case 'preempt':
      return e.reason === 'quantum' ? `${e.pid} used its quantum, back of the queue` : `${e.pid} is preempted`;
    default: return e.type;
  }
}

export function mountSchedulingView() {
  const el = Object.fromEntries(
    ['preset', 'random', 'seed', 'proc-table', 'proc-body', 'add-proc', 'lane-a-title', 'algo', 'quantum', 'quantum-wrap', 'algo-hint',
      'compare', 'lane-b', 'algo-b', 'quantum-b', 'quantum-wrap-b', 'algo-hint-b', 'error',
      'gantt', 'clock', 'transport', 'now', 'single-results', 'stats', 'results-body', 'compare-results']
      .map((id) => [id, $(`#${id}`)]),
  );
  // Form controls for lane A and lane B.
  const fields = [
    { algo: el.algo, quantum: el.quantum, wrap: el['quantum-wrap'], hint: el['algo-hint'] },
    { algo: el['algo-b'], quantum: el['quantum-b'], wrap: el['quantum-wrap-b'], hint: el['algo-hint-b'] },
  ];

  const model = {
    rows: [],
    compare: false,
    lanes: [{ algorithm: 'srtf', quantum: '4' }, { algorithm: 'sjf', quantum: '4' }],
  };
  let runs = []; // one simulation per active lane
  let charts = [];
  let lastT = -1;
  let ganttWidth = 0;

  const player = new Player(onFrame);
  const transport = mountTransport(el.transport, player);
  const activeLanes = () => model.lanes.slice(0, model.compare ? 2 : 1);

  // ---------------------------------------------------------------- workload table

  function renderTable() {
    const only = model.rows.length === 1;
    el['proc-body'].replaceChildren(
      ...model.rows.map((row, i) => {
        const pid = pidOf(i);
        const field = (f, min, label) =>
          h('input', { type: 'number', min, step: 1, inputmode: 'numeric', 'data-f': f, value: row[f], 'aria-label': `${pid} ${label}` });
        return h('tr', { 'data-i': i },
          h('th', { scope: 'row' }, pill(pid)),
          h('td', {}, field('arrival', 0, 'arrival time')),
          h('td', {}, field('burst', 1, 'burst time')),
          h('td', { class: 'col-priority' }, field('priority', 0, 'priority')),
          h('td', {}, h('button', { class: 'icon-btn', 'data-remove': true, 'aria-label': `Remove ${pid}`, disabled: only }, '×')));
      }),
    );
  }

  /** Push the model into the lane controls and show / hide what the mode needs. */
  function syncControls() {
    model.lanes.forEach((lane, i) => {
      const algo = ALGORITHMS[lane.algorithm];
      if (fields[i].algo.value !== lane.algorithm) fields[i].algo.value = lane.algorithm;
      if (fields[i].quantum.value !== lane.quantum) fields[i].quantum.value = lane.quantum;
      fields[i].hint.textContent = algo.hint;
      fields[i].wrap.hidden = !algo.usesQuantum;
    });
    el.compare.checked = model.compare;
    el['lane-b'].hidden = !model.compare;
    el['lane-a-title'].textContent = model.compare ? 'Algorithm A' : 'Algorithm';
    el['proc-table'].classList.toggle('show-priority', activeLanes().some((l) => ALGORITHMS[l.algorithm].usesPriority));
    el['single-results'].hidden = model.compare;
    el['compare-results'].hidden = !model.compare;
  }

  function loadPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    model.rows = preset.rows.map(([arrival, burst, priority]) => ({
      arrival: String(arrival), burst: String(burst), priority: String(priority),
    }));
    model.lanes[0] = { algorithm: preset.algorithm, quantum: String(preset.quantum ?? model.lanes[0].quantum) };
    if (preset.versus) {
      model.lanes[1] = { algorithm: preset.versus.algorithm, quantum: String(preset.versus.quantum ?? model.lanes[1].quantum) };
    }
    model.compare = !!preset.compare;
    renderTable();
    syncControls();
    recompute();
  }

  function loadRandom(seed) {
    model.rows = randomProcesses({ seed }).map(([arrival, burst, priority]) => ({
      arrival: String(arrival), burst: String(burst), priority: String(priority),
    }));
    renderTable();
    recompute();
  }

  // ---------------------------------------------------------------- simulate + render

  function recompute() {
    const input = model.rows.map((row, i) => ({
      pid: pidOf(i), arrival: num(row.arrival), burst: num(row.burst), priority: num(row.priority),
    }));
    try {
      simulate(input, 'fcfs'); // validates the workload on its own, so errors below belong to a lane
      runs = activeLanes().map((lane, i) => {
        try {
          return simulate(input, lane.algorithm, { quantum: num(lane.quantum) });
        } catch (err) {
          throw new Error(model.compare ? `Algorithm ${'AB'[i]}: ${err.message}` : err.message);
        }
      });
      el.error.hidden = true;
    } catch (err) {
      runs = [];
      el.error.textContent = err.message;
      el.error.hidden = false;
    }

    lastT = -1;
    transport.setEnabled(runs.length > 0);
    if (runs.length) {
      const duration = Math.max(...runs.map((r) => r.makespan));
      buildCharts();
      transport.setDuration(duration);
      if (model.compare) renderComparison();
      else renderStats(runs[0]);
      player.load(duration);
    } else {
      charts = [];
      el.gantt.replaceChildren(h('p', { class: 'placeholder' }, 'Fix the workload to see the chart.'));
      for (const node of [el.stats, el.now, el['results-body'], el['compare-results']]) node.replaceChildren();
      el.clock.textContent = 't = –';
      player.load(0);
    }
  }

  /** One Gantt per lane, on a shared time scale so the two line up. */
  function buildCharts() {
    const span = Math.max(...runs.map((r) => r.makespan));
    ganttWidth = el.gantt.clientWidth;
    const lanes = runs.map((run, i) =>
      h('div', { class: 'lane' },
        h('div', { class: 'lane-label' }, model.compare ? laneTag(i) : null, describeSchedulingRun(run)),
        h('div', { class: 'lane-chart' })));
    el.gantt.replaceChildren(...lanes);
    charts = runs.map((run, i) =>
      createGantt($('.lane-chart', lanes[i]), run, colorOf, { span, scroller: el.gantt }));
  }

  function renderStats(run) {
    const m = run.metrics;
    el.stats.replaceChildren(
      statTile('Avg waiting', fmt(m.avgWaiting)),
      statTile('Avg turnaround', fmt(m.avgTurnaround)),
      statTile('Avg response', fmt(m.avgResponse)),
      statTile('CPU utilization', m.cpuUtilization.toFixed(1), '%'),
      statTile('Context switches', m.contextSwitches),
      statTile('Total time', m.makespan),
    );
  }

  function renderComparison() {
    const cmp = compareSchedulingRuns(runs[0], runs[1]);
    const laneHead = (i) => h('th', { scope: 'col', class: 'n' }, laneTag(i), h('span', { class: 'lane-name' }, ` ${describeSchedulingRun(runs[i])}`));
    const best = (winner, i) => `n${winner === i ? ' best' : ''}`;

    const metrics = h('table', { class: 'results compare' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Metric'), laneHead(0), laneHead(1),
        h('th', { scope: 'col', class: 'n', title: 'lane B minus lane A' }, 'B − A'))),
      h('tbody', {}, ...cmp.metrics.map((m) =>
        h('tr', {},
          h('th', { scope: 'row' }, m.label),
          h('td', { class: best(m.winner, 0) }, formatMetric(m.key, m.a)),
          h('td', { class: best(m.winner, 1) }, formatMetric(m.key, m.b)),
          h('td', { class: 'n muted' }, signed(m.delta, m.key === 'cpuUtilization' ? '%' : ''))))));

    const pair = (metric) => [0, 1].map((i) => h('td', { class: best(metric.winner, i) }, i === 0 ? metric.a : metric.b));
    const group = (label) => h('th', { scope: 'colgroup', colspan: 2, class: 'grp' }, label);
    const ab = () => [laneTag(0), laneTag(1)].map((tag) => h('th', { scope: 'col', class: 'n' }, tag));
    const perProcess = h('table', { class: 'results compare' },
      h('thead', {},
        h('tr', {}, h('th', { rowspan: 2, scope: 'col' }, 'Process'), group('Waiting'), group('Turnaround'), group('Response')),
        h('tr', {}, ...ab(), ...ab(), ...ab())),
      h('tbody', {}, ...cmp.perProcess.map((p) =>
        h('tr', {}, h('th', { scope: 'row' }, pill(p.pid)), ...pair(p.waiting), ...pair(p.turnaround), ...pair(p.response)))));

    el['compare-results'].replaceChildren(
      h('p', { class: 'verdict' }, cmp.verdict),
      h('div', { class: 'table-scroll' }, metrics),
      h('h3', {}, 'Per process'),
      h('div', { class: 'table-scroll' }, perProcess),
      h('p', { class: 'muted small' }, 'Shaded cells are the better result; fewer context switches count as better.'),
    );
  }

  function stateOf(snap, pid) {
    if (snap.running === pid) return 'running';
    if (snap.ready.includes(pid)) return 'ready';
    return snap.remaining[pid] === 0 ? 'done' : 'not arrived';
  }

  function renderProcessTable(run, k) {
    const snap = run.snapshots[k];
    el['results-body'].replaceChildren(
      ...run.processes.map((p) => {
        const state = stateOf(snap, p.pid);
        const left = snap.remaining[p.pid];
        return h('tr', {},
          h('th', { scope: 'row' }, pill(p.pid)),
          h('td', {}, h('span', { class: `state ${state.replace(' ', '-')}` }, state)),
          h('td', {}, h('span', { class: 'bar', title: `${p.burst - left} of ${p.burst} done` }, h('i', { style: { width: `${((p.burst - left) / p.burst) * 100}%` } }))),
          h('td', { class: 'n' }, p.completion), h('td', { class: 'n' }, p.turnaround),
          h('td', { class: 'n' }, p.waiting), h('td', { class: 'n' }, p.response));
      }),
      h('tr', { class: 'avg' },
        h('th', { scope: 'row', colspan: 3 }, 'Average'), h('td', {}),
        h('td', { class: 'n' }, fmt(run.metrics.avgTurnaround)), h('td', { class: 'n' }, fmt(run.metrics.avgWaiting)), h('td', { class: 'n' }, fmt(run.metrics.avgResponse))),
    );
  }

  /** CPU + ready queue for one lane at tick k. */
  function statusBlock(run, k, lane) {
    const snap = run.snapshots[k];
    const rr = ALGORITHMS[run.algorithm].kind === 'rr';
    return h('div', {},
      model.compare ? h('div', { class: 'lane-label' }, laneTag(lane), describeSchedulingRun(run)) : null,
      h('h3', {}, 'CPU'),
      h('div', { class: 'cpu' },
        snap.running
          ? h('div', { class: 'cpu-busy' }, pill(snap.running), h('span', { class: 'muted' }, `${snap.remaining[snap.running]} left`))
          : h('span', { class: 'muted' }, k >= run.makespan ? 'Finished' : 'Idle')),
      h('h3', {}, rr ? 'Ready queue (front first)' : 'Ready queue (next to run first)'),
      h('div', { class: 'chips' }, ...(snap.ready.length ? snap.ready.map(pill) : [h('span', { class: 'muted' }, 'empty')])));
  }

  function eventsBlock(run, k) {
    const log = [];
    for (let t = k; t >= 0 && log.length < 8; t--) {
      for (const e of [...run.snapshots[t].events].reverse()) if (log.length < 8) log.push({ t, e });
    }
    return h('div', {},
      h('h3', {}, 'Recent events'),
      h('ol', { class: 'events' }, ...log.map(({ t, e }) => h('li', {}, h('span', { class: 't' }, `t=${t}`), eventText(e)))));
  }

  function onFrame(time, playing) {
    transport.update(time, playing);
    if (!runs.length) return;
    for (const chart of charts) chart.update(time);

    const t = Math.min(Math.floor(time + 1e-9), player.duration);
    if (t === lastT) return;
    lastT = t;
    el.clock.textContent = `t = ${t}`;

    const ks = runs.map((run) => Math.min(t, run.makespan)); // a shorter run holds at its final state
    if (model.compare) {
      el.now.replaceChildren(...runs.map((run, i) => statusBlock(run, ks[i], i)));
    } else {
      el.now.replaceChildren(statusBlock(runs[0], ks[0], 0), eventsBlock(runs[0], ks[0]));
      renderProcessTable(runs[0], ks[0]);
    }
  }

  // ---------------------------------------------------------------- wiring

  el['proc-body'].addEventListener('input', (e) => {
    const field = e.target.dataset.f;
    if (!field) return;
    model.rows[Number(e.target.closest('tr').dataset.i)][field] = e.target.value;
    recompute();
  });
  el['proc-body'].addEventListener('click', (e) => {
    const button = e.target.closest('[data-remove]');
    if (!button || model.rows.length <= 1) return;
    model.rows.splice(Number(button.closest('tr').dataset.i), 1);
    renderTable();
    recompute();
  });
  el['add-proc'].addEventListener('click', () => {
    model.rows.push({ arrival: '0', burst: '5', priority: '1' });
    renderTable();
    recompute();
  });

  fields.forEach((f, i) => {
    f.algo.addEventListener('change', () => {
      model.lanes[i].algorithm = f.algo.value;
      syncControls();
      recompute();
    });
    f.quantum.addEventListener('input', () => {
      model.lanes[i].quantum = f.quantum.value;
      recompute();
    });
  });

  el.compare.addEventListener('change', () => {
    model.compare = el.compare.checked;
    const [a, b] = model.lanes;
    if (model.compare && laneKey(a) === laneKey(b)) {
      // Comparing something with itself is pointless: start lane B on the next algorithm.
      const ids = Object.keys(ALGORITHMS);
      b.algorithm = ids[(ids.indexOf(a.algorithm) + 1) % ids.length];
    }
    syncControls();
    recompute();
  });

  el.preset.addEventListener('change', () => {
    loadPreset(el.preset.value);
    el.preset.value = '';
  });
  el.random.addEventListener('click', () => { el.seed.value = newSeed(); loadRandom(Number(el.seed.value)); });
  el.seed.addEventListener('input', () => { if (Number(el.seed.value) >= 1) loadRandom(Number(el.seed.value)); });

  // Rebuild the charts when their container width changes so blocks keep filling the space.
  new ResizeObserver(() => {
    if (!runs.length || Math.abs(el.gantt.clientWidth - ganttWidth) < 2) return;
    buildCharts();
    for (const chart of charts) chart.update(player.time);
  }).observe(el.gantt);

  // ---------------------------------------------------------------- start

  const algoOptions = () => Object.values(ALGORITHMS).map((a) => h('option', { value: a.id }, a.label));
  el.algo.replaceChildren(...algoOptions());
  el['algo-b'].replaceChildren(...algoOptions());
  el.preset.replaceChildren(
    h('option', { value: '' }, 'Load an example…'),
    ...PRESETS.map((p) => h('option', { value: p.id }, p.label)),
  );
  loadPreset(DEFAULT_PRESET);

  return { pause: () => player.pause() };
}
