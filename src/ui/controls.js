import { h } from './dom.js';

/**
 * Playback clock shared by every view. `time` is a float in [0, duration] measured in
 * simulation ticks; views render whatever `onFrame(time, playing)` hands them.
 */
export class Player {
  #raf = 0;
  #last = 0;

  constructor(onFrame) {
    this.onFrame = onFrame;
    this.duration = 0;
    this.time = 0;
    this.speed = 4; // ticks per second
    this.playing = false;
  }

  load(duration) {
    this.#stop();
    this.duration = duration;
    this.time = 0;
    this.#emit();
  }

  play() {
    if (this.duration <= 0 || this.playing) return;
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#tick);
    this.#emit();
  }

  pause() {
    if (!this.playing) return;
    this.#stop();
    this.#emit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(time) {
    this.time = Math.min(Math.max(time, 0), this.duration);
    if (this.playing && this.time >= this.duration) this.#stop();
    this.#emit();
  }

  /** Move to the next (+1) or previous (-1) whole tick and pause. */
  step(direction) {
    this.#stop();
    const eps = 1e-9;
    const target = direction > 0 ? Math.floor(this.time + eps) + 1 : Math.ceil(this.time - eps) - 1;
    this.time = Math.min(Math.max(target, 0), this.duration);
    this.#emit();
  }

  #stop() {
    this.playing = false;
    cancelAnimationFrame(this.#raf);
  }

  #tick = (now) => {
    if (!this.playing) return;
    // rAF timestamps are frame-start times and can precede the performance.now() taken in play(),
    // so dt may be negative. Clamp both ways: never rewind, and a backgrounded tab can't jump ahead.
    const dt = Math.min(Math.max((now - this.#last) / 1000, 0), 0.5);
    this.#last = now;
    this.time = Math.min(this.time + dt * this.speed, this.duration);
    if (this.time >= this.duration) this.#stop();
    else this.#raf = requestAnimationFrame(this.#tick);
    this.#emit();
  };

  #emit() {
    this.onFrame(this.time, this.playing);
  }
}

/**
 * Fill `root` with the transport bar (reset / step / play / end, scrubber, speed) and wire it
 * to `player`. The owning view calls `update()` from its frame callback.
 * Space and the arrow keys work while `root` is visible and enabled.
 */
export function mountTransport(root, player, { unit = 'ticks' } = {}) {
  const button = (label, title, cls = 'btn') => h('button', { type: 'button', class: cls, title }, label);
  const reset = button('Reset');
  const back = button('Step −', 'Step back (←)');
  const play = button('Play', 'Play / pause (Space)', 'btn primary');
  const forward = button('Step +', 'Step forward (→)');
  const end = button('End');
  const scrub = h('input', { class: 'scrub', type: 'range', min: 0, max: 0, step: 'any', value: 0, 'aria-label': 'Timeline position' });
  const speed = h('input', { type: 'range', min: 1, max: 20, step: 1, value: player.speed, 'aria-label': 'Playback speed' });
  const speedOut = h('output', {}, `${player.speed} ${unit}/s`);
  const controls = [reset, back, play, forward, end, scrub];
  let enabled = true;

  root.classList.add('transport');
  root.replaceChildren(
    h('div', { class: 'btns' }, reset, back, play, forward, end),
    h('label', { class: 'speed' }, h('span', {}, 'Speed'), speed, speedOut),
    scrub,
  );

  play.addEventListener('click', () => player.toggle());
  back.addEventListener('click', () => player.step(-1));
  forward.addEventListener('click', () => player.step(1));
  reset.addEventListener('click', () => { player.pause(); player.seek(0); });
  end.addEventListener('click', () => { player.pause(); player.seek(player.duration); });
  scrub.addEventListener('input', () => player.seek(Number(scrub.value)));
  speed.addEventListener('input', () => {
    player.speed = Number(speed.value);
    speedOut.textContent = `${speed.value} ${unit}/s`;
  });

  document.addEventListener('keydown', (e) => {
    if (!enabled || root.offsetParent === null) return; // disabled, or its view is hidden
    if (e.target.closest('input, select, textarea, button') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') player.step(1);
    else if (e.key === 'ArrowLeft') player.step(-1);
  });

  return {
    update(time, playing) {
      play.textContent = playing ? 'Pause' : player.duration > 0 && time >= player.duration ? 'Replay' : 'Play';
      scrub.value = time;
    },
    setDuration(duration) {
      scrub.max = duration;
    },
    setEnabled(value) {
      enabled = value;
      for (const control of controls) control.disabled = !value;
    },
  };
}
