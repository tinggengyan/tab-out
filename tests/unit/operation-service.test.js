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

test('partial undo retains only failed tabs and retries without reopening successful tabs', async () => {
  const records = new Map();
  const attempts = [];
  const service = createOperationService({
    captureTabs: async () => ({ windows: [{ sourceWindowId: 4, tabs: [{ id: 'tab:1', url: 'https://a.example' }, { id: 'tab:2', url: 'https://b.example' }], groups: [] }] }),
    removeTabs: async () => {},
    repository: { put: async value => records.set(value.id, structuredClone(value)), get: async id => structuredClone(records.get(id)) },
    restoreSession: async (session, options) => {
      assert.equal(options.mode, 'original');
      attempts.push(session.windows.flatMap(window => window.tabs).map(tab => tab.id));
      return attempts.length === 1
        ? { succeeded: 1, failed: [{ tabId: 'tab:2', code: 'create_failed' }] }
        : { succeeded: 1, failed: [] };
    },
  });
  const operation = await service.close([1, 2]);
  const first = await service.undo(operation.id);
  assert.equal(first.status, 'partially_failed');
  assert.deepEqual(first.before.windows[0].tabs.map(tab => tab.id), ['tab:2']);
  const second = await service.undo(operation.id);
  assert.equal(second.status, 'undone');
  assert.deepEqual(attempts, [['tab:1', 'tab:2'], ['tab:2']]);
});

test('concurrent undo callers for one operation share one restoration', async () => {
  const records = new Map();
  let restoreCount = 0;
  let finishRestore;
  const restoreGate = new Promise(resolve => { finishRestore = resolve; });
  const service = createOperationService({
    captureTabs: async () => ({ windows: [{ tabs: [{ id: 'tab:1', url: 'https://a.example' }], groups: [] }] }),
    removeTabs: async () => {},
    repository: { put: async value => records.set(value.id, structuredClone(value)), get: async id => structuredClone(records.get(id)) },
    restoreSession: async () => { restoreCount++; await restoreGate; return { succeeded: 1, failed: [] }; },
  });
  const operation = await service.close([1]);
  const first = service.undo(operation.id);
  const second = service.undo(operation.id);
  finishRestore();
  const results = await Promise.all([first, second]);
  assert.equal(restoreCount, 1, 'two Undo entry points must not create duplicate pages');
  assert.ok(results.every(result => result.status === 'undone'));
});

test('different operations can be undone independently while one restore waits', async () => {
  const records = new Map();
  let index = 0;
  let finishRestore;
  const restoreGate = new Promise(resolve => { finishRestore = resolve; });
  const restored = [];
  const service = createOperationService({
    id: () => `operation-${++index}`,
    captureTabs: async ids => ({ windows: [{ tabs: ids.map(id => ({ id: `tab:${id}`, url: `https://example.com/${id}` })), groups: [] }] }),
    removeTabs: async () => {},
    repository: { put: async value => records.set(value.id, structuredClone(value)), get: async id => structuredClone(records.get(id)) },
    restoreSession: async session => {
      const ref = session.windows[0].tabs[0].id;
      restored.push(ref);
      if (ref === 'tab:1') await restoreGate;
      return { succeeded: 1, failed: [] };
    },
  });
  const one = await service.close([1]);
  const two = await service.close([2]);
  const first = service.undo(one.id);
  const second = await service.undo(two.id);
  assert.equal(second.status, 'undone');
  assert.deepEqual(restored, ['tab:1', 'tab:2']);
  finishRestore();
  await first;
});

test('close runs a non-persisted precondition after pending persistence and immediately before removal', async () => {
  const { service, events, records } = createHarness();
  const operation = await service.close([1], { source: 'guarded' }, {
    beforeRemove: async () => {
      assert.equal(records.get('operation-1').status, 'pending');
      events.push(['guard']);
    },
  });
  assert.deepEqual(events.map(event => event[0]), ['capture', 'put', 'guard', 'remove', 'put']);
  assert.deepEqual(operation.metadata, { source: 'guarded' });
  assert.equal(JSON.stringify(records.get(operation.id)).includes('beforeRemove'), false);
});

test('rejected close precondition records zero success and preserves original rejection without attempting removal', async () => {
  const { service, events, records } = createHarness({ getExistingTabIds: async () => [] });
  const stale = Object.assign(new Error('Changed while persisting'), { code: 'preview_stale' });
  await assert.rejects(service.close([1, 2], {}, { beforeRemove: async () => { throw stale; } }), error => error === stale);
  const record = records.get('operation-1');
  assert.equal(record.status, 'partially_failed');
  assert.deepEqual(record.result, { succeeded: 0, failed: [{ tabId: '1', code: 'preview_stale' }, { tabId: '2', code: 'preview_stale' }] });
  assert.equal(record.before.windows[0].tabs.length, 2);
  assert.equal(events.some(event => event[0] === 'remove'), false);
  await assert.rejects(service.undo('operation-1'), /cannot be undone/);
});
