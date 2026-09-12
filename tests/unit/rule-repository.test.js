'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuleRepository } = require('../../extension/src/storage/rule-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
  };
}

test('rule repository creates, updates and removes validated rules', async () => {
  const repository = createRuleRepository(memoryStorage(), { id: () => 'r1' });
  const created = await repository.create({ workspaceId: 'w1', pattern: 'github.com' });
  assert.equal(created.mode, 'suggest');
  assert.equal(created.enabled, true);
  await repository.update('r1', { mode: 'auto', enabled: false });
  assert.deepEqual(await repository.get('r1'), { ...created, mode: 'auto', enabled: false });
  await repository.remove('r1');
  assert.equal((await repository.list()).length, 0);
});

test('rule repository rejects invalid patterns and modes', async () => {
  const repository = createRuleRepository(memoryStorage());
  await assert.rejects(() => repository.create({ workspaceId: 'w1', pattern: 'javascript:*' }), /invalid/i);
  await assert.rejects(() => repository.create({ workspaceId: 'w1', pattern: 'example.com', mode: 'close' }), /mode/i);
});
