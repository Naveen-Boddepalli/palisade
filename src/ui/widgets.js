import { h } from './dom.js';
import { formatNumber } from '../engine/metrics.js';

export const fmt = formatNumber;

/** Form fields give strings; Number('') is 0, which would silently hide an empty field. */
export const num = (s) => (s === '' || s == null ? NaN : Number(s));

export const statTile = (label, value, unit = '') =>
  h('div', { class: 'stat' }, h('span', { class: 'k' }, label), h('b', {}, value, h('small', {}, unit)));

/** The coloured A / B badge that ties a lane's controls, chart and results together. */
export const laneTag = (index) => h('span', { class: `lane-tag ${'ab'[index]}`, title: `Lane ${'AB'[index]}` }, 'AB'[index]);
