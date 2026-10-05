import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/ui/controls.js';

/** Fake requestAnimationFrame: callbacks queue up and the test decides when a frame "arrives". */
function fakeFrames() {
  let queue = [];
  let nextId = 1;
  globalThis.requestAnimationFrame = (cb) => { queue.push({ id: nextId, cb }); return nextId++; };
  globalThis.cancelAnimationFrame = (id) => { queue = queue.filter((f) => f.id !== id); };
  return {
    pending: () => queue.length,
    /** Deliver one frame whose timestamp is `now`. */
    frame(now) {
      const due = queue;
      queue = [];
      for (const f of due) f.cb(now);
    },
  };
}

function setup(duration = 10) {
  const frames = fakeFrames();
  const seen = [];
  const player = new Player((time, playing) => seen.push({ time, playing }));
  player.load(duration);
  seen.length = 0;
  return { frames, player, seen };
}

test('a frame timestamp earlier than the moment Play was pressed never moves time below 0', () => {
  const { frames, player, seen } = setup();
  player.play();
  frames.frame(performance.now() - 50); // rAF timestamps are frame-start times and can precede "now"
  assert.ok(player.time >= 0, `time went to ${player.time}`);
  assert.ok(seen.every((s) => s.time >= 0), 'every emitted frame must be within [0, duration]');
});

test('time never exceeds the duration and playback stops at the end', () => {
  const { frames, player } = setup(3);
  player.speed = 20;
  player.play();
  frames.frame(performance.now() + 400);
  frames.frame(performance.now() + 900);
  assert.equal(player.time, 3);
  assert.equal(player.playing, false);
  assert.equal(frames.pending(), 0, 'no frame should be scheduled once finished');
});

test('a long gap between frames (backgrounded tab) advances at most half a second', () => {
  const { frames, player } = setup(100);
  player.speed = 4;
  player.play();
  frames.frame(performance.now() + 60_000);
  assert.ok(player.time <= 4 * 0.5 + 1e-9, `jumped to ${player.time}`);
});

test('step moves to the next / previous whole tick and pauses', () => {
  const { player } = setup(10);
  player.seek(2.5);
  player.step(1);
  assert.equal(player.time, 3);
  player.step(-1);
  assert.equal(player.time, 2);
  player.step(-1);
  player.step(-1);
  player.step(-1);
  assert.equal(player.time, 0);
  player.seek(10);
  player.step(1);
  assert.equal(player.time, 10);
  assert.equal(player.playing, false);
});

test('seek clamps to [0, duration]', () => {
  const { player } = setup(5);
  player.seek(-3);
  assert.equal(player.time, 0);
  player.seek(99);
  assert.equal(player.time, 5);
});

test('Play at the end restarts from 0; Pause and load stop the clock', () => {
  const { frames, player } = setup(4);
  player.seek(4);
  player.play();
  assert.equal(player.time, 0);
  assert.equal(player.playing, true);
  player.pause();
  assert.equal(player.playing, false);
  assert.equal(frames.pending(), 0);
  player.play();
  player.load(8);
  assert.equal(player.playing, false);
  assert.equal(player.time, 0);
  assert.equal(frames.pending(), 0);
});
