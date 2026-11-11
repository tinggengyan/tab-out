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

test('a rejected nested legacy session aborts local migration without clearing assets and retries after correction', async () => {
  let nested = {}; for (let index = 0; index < 20; index++) nested = { child: nested };
  const initial = {
    shortcuts: [{ id: 'shortcut', name: 'Keep shortcut', url: 'https://shortcut.example/' }],
    deferred: [{ id: 'later', title: 'Keep later', url: 'https://later.example/' }],
    tabGroups: [{ id: 'group', tabs: [{ url: 'https://project.example/' }], session: nested }],
  };
  const storage = memoryStorage(initial);
  await assert.rejects(runStorageMigration(storage), /Cannot migrate saved data/);
  assert.deepEqual(storage.inspect().shortcuts, initial.shortcuts);
  assert.deepEqual(storage.inspect().deferred, initial.deferred);
  assert.deepEqual(storage.inspect().tabGroups, initial.tabGroups);
  assert.equal(storage.inspect().storageMeta, undefined);
  assert.deepEqual(storage.inspect().migrationBackupV1, initial);
  await storage.set({ tabGroups: [{ ...initial.tabGroups[0], session: { windows: [{ tabs: [{ url: 'https://project.example/' }], groups: [] }] } }] });
  const retried = await runStorageMigration(storage);
  assert.equal(retried.migrated, true);
  assert.equal(storage.inspect().storageMeta.schemaVersion, 2);
  assert.equal(storage.inspect().shortcuts[0].id, 'shortcut');
  assert.equal(storage.inspect().deferred[0].id, 'later');
});

test('local schema migration rejects malformed session members, preserves original keys and retries valid correction', async () => {
  const {invalidSessionFixtures,validSessionFixture}=require('../helpers/session-import-fixtures.js');
  for(const {name,session} of invalidSessionFixtures()) {
    const initial={shortcuts:[{id:'keep',name:'Shortcut',url:'https://keep.example/'}],deferred:[{id:'later',url:'https://later.example/'}],tabGroups:[{id:'group',tabs:[{url:'https://good.example/'}],session}]};
    const area=memoryStorage(initial);
    await assert.rejects(runStorageMigration(area),/Cannot migrate saved data/,name);
    assert.deepEqual(area.inspect().shortcuts,initial.shortcuts,name);assert.deepEqual(area.inspect().deferred,initial.deferred,name);assert.deepEqual(area.inspect().tabGroups,initial.tabGroups,name);assert.equal(area.inspect().storageMeta,undefined,name);
    await area.set({tabGroups:[{...initial.tabGroups[0],session:validSessionFixture()}]});
    assert.equal((await runStorageMigration(area)).migrated,true,name);assert.equal(area.inspect().shortcuts[0].id,'keep',name);assert.equal(area.inspect().deferred[0].id,'later',name);
  }
});
