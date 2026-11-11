'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRefreshScheduler } = require('../../extension/lib/live-refresh.js');

// Manual timers: tick() runs whatever is due, in order, and waits for it.
function fakeTimers() {
  const queue = [];
  return {
    setTimer(fn, ms) { queue.push({ fn, ms }); },
    async tick() { for (const { fn } of queue.splice(0)) await fn(); },
    delays: () => queue.map(timer => timer.ms),
  };
}

function setup(overrides = () => ({})) {
  const timers = fakeTimers();
  const state = { renders: 0, busy: false, hidden: false, errors: [] };
  const scheduler = createRefreshScheduler({
    render: async () => { state.renders++; },
    delayMs: 200,
    isBusy: () => state.busy,
    isHidden: () => state.hidden,
    setTimer: timers.setTimer,
    onError: error => state.errors.push(error),
    ...overrides(state, timers),
  });
  return { scheduler, timers, state };
}

test('requests coalesce into one render and later ones do not push it back', async () => {
  const { scheduler, timers, state } = setup(() => ({}));
  scheduler.request();
  scheduler.request();
  scheduler.request();
  assert.deepEqual(timers.delays(), [200]);
  await timers.tick();
  assert.equal(state.renders, 1);
  assert.deepEqual(timers.delays(), []);
});

test('a request during a render triggers exactly one more render', async () => {
  let scheduler;
  const { scheduler: created, timers, state } = setup(state => ({
    render: async () => {
      state.renders++;
      if (state.renders === 1) { scheduler.request(); scheduler.request(); }
    },
  }));
  scheduler = created;
  scheduler.request();
  await timers.tick();
  assert.equal(state.renders, 1);
  assert.deepEqual(timers.delays(), [200]);
  await timers.tick();
  assert.equal(state.renders, 2);
  assert.deepEqual(timers.delays(), []);
});

test('waits while the page is busy, then renders once it is idle', async () => {
  const { scheduler, timers, state } = setup(() => ({}));
  state.busy = true;
  scheduler.request();
  await timers.tick();
  assert.equal(state.renders, 0);
  assert.deepEqual(timers.delays(), [200]);
  state.busy = false;
  await timers.tick();
  assert.equal(state.renders, 1);
});

test('does not render while hidden; flush catches up once visible', async () => {
  const { scheduler, timers, state } = setup(() => ({}));
  state.hidden = true;
  scheduler.request();
  await timers.tick();
  assert.equal(state.renders, 0);
  assert.deepEqual(timers.delays(), []);
  state.hidden = false;
  scheduler.flush();
  assert.deepEqual(timers.delays(), [0]);
  await timers.tick();
  assert.equal(state.renders, 1);
});

test('flush does nothing when nothing changed', async () => {
  const { scheduler, timers, state } = setup(() => ({}));
  scheduler.flush();
  assert.deepEqual(timers.delays(), []);
  assert.equal(state.renders, 0);
});

test('a failed render is reported and later requests still render', async () => {
  const { scheduler, timers, state } = setup(state => ({
    render: async () => {
      state.renders++;
      if (state.renders === 1) throw new Error('boom');
    },
  }));
  scheduler.request();
  await timers.tick();
  assert.equal(state.errors.length, 1);
  scheduler.request();
  await timers.tick();
  assert.equal(state.renders, 2);
});
