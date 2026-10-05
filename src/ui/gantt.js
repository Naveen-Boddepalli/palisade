const NS = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};

/** Stable colour per process index; golden-angle hue steps keep neighbours distinct. */
export const pidColor = (index) => `hsl(${Math.round((index * 137.5) % 360)} 50% 40%)`;

const PAD = 12;
const BAR_Y = 12;
const BAR_H = 44;
const AXIS_Y = BAR_Y + BAR_H + 8;
const HEIGHT = AXIS_Y + 30;
let uid = 0;

/**
 * Build the Gantt SVG once for a run; `update(time)` then only changes attributes,
 * so it is cheap enough to call every animation frame.
 *
 * `span` is the timeline length to scale for (defaults to this run's makespan); give two
 * charts the same span and their time axes line up. `scroller` is the element that scrolls
 * horizontally and sets the available width (defaults to `container`).
 */
export function createGantt(container, run, colorOf, { span = run.makespan, scroller = container } = {}) {
  const avail = Math.max(scroller.clientWidth - PAD * 2, 240);
  const unit = Math.min(48, Math.max(8, avail / span));
  const width = PAD * 2 + span * unit;
  const x = (t) => PAD + t * unit;
  const hatchId = `hatch-${++uid}`;

  const root = svg('svg', {
    class: 'gantt',
    width,
    height: HEIGHT,
    viewBox: `0 0 ${width} ${HEIGHT}`,
    role: 'img',
    'aria-label': `Gantt chart: ${run.gantt.map((g) => `${g.pid ?? 'idle'} from ${g.start} to ${g.end}`).join(', ')}`,
  });

  const defs = svg('defs');
  const hatch = svg('pattern', { id: hatchId, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hatch.append(svg('line', { x1: 0, y1: 0, x2: 0, y2: 8, class: 'hatch-line' }));
  defs.append(hatch);
  root.append(defs);

  root.append(svg('rect', { class: 'track', x: x(0), y: BAR_Y, width: run.makespan * unit, height: BAR_H, rx: 4 }));

  const segs = run.gantt.map((g) => {
    const idle = g.pid === null;
    const label = idle ? 'idle' : g.pid;
    const rect = svg('rect', {
      class: idle ? 'seg idle' : 'seg',
      x: x(g.start),
      y: BAR_Y,
      height: BAR_H,
      rx: 4,
      fill: idle ? `url(#${hatchId})` : colorOf(g.pid),
    });
    const title = svg('title');
    title.textContent = `${label}: t ${g.start}–${g.end} (${g.end - g.start})`;
    rect.append(title);
    const text = svg('text', { class: idle ? 'seg-label idle' : 'seg-label', y: BAR_Y + BAR_H / 2 });
    text.textContent = label;
    root.append(rect, text);
    return { g, rect, text, minLabel: label.length * 7 + 8 };
  });

  // Axis: a tick at every block boundary, labelled only where there is room.
  const axis = svg('g', { class: 'axis' });
  axis.append(svg('line', { x1: x(0), x2: x(run.makespan), y1: AXIS_Y, y2: AXIS_Y }));
  const bounds = [0, ...run.gantt.map((g) => g.end)];
  const end = run.makespan;
  let lastLabelX = -Infinity;
  for (const t of bounds) {
    axis.append(svg('line', { x1: x(t), x2: x(t), y1: AXIS_Y, y2: AXIS_Y + 5 }));
    const room = x(t) - lastLabelX >= 22 && (t === end || x(end) - x(t) >= 22);
    if (room) {
      const label = svg('text', { x: x(t), y: AXIS_Y + 20 });
      label.textContent = t;
      axis.append(label);
      lastLabelX = x(t);
    }
  }
  root.append(axis);

  const playhead = svg('line', { class: 'playhead', y1: BAR_Y - 8, y2: AXIS_Y + 5 });
  root.append(playhead);
  container.replaceChildren(root);

  function update(time) {
    time = Math.min(time, run.makespan); // a shorter run holds at its end while a longer one plays on
    for (const s of segs) {
      const shown = Math.min(Math.max(time - s.g.start, 0), s.g.end - s.g.start) * unit;
      s.rect.setAttribute('width', shown);
      s.rect.style.display = shown > 0 ? '' : 'none';
      s.text.style.display = shown >= s.minLabel ? '' : 'none';
      s.text.setAttribute('x', x(s.g.start) + shown / 2);
    }
    const px = x(time);
    playhead.setAttribute('x1', px);
    playhead.setAttribute('x2', px);
    if (px > scroller.scrollLeft + scroller.clientWidth - 24 || px < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, px - scroller.clientWidth / 2);
    }
  }

  return { update };
}
