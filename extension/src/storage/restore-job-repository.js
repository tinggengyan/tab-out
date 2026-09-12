(function initRestoreJobRepository(globalScope) {
  'use strict';
  function createRestoreJobRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'restoreJobsV2';
    const createId = options.id || (() => globalScope.crypto.randomUUID());
    const now = options.now || (() => new Date().toISOString());
    async function list() {
      const stored = await storageArea.get(key);
      return Array.isArray(stored[key]) ? stored[key] : [];
    }
    async function write(items) { await storageArea.set({ [key]: items.slice(0, 20) }); }
    return {
      list,
      async create(session, input = {}) {
        const timestamp = now();
        const job = { id: createId(), status: 'running', createdAt: timestamp, updatedAt: timestamp, mode: input.mode || 'new-window', session };
        await write([job, ...(await list())]);
        return job;
      },
      async update(id, patch) {
        const jobs = await list();
        const index = jobs.findIndex(job => job.id === id);
        if (index < 0) throw new Error('Restore job not found');
        jobs[index] = { ...jobs[index], ...patch, updatedAt: now() };
        await write(jobs);
        return jobs[index];
      },
      async latestResumable() {
        return (await list()).find(job => ['running', 'partially_failed'].includes(job.status)) || null;
      },
    };
  }
  const api = { createRestoreJobRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
