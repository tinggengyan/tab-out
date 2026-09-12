'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotService } = require('../../extension/src/services/snapshot-service.js');

test('markDirty coalesces multiple events into one delayed capture', async () => {
  const timers = [];
  let captures = 0;
  const added = [];
  const service = createSnapshotService({
    captureAll: async () => ({ id: `s${++captures}`, fingerprint: `f${captures}` }),
    repository: { async add(session) { added.push(session); return true; } },
    setTimer(fn) { timers.push(fn); return timers.length; },
    clearTimer() {},
  });

  service.markDirty('created');
  service.markDirty('moved');
  assert.equal(timers.length, 2);
  await timers.at(-1)();
  assert.equal(captures, 1);
  assert.equal(added.length, 1);
});

test('flush captures immediately and reports whether a snapshot was stored', async () => {
  const captured = [];
  const service = createSnapshotService({
    captureAll: async type => ({ id: 'snapshot', type, fingerprint: 'f1' }),
    repository: { async add() { return true; } },
    onCaptured: async session => captured.push(session.id),
  });
  const result = await service.flush('manual');
  assert.deepEqual(result, { stored: true, sessionId: 'snapshot' });
  assert.deepEqual(captured, ['snapshot']);
});

test('duplicate snapshots do not emit a captured event', async () => {
  let emitted = false;
  const service = createSnapshotService({
    captureAll: async () => ({ id: 'duplicate', fingerprint: 'same' }),
    repository: { async add() { return false; } },
    onCaptured: async () => { emitted = true; },
  });
  assert.equal((await service.flush()).stored, false);
  assert.equal(emitted, false);
});

test('flush serializes concurrent captures', async () => {
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createSnapshotService({
    captureAll: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return { id: crypto.randomUUID(), fingerprint: crypto.randomUUID() };
    },
    repository: { async add() { return true; } },
  });
  const first = service.flush();
  const second = service.flush();
  release();
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
});
