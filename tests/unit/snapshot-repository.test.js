'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotRepository } = require('../../extension/src/storage/snapshot-repository.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
    inspect() { return structuredClone(state); },
  };
}

test('snapshot repository skips consecutive duplicate fingerprints', async () => {
  const repository = createSnapshotRepository(memoryStorage());
  assert.equal(await repository.add({ id: 'one', fingerprint: 'same', capturedAt: '2026-08-10T00:00:00Z' }), true);
  assert.equal(await repository.add({ id: 'two', fingerprint: 'same', capturedAt: '2026-08-10T01:00:00Z' }), false);
  assert.deepEqual((await repository.list()).map(item => item.id), ['one']);
});

test('snapshot repository retains the configured number of automatic snapshots', async () => {
  const repository = createSnapshotRepository(memoryStorage(), { automaticLimit: 3 });
  for (let index = 1; index <= 5; index += 1) {
    await repository.add({ id: `s${index}`, type: 'automatic', fingerprint: `f${index}`, capturedAt: `2026-08-0${index}T00:00:00Z` });
  }
  assert.deepEqual((await repository.list()).map(item => item.id), ['s5', 's4', 's3']);
});

test('manual snapshots are retained independently from the automatic limit', async () => {
  const repository = createSnapshotRepository(memoryStorage(), { automaticLimit: 1 });
  await repository.add({ id: 'manual', type: 'manual', fingerprint: 'm', capturedAt: '2026-08-01T00:00:00Z' });
  await repository.add({ id: 'auto1', type: 'automatic', fingerprint: 'a1', capturedAt: '2026-08-02T00:00:00Z' });
  await repository.add({ id: 'auto2', type: 'automatic', fingerprint: 'a2', capturedAt: '2026-08-03T00:00:00Z' });
  assert.deepEqual((await repository.list()).map(item => item.id), ['auto2', 'manual']);
});

test('manual snapshots are retained even when they match the latest automatic snapshot', async () => {
  const repository = createSnapshotRepository(memoryStorage(), { automaticLimit: 3 });
  await repository.add({ id: 'auto', type: 'automatic', fingerprint: 'same', capturedAt: '2026-08-01T00:00:00Z' });
  assert.equal(await repository.add({ id: 'manual', type: 'manual', fingerprint: 'same', capturedAt: '2026-08-01T00:01:00Z', note: 'Important checkpoint' }), true);
  assert.deepEqual((await repository.list()).map(item => item.id), ['manual', 'auto']);
});

test('snapshot repository gets and removes snapshots by id', async () => {
  const repository = createSnapshotRepository(memoryStorage());
  await repository.add({ id: 'one', fingerprint: '1' });
  assert.equal((await repository.get('one')).id, 'one');
  await repository.remove('one');
  assert.equal(await repository.get('one'), null);
});

test('snapshot repository resolves a dynamic automatic retention limit', async () => {
  const storage = memoryStorage();
  let limit = 1;
  const repository = createSnapshotRepository(storage, { automaticLimit: async () => limit });
  await repository.add({ id: 'first', type: 'automatic', fingerprint: 'first', capturedAt: '2026-01-01T00:00:00.000Z' });
  await repository.add({ id: 'second', type: 'automatic', fingerprint: 'second', capturedAt: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual((await repository.list()).map(item => item.id), ['second']);
  limit = 2;
  await repository.add({ id: 'third', type: 'automatic', fingerprint: 'third', capturedAt: '2026-01-03T00:00:00.000Z' });
  assert.deepEqual((await repository.list()).map(item => item.id), ['third', 'second']);
});

test('snapshot repository can prune automatic history by age without deleting manual snapshots', async () => {
  const storage = memoryStorage();
  const repository = createSnapshotRepository(storage, { automaticLimit: Infinity });
  await repository.add({ id: 'old-auto', type: 'automatic', fingerprint: 'old-auto', capturedAt: '2026-01-01T00:00:00.000Z' });
  await repository.add({ id: 'old-manual', type: 'manual', fingerprint: 'old-manual', capturedAt: '2026-01-01T01:00:00.000Z' });
  await repository.add({ id: 'new-auto', type: 'automatic', fingerprint: 'new-auto', capturedAt: '2026-04-01T00:00:00.000Z' });
  await repository.prune({ automaticDays: 30, now: Date.parse('2026-04-02T00:00:00.000Z') });
  assert.deepEqual((await repository.list()).map(item => item.id), ['new-auto', 'old-manual']);
});

test('snapshot repository evicts oldest automatic sessions to stay under its capacity budget', async () => {
  const repository = createSnapshotRepository(memoryStorage(), { automaticLimit: Infinity, maxBytes: 420 });
  for (let index = 1; index <= 5; index += 1) {
    await repository.add({ id: `s${index}`, type: 'automatic', fingerprint: `f${index}`, capturedAt: `2026-08-0${index}T00:00:00Z`, note: 'x'.repeat(100) });
  }
  const retained = await repository.list();
  assert.ok(retained.length < 5);
  assert.equal(retained[0].id, 's5');
});

test('snapshot repository reports capacity exhaustion instead of silently deleting manual sessions', async () => {
  const repository = createSnapshotRepository(memoryStorage(), { automaticLimit: Infinity, maxBytes: 100 });
  await assert.rejects(() => repository.add({ id: 'manual', type: 'manual', fingerprint: 'm', capturedAt: '2026-08-01T00:00:00Z', note: 'x'.repeat(200) }), /capacity/i);
});
