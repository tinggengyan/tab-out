'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollectionTransferService } = require('../../extension/src/services/collection-transfer-service.js');
const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
  };
}

async function fixture() {
  const workspaceRepository = createWorkspaceRepository(memoryStorage(), { id: (() => { let n = 0; return () => `id-${++n}`; })() });
  const workspace = await workspaceRepository.create({ name: 'Project', entries: [{ url: 'https://a.example', title: 'A' }, { url: 'https://b.example', title: 'B' }] });
  let groups = [{ id: 'group-1', tabs: [{ url: 'https://existing.example', title: 'Existing' }], session: { stale: true } }];
  const service = createCollectionTransferService({ workspaceRepository, getGroups: async () => structuredClone(groups), saveGroups: async next => { groups = structuredClone(next); } });
  return { workspaceRepository, workspace, service, groups: () => groups };
}

test('moves workspace entries into a collected group and invalidates its stale session', async () => {
  const value = await fixture();
  await value.service.workspaceToGroup(value.workspace.id, [value.workspace.entries[0].id], 'group-1');
  assert.deepEqual(value.groups()[0].tabs.map(tab => tab.title), ['Existing', 'A']);
  assert.equal(value.groups()[0].session, undefined);
  assert.deepEqual((await value.workspaceRepository.get(value.workspace.id)).entries.map(entry => entry.title), ['B']);
});

test('copies collected tabs into a workspace without changing the group', async () => {
  const value = await fixture();
  await value.service.groupToWorkspace('group-1', [0], value.workspace.id, { copy: true });
  assert.equal(value.groups()[0].tabs.length, 1);
  assert.deepEqual((await value.workspaceRepository.get(value.workspace.id)).entries.map(entry => entry.title), ['A', 'B', 'Existing']);
});

test('moves collected tabs into a workspace and removes an empty group', async () => {
  const value = await fixture();
  await value.service.groupToWorkspace('group-1', [0], value.workspace.id);
  assert.deepEqual(value.groups(), []);
});
