'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationRepository } = require('../../extension/src/storage/operation-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
    inspect() { return structuredClone(state); },
  };
}

test('operation repository stores newest operations first and updates by id', async () => {
  const storage = memoryStorage();
  const repository = createOperationRepository(storage, { maxEntries: 3 });
  await repository.put({ id: 'one', status: 'pending' });
  await repository.put({ id: 'two', status: 'complete' });
  await repository.put({ id: 'one', status: 'complete' });

  assert.equal((await repository.get('one')).status, 'complete');
  assert.deepEqual((await repository.list()).map(item => item.id), ['one', 'two']);
});

test('operation repository prunes entries beyond its retention limit', async () => {
  const storage = memoryStorage();
  const repository = createOperationRepository(storage, { maxEntries: 2 });
  await repository.put({ id: 'one' });
  await repository.put({ id: 'two' });
  await repository.put({ id: 'three' });
  assert.deepEqual((await repository.list()).map(item => item.id), ['three', 'two']);
});

test('operation repository reads the legacy key and migrates on the next write', async () => {
  const storage = memoryStorage({ operations: [{ id: 'legacy', status: 'complete' }] });
  const repository = createOperationRepository(storage);
  assert.equal((await repository.list())[0].id, 'legacy');
  await repository.put({ id: 'new', status: 'complete' });
  assert.deepEqual(storage.inspect().operationsV2.map(item => item.id), ['new', 'legacy']);
});
