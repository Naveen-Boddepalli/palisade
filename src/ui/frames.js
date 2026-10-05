import { h } from './dom.js';

/**
 * Textbook-style page table: one column per reference, one row per frame.
 * Built once per run with every column present so the layout never shifts;
 * `update(k)` then only flips a data-state on the columns that changed
 * (k = number of references processed so far).
 *
 * Pass the other lane's run as `other` to underline the references where the two disagree
 * (one hits, the other faults).
 */
export function createFrameTable(container, run, { other = null } = {}) {
  const { steps, refs, frames } = run;
  const n = refs.length;

  const refCells = refs.map((page) => h('td', { class: 'ref' }, page));
  const frameRows = Array.from({ length: frames }, (_, f) => steps.map((step) => {
    const page = step.frames[f];
    const touched = step.slot === f;
    const cls = ['cell', touched && !step.hit && 'loaded', touched && step.hit && 'touched'].filter(Boolean).join(' ');
    return h('td', { class: cls },
      page === null ? '' : h('span', { class: 'pg' }, page),
      touched && step.evicted ? h('span', { class: 'ev', title: `page ${step.evicted.page} evicted` }, `−${step.evicted.page}`) : null);
  }));
  const resultCells = steps.map((step, j) =>
    h('td', {
      class: `res ${step.hit ? 'hit' : 'fault'}${other && other.steps[j].hit !== step.hit ? ' diff' : ''}`,
      title: `Reference ${j + 1}: page ${step.page}, ${step.hit ? 'hit' : 'page fault'}`,
    }, step.hit ? 'H' : 'F'));

  const labelCell = (text, cls = '') => h('th', { scope: 'row', class: `lbl ${cls}`.trim() }, text);
  const table = h('table', { class: 'frames', 'aria-label': `Page frames over ${n} references (${run.label}, ${frames} frames)` },
    h('tbody', {},
      h('tr', { class: 'ref-row' }, labelCell('Reference'), ...refCells),
      ...frameRows.map((cells, f) => h('tr', {}, labelCell(`Frame ${f + 1}`), ...cells)),
      h('tr', { class: 'res-row' }, labelCell('Result'), ...resultCells)));
  container.replaceChildren(table);

  const columns = refs.map((_, j) => ({
    tds: [refCells[j], ...frameRows.map((row) => row[j]), resultCells[j]],
    state: null,
  }));
  const labelWidth = () => table.querySelector('th.lbl').offsetWidth;

  function setState(column, state) {
    if (column.state === state) return;
    column.state = state;
    for (const td of column.tds) td.dataset.state = state;
  }

  function update(k) {
    columns.forEach((column, j) => setState(column, j < k - 1 ? 'past' : j === k - 1 ? 'current' : 'future'));

    const td = k > 0 ? refCells[k - 1] : null;
    if (td) {
      const left = td.offsetLeft - labelWidth();
      const right = td.offsetLeft + td.offsetWidth;
      if (left < container.scrollLeft || right > container.scrollLeft + container.clientWidth) {
        container.scrollLeft = Math.max(0, left - container.clientWidth / 3);
      }
    } else {
      container.scrollLeft = 0;
    }
  }

  return { update };
}
