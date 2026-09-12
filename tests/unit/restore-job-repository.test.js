'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRestoreJobRepository } = require('../../extension/src/storage/restore-job-repository.js');

function memoryStorage() {
  let state = {};
  return { async get(key) { return { [key]: structuredClone(state[key]) }; }, async set(update) { state = { ...state, ...structuredClone(update) }; } };
}

test('restore jobs persist before work and can resume after a page restart', async () => {
  let id = 0;
  const storage = memoryStorage();
  const first = createRestoreJobRepository(storage, { id: () => `job-${++id}`, now: () => '2026-08-10T00:00:00Z' });
  const job = await first.create({ id: 'session', windows: [] }, { mode: 'new-window' });
  assert.equal(job.status, 'running');
  const afterRestart = createRestoreJobRepository(storage);
  assert.equal((await afterRestart.latestResumable()).id, job.id);
});

test('completed and cancelled restore jobs are not resumable', async () => {
  const storage = memoryStorage();
  const repository = createRestoreJobRepository(storage, { id: () => 'job', now: () => '2026-08-10T00:00:00Z' });
  await repository.create({ id: 'session', windows: [] });
  await repository.update('job', { status: 'complete' });
  assert.equal(await repository.latestResumable(), null);
});
