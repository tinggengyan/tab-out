'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
  };
}

test('workspace repository creates normalized workspaces with stable ordering', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), {
    id: () => `id-${++index}`,
    now: () => '2026-08-10T00:00:00.000Z',
  });
  const first = await repository.create({ name: 'Research' });
  const second = await repository.create({ name: 'Build' });
  assert.equal(first.name, 'Research');
  assert.deepEqual((await repository.list()).map(item => item.id), [first.id, second.id]);
  assert.deepEqual((await repository.list()).map(item => item.order), [0, 1]);
});

test('workspace repository updates metadata without replacing entries', async () => {
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => 'w1' });
  await repository.create({ name: 'Old', entries: [{ id: 'e1', url: 'https://a.example/', title: 'A' }] });
  const updated = await repository.update('w1', { name: 'New', color: '#123456' });
  assert.equal(updated.name, 'New');
  assert.equal(updated.entries.length, 1);
});

test('addEntries validates URLs and deduplicates by normalized URL', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const workspace = await repository.create({ name: 'Research' });
  await repository.addEntries(workspace.id, [
    { url: 'https://a.example', title: 'A' },
    { url: 'https://a.example/', title: 'Again' },
    { url: 'javascript:alert(1)', title: 'Bad' },
  ]);
  const updated = await repository.get(workspace.id);
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].url, 'https://a.example/');
});

test('moveEntry changes entry order deterministically', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const workspace = await repository.create({ name: 'Order' });
  await repository.addEntries(workspace.id, [
    { url: 'https://a.example', title: 'A' },
    { url: 'https://b.example', title: 'B' },
    { url: 'https://c.example', title: 'C' },
  ]);
  const before = await repository.get(workspace.id);
  await repository.moveEntry(workspace.id, before.entries[2].id, 0);
  assert.deepEqual((await repository.get(workspace.id)).entries.map(entry => entry.title), ['C', 'A', 'B']);
});

test('workspace repository deletes and returns the removed workspace', async () => {
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => 'w1' });
  await repository.create({ name: 'Delete me' });
  const removed = await repository.remove('w1');
  assert.equal(removed.name, 'Delete me');
  assert.equal((await repository.list()).length, 0);
});

test('transferEntry moves or copies an entry between workspaces', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const source = await repository.create({ name: 'Source', entries: [{ url: 'https://a.example', title: 'A' }] });
  const target = await repository.create({ name: 'Target' });
  const entryId = source.entries[0].id;
  await repository.transferEntry(source.id, target.id, entryId, { copy: true });
  assert.equal((await repository.get(source.id)).entries.length, 1);
  assert.equal((await repository.get(target.id)).entries.length, 1);
  await repository.transferEntry(source.id, target.id, entryId, { copy: false });
  assert.equal((await repository.get(source.id)).entries.length, 0);
  assert.equal((await repository.get(target.id)).entries.length, 1);
});

test('bulk transfer and removal update all entries in one repository operation', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const source = await repository.create({ name: 'Source', entries: [
    { url: 'https://a.example', title: 'A' }, { url: 'https://b.example', title: 'B' },
  ] });
  const target = await repository.create({ name: 'Target' });
  await repository.transferEntries(source.id, target.id, source.entries.map(entry => entry.id), { copy: true });
  assert.equal((await repository.get(source.id)).entries.length, 2);
  assert.equal((await repository.get(target.id)).entries.length, 2);
  await repository.removeEntries(source.id, source.entries.map(entry => entry.id));
  assert.equal((await repository.get(source.id)).entries.length, 0);
});

test('move changes workspace order deterministically', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const first = await repository.create({ name: 'First' });
  const second = await repository.create({ name: 'Second' });
  await repository.move(second.id, 0);
  assert.deepEqual((await repository.list()).map(item => item.id), [second.id, first.id]);
});

test('restore resolves id conflicts without overwriting an existing workspace', async () => {
  let index = 0;
  const repository = createWorkspaceRepository(memoryStorage(), { id: () => `id-${++index}` });
  const existing = await repository.create({ name: 'Existing' });
  const restored = await repository.restore({ ...existing, name: 'Restored', entries: [{ url: 'https://safe.example' }] });
  assert.notEqual(restored.id, existing.id);
  assert.deepEqual((await repository.list()).map(item => item.name), ['Existing', 'Restored']);
});
