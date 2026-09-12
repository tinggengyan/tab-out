'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrashRepository } = require('../../extension/src/storage/trash-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
    inspect() { return structuredClone(state); },
  };
}

test('trash repository stores deleted entities with a purge date', async () => {
  const storage = memoryStorage();
  const trash = createTrashRepository(storage, {
    now: () => new Date('2026-08-10T00:00:00.000Z'),
    id: () => 'trash-1',
    retentionDays: 30,
  });

  const item = await trash.add('tabGroup', 'group-1', { id: 'group-1', tabs: [] });
  assert.equal(item.deletedAt, '2026-08-10T00:00:00.000Z');
  assert.equal(item.purgeAt, '2026-09-09T00:00:00.000Z');
  assert.equal((await trash.list())[0].payload.id, 'group-1');
});

test('trash repository restores and removes an item atomically', async () => {
  const storage = memoryStorage();
  const trash = createTrashRepository(storage, { id: () => 'trash-1' });
  await trash.add('deferred', 'd1', { id: 'd1', title: 'Read' });
  const restored = await trash.restore('trash-1');
  assert.equal(restored.payload.title, 'Read');
  assert.equal((await trash.list()).length, 0);
});

test('trash repository purges only expired items', async () => {
  const storage = memoryStorage({ trashV2: [
    { id: 'old', purgeAt: '2026-08-09T00:00:00.000Z' },
    { id: 'new', purgeAt: '2026-08-11T00:00:00.000Z' },
  ] });
  const trash = createTrashRepository(storage, { now: () => new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(await trash.purgeExpired(), 1);
  assert.deepEqual((await trash.list()).map(item => item.id), ['new']);
});

test('trash repository can permanently delete one item or clear all', async () => {
  const storage = memoryStorage();
  let nextId = 0;
  const trash = createTrashRepository(storage, { id: () => `trash-${++nextId}` });
  await trash.add('deferred', 'd1', {});
  await trash.add('tabGroup', 'g1', {});
  await trash.remove('trash-1');
  assert.deepEqual((await trash.list()).map(item => item.id), ['trash-2']);
  await trash.clear();
  assert.equal((await trash.list()).length, 0);
});

test('trash repository resolves retention at deletion time', async () => {
  let days = 7;
  const trash = createTrashRepository(memoryStorage(), {
    retentionDays: async () => days,
    id: () => 'trash-dynamic',
    now: () => new Date('2026-08-10T00:00:00.000Z'),
  });
  const first = await trash.add('workspace', 'w1', {});
  assert.equal(first.purgeAt, '2026-08-17T00:00:00.000Z');
  days = 30;
  const second = await trash.add('workspace', 'w2', {});
  assert.equal(second.purgeAt, '2026-09-09T00:00:00.000Z');
});
