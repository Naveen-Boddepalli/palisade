import { h } from './dom.js';
import { formatNumber } from '../engine/metrics.js';

export const fmt = formatNumber;

/** Form fields give strings; Number('') is 0, which would silently hide an empty field. */
export const num = (s) => (s === '' || s == null ? NaN : Number(s));

export const statTile = (label, value, unit = '') =>
  h('div', { class: 'stat' }, h('span', { class: 'k' }, label), h('b', {}, value, h('small', {}, unit)));

const LANE_CLASSES = ['a', 'b', 'c', 'd', 'e', 'f'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The coloured badge (A, B, C, ...) that ties a lane's controls, chart and results together. */
export const laneTag = (index) => {
  const cls = LANE_CLASSES[index] ?? 'other';
  const letter = LETTERS[index] ?? String(index + 1);
  return h('span', { class: `lane-tag ${cls}`, title: `Lane ${letter}` }, letter);
};
