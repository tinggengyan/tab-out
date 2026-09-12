'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotRepository } = require('../../extension/src/storage/snapshot-repository.js');
const { createSnapshotService } = require('../../extension/src/services/snapshot-service.js');

test('seven days of hourly structural changes stay bounded and write exactly once per capture', async () => {
  let state = {};
  let writes = 0;
  const storage = {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { writes += 1; state = { ...state, ...structuredClone(update) }; },
  };
  let hour = 0;
  const repository = createSnapshotRepository(storage, { automaticLimit: Infinity, maxBytes: 8 * 1024 * 1024 });
  const service = createSnapshotService({
    repository,
    captureAll: async () => ({
      id: `hour-${hour}`,
      type: 'automatic',
      fingerprint: `layout-${hour}`,
      capturedAt: new Date(Date.UTC(2026, 7, 1, hour)).toISOString(),
      stats: { windowCount: 10, tabCount: 100, groupCount: 20 },
      windows: [{ tabs: Array.from({ length: 100 }, (_, index) => ({ url: `https://example.com/${hour}/${index}`, title: `Tab ${index}` })), groups: [] }],
    }),
  });
  for (hour = 0; hour < 24 * 7; hour += 1) await service.flush('automatic');
  const snapshots = await repository.list();
  assert.equal(snapshots.length, 24 * 7);
  assert.equal(writes, 24 * 7);
  assert.ok(new TextEncoder().encode(JSON.stringify(state.snapshotsV2)).byteLength < 8 * 1024 * 1024);
});
