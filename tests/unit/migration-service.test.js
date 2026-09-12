'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStorageMigration } = require('../../extension/src/services/migration-service.js');

function memoryStorage(initial = {}, failOnSetKey = null) {
  let state = structuredClone(initial);
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map(key => [key, structuredClone(state[key])]));
    },
    async set(update) {
      if (failOnSetKey && Object.hasOwn(update, failOnSetKey)) throw new Error('write failed');
      state = { ...state, ...structuredClone(update) };
    },
    inspect() { return structuredClone(state); },
  };
}

test('runStorageMigration backs up legacy data before marking schema current', async () => {
  const storage = memoryStorage({
    deferred: [{ id: 'd1', url: 'https://read.example', title: 'Read' }],
    shortcuts: [],
    tabGroups: [{ id: 'g1', savedAt: '2026-08-01T00:00:00.000Z', tabs: [{ url: 'https://a.example', title: 'A' }] }],
  });
  const result = await runStorageMigration(storage, { deviceId: 'device-1' });
  const state = storage.inspect();

  assert.equal(result.migrated, true);
  assert.equal(state.storageMeta.schemaVersion, 2);
  assert.equal(state.migrationBackupV1.tabGroups.length, 1);
  assert.equal(state.sessionsV2.length, 1);
  assert.equal(state.deferred.length, 1);
});

test('runStorageMigration is idempotent after the current version is installed', async () => {
  const storage = memoryStorage({ storageMeta: { schemaVersion: 2, deviceId: 'existing' } });
  const result = await runStorageMigration(storage, { deviceId: 'new-device' });
  assert.deepEqual(result, { migrated: false, version: 2 });
  assert.equal(storage.inspect().storageMeta.deviceId, 'existing');
});

test('runStorageMigration leaves the legacy keys untouched when the new write fails', async () => {
  const legacy = { deferred: [{ id: 'd1', url: 'https://read.example', title: 'Read' }], shortcuts: [], tabGroups: [] };
  const storage = memoryStorage(legacy, 'sessionsV2');
  await assert.rejects(() => runStorageMigration(storage, { deviceId: 'device-1' }), /write failed/);
  assert.deepEqual(storage.inspect().deferred, legacy.deferred);
  assert.equal(storage.inspect().storageMeta, undefined);
});
