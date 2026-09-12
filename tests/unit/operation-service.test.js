'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationService } = require('../../extension/src/services/operation-service.js');

function createHarness(options = {}) {
  const events = [];
  const records = new Map();
  const tabs = options.tabs || [
    { id: 1, url: 'https://a.example', title: 'A', windowId: 4, index: 0, pinned: true, active: true, groupId: -1 },
    { id: 2, url: 'https://b.example', title: 'B', windowId: 4, index: 1, pinned: false, active: false, groupId: -1 },
  ];
  const service = createOperationService({
    now: () => '2026-08-10T00:00:00.000Z',
    id: () => 'operation-1',
    captureTabs: async ids => {
      events.push(['capture', ids]);
      return { windows: [{ tabs: tabs.filter(tab => ids.includes(tab.id)) }] };
    },
    removeTabs: async ids => {
      events.push(['remove', ids]);
      if (options.removeError) throw new Error('remove failed');
    },
    getExistingTabIds: options.getExistingTabIds,
    restoreSession: async session => {
      events.push(['restore', session]);
      return { succeeded: session.windows[0].tabs.length, failed: [] };
    },
    repository: {
      async put(record) { events.push(['put', record.status]); records.set(record.id, structuredClone(record)); },
      async get(id) { return structuredClone(records.get(id)); },
    },
  });
  return { service, events, records };
}

test('close records a pending operation before removing tabs', async () => {
  const { service, events } = createHarness();
  const result = await service.close([1, 2], { source: 'domain' });

  assert.equal(result.status, 'complete');
  assert.deepEqual(events.slice(0, 3).map(event => event[0]), ['capture', 'put', 'remove']);
  assert.equal(events.at(-1)[0], 'put');
  assert.equal(events.at(-1)[1], 'complete');
  assert.equal(result.before.windows[0].tabs.length, 2);
});

test('close persists failure without losing the captured session', async () => {
  const { service, records } = createHarness({ removeError: true });
  await assert.rejects(() => service.close([1]), /remove failed/);
  const record = records.get('operation-1');
  assert.equal(record.status, 'partially_failed');
  assert.equal(record.before.windows[0].tabs[0].url, 'https://a.example');
});

test('partial close reports exact results and undo restores only tabs that actually closed', async () => {
  const { service, records, events } = createHarness({
    removeError: true,
    getExistingTabIds: async () => [2],
  });
  const operation = await service.close([1, 2]);
  assert.equal(operation.status, 'partially_failed');
  assert.equal(operation.result.succeeded, 1);
  assert.deepEqual(operation.result.failed, [{ tabId: '2', code: 'tabs_remove_failed' }]);
  assert.deepEqual(operation.before.windows[0].tabs.map(tab => tab.id), [1]);
  await service.undo(operation.id);
  const restored = events.find(event => event[0] === 'restore')[1];
  assert.deepEqual(restored.windows[0].tabs.map(tab => tab.id), [1]);
  assert.equal(records.get(operation.id).status, 'undone');
});

test('undo restores the captured session and marks operation undone', async () => {
  const { service, events, records } = createHarness();
  await service.close([1, 2]);
  const result = await service.undo('operation-1');

  assert.equal(result.status, 'undone');
  assert.equal(events.some(event => event[0] === 'restore'), true);
  assert.equal(records.get('operation-1').status, 'undone');
});

test('undo rejects operations that were already undone', async () => {
  const { service } = createHarness();
  await service.close([1]);
  await service.undo('operation-1');
  await assert.rejects(() => service.undo('operation-1'), /cannot be undone/i);
});
