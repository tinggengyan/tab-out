'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCollectedStore, migrateLegacy, collectableTabs, restoreTargets,
} = require('../../extension/lib/collected-store.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => key in state).map(key => [key, structuredClone(state[key])]));
    },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
    inspect() { return structuredClone(state); },
  };
}

function sequence(prefix) { let n = 0; return () => `${prefix}${++n}`; }
const page = (url, title = url) => ({ url, title });

test('add then list returns newest first', async () => {
  const storage = memoryStorage();
  const times = ['2026-11-11T01:00:00.000Z', '2026-11-11T02:00:00.000Z'];
  const store = createCollectedStore(storage, { now: () => times.shift(), id: sequence('c') });
  await store.add({ tabs: [page('https://a.test/')] });
  const second = await store.add({ name: 'GitHub', tabs: [page('https://github.com/x')] });
  assert.deepEqual(second, { id: 'c2', savedAt: '2026-11-11T02:00:00.000Z', name: 'GitHub', tabs: [page('https://github.com/x')] });
  assert.deepEqual((await store.list()).map(record => record.id), ['c2', 'c1']);
  assert.ok(Array.isArray(storage.inspect().collectedGroupsV3));
});

test('takeAll removes the record', async () => {
  const store = createCollectedStore(memoryStorage(), { id: sequence('c') });
  await store.add({ tabs: [page('https://a.test/'), page('https://b.test/')] });
  const taken = await store.takeAll('c1');
  assert.equal(taken.tabs.length, 2);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.takeAll('missing'), null);
});

test('takeTab removes one page and drops an empty record', async () => {
  const store = createCollectedStore(memoryStorage(), { id: sequence('c') });
  await store.add({ tabs: [page('https://a.test/'), page('https://b.test/')] });
  assert.deepEqual(await store.takeTab('c1', 0), page('https://a.test/'));
  assert.deepEqual((await store.list())[0].tabs, [page('https://b.test/')]);
  assert.deepEqual(await store.takeTab('c1', 0), page('https://b.test/'));
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.takeTab('c1', 0), null);
});

test('remove deletes a record and returns it', async () => {
  const store = createCollectedStore(memoryStorage(), { id: sequence('c') });
  await store.add({ tabs: [page('https://a.test/')] });
  assert.equal((await store.remove('c1')).id, 'c1');
  assert.equal(await store.remove('c1'), null);
});

test('collect excludes pinned tabs', () => {
  const tabs = [{ id: 1, url: 'https://a.test/', pinned: true }, { id: 2, url: 'https://b.test/', pinned: false }];
  assert.deepEqual(collectableTabs(tabs).map(tab => tab.id), [2]);
});

test('restoreAll skips urls already open', () => {
  const a = page('https://a.test/'), b = page('https://b.test/');
  assert.deepEqual(restoreTargets({ tabs: [a, b] }, new Set([a.url])), [b]);
});

const workspaces = [
  { id: 'w1', name: 'Payments', createdAt: '2026-11-01T00:00:00.000Z', sessionSavedAt: '2026-11-02T00:00:00.000Z',
    entries: [{ id: 'e1', url: 'https://pay.test/a', title: 'A' }, { id: 'e2', url: 'https://pay.test/b', title: 'B' }] },
  { id: 'w2', name: '', updatedAt: '2026-11-03T00:00:00.000Z', entries: [{ id: 'e3', url: 'https://docs.test/', title: 'Docs' }] },
  { id: 'w3', name: 'Empty', entries: [] },
];

test('migrateLegacy converts workspacesV2 and leftover tabGroups once', async () => {
  const storage = memoryStorage({
    workspacesV2: workspaces,
    tabGroups: [{ id: 'g1', savedAt: '2026-10-01T00:00:00.000Z', tabs: [page('https://old.test/')] }],
  });
  const result = await migrateLegacy(storage, { now: () => '2026-11-11T00:00:00.000Z', id: sequence('m') });
  assert.equal(result.migrated, 3);
  const state = storage.inspect();
  assert.deepEqual(state.workspacesV2, workspaces, 'workspacesV2 must stay untouched');
  assert.equal(state.tabGroups.length, 1, 'tabGroups must stay untouched');
  const records = state.collectedGroupsV3;
  assert.deepEqual(records.map(record => record.sourceId).sort(), ['tabGroup:g1', 'workspace:w1', 'workspace:w2']);
  const payments = records.find(record => record.sourceId === 'workspace:w1');
  assert.equal(payments.name, 'Payments');
  assert.equal(payments.savedAt, '2026-11-02T00:00:00.000Z');
  assert.deepEqual(payments.tabs, [page('https://pay.test/a', 'A'), page('https://pay.test/b', 'B')]);
  assert.equal(records.find(record => record.sourceId === 'workspace:w2').name, undefined);
  assert.deepEqual(state.soulMigrationV1, { migratedAt: '2026-11-11T00:00:00.000Z', count: 3 });
  assert.equal((await migrateLegacy(storage)).migrated, 0);
});

test('migrateLegacy is idempotent by sourceId even without the flag', async () => {
  const storage = memoryStorage({ workspacesV2: workspaces });
  await migrateLegacy(storage, { id: sequence('m') });
  const state = storage.inspect();
  delete state.soulMigrationV1;
  const again = memoryStorage(state);
  assert.equal((await migrateLegacy(again, { id: sequence('n') })).migrated, 0);
  assert.equal(again.inspect().collectedGroupsV3.length, 2);
});

test('migrateLegacy keeps records the user already stashed in v3', async () => {
  const storage = memoryStorage({ workspacesV2: workspaces.slice(0, 1), collectedGroupsV3: [{ id: 'mine', savedAt: '2026-11-11T05:00:00.000Z', tabs: [page('https://mine.test/')] }] });
  await migrateLegacy(storage, { id: sequence('m') });
  assert.deepEqual(storage.inspect().collectedGroupsV3.map(record => record.id).sort(), ['m1', 'mine']);
});

test('merge appends imported records and skips ones already present by id or sourceId', async () => {
  const store = createCollectedStore(memoryStorage({ collectedGroupsV3: [
    { id: 'c1', savedAt: '2026-11-10T00:00:00.000Z', tabs: [page('https://a.test/')] },
    { id: 'c2', savedAt: '2026-11-09T00:00:00.000Z', sourceId: 'workspace:w1', tabs: [page('https://b.test/')] },
  ] }));
  const added = await store.merge([
    { id: 'c1', savedAt: '2026-11-10T00:00:00.000Z', tabs: [page('https://a.test/')] },
    { id: 'x9', savedAt: '2026-11-09T00:00:00.000Z', sourceId: 'workspace:w1', tabs: [page('https://b.test/')] },
    { id: 'c3', savedAt: '2026-11-08T00:00:00.000Z', tabs: [page('https://c.test/')] },
  ]);
  assert.equal(added, 1);
  assert.deepEqual((await store.list()).map(record => record.id), ['c1', 'c2', 'c3']);
});

test('get returns one record and replaceTabs keeps only the given pages', async () => {
  const store = createCollectedStore(memoryStorage(), { id: sequence('c') });
  await store.add({ name: 'Mixed', tabs: [page('https://a.test/'), page('javascript:void(0)')] });
  assert.equal((await store.get('c1')).name, 'Mixed');
  assert.equal(await store.get('missing'), null);
  await store.replaceTabs('c1', [page('javascript:void(0)')]);
  assert.deepEqual((await store.get('c1')).tabs, [page('javascript:void(0)')]);
  await store.replaceTabs('c1', []);
  assert.equal(await store.get('c1'), null, 'an emptied record is removed');
});
