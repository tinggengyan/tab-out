'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryService } = require('../../extension/src/services/telemetry-service.js');

function memoryStorage() { let state = {}; return { async get(key) { return { [key]: structuredClone(state[key]) }; }, async set(update) { state = { ...state, ...structuredClone(update) }; }, inspect() { return state; } }; }

test('telemetry stores only allowlisted non-content dimensions in a bounded local ring', async () => {
  const storage = memoryStorage();
  const telemetry = createTelemetryService(storage, { maxEvents: 2, now: () => '2026-08-10T00:00:00Z' });
  await telemetry.record('restore_completed', { mode: 'merge', result: 'success', url: 'https://private.example', title: 'Secret', tab_count_bucket: '11-50' });
  await telemetry.record('undo_used', { operation_kind: 'close' });
  await telemetry.record('paywall_viewed', { feature: 'rules', plan: 'free' });
  const events = storage.inspect().telemetryEventsV1;
  assert.equal(events.length, 2);
  assert.equal(JSON.stringify(events).includes('private.example'), false);
  assert.equal(JSON.stringify(events).includes('Secret'), false);
});

test('local errors keep codes and scope but never raw messages or browsing content', async () => {
  const storage = memoryStorage();
  const telemetry = createTelemetryService(storage);
  await telemetry.error('restore', 'create_failed', new Error('https://private.example secret title'));
  const errors = storage.inspect().localErrorsV1;
  assert.deepEqual(Object.keys(errors[0]).sort(), ['at', 'code', 'scope']);
});
