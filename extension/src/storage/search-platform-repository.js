(function initSearchPlatformRepository(globalScope) {
  'use strict';

  const validateSearchPlatforms = typeof require === 'function'
    ? require('../services/platform-search-service.js').validateSearchPlatforms
    : globalScope.TabOutCore.validateSearchPlatforms;
  const storageQueues = new WeakMap();

  function commandSet(platform) {
    return new Set([platform.name, ...platform.aliases].map(value => value.normalize('NFKC').trim().toLowerCase()));
  }

  function createSearchPlatformRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'searchPlatformsV1';
    const lockManager = options.locks === undefined ? globalScope.navigator?.locks : options.locks;
    const lockName = `tab-out:${key}`;
    function withFallbackLock(task) {
      let queues = storageQueues.get(storageArea);
      if (!queues) { queues = new Map(); storageQueues.set(storageArea, queues); }
      const previous = queues.get(key) || Promise.resolve();
      const current = previous.catch(() => {}).then(task);
      queues.set(key, current);
      return current.finally(() => { if (queues.get(key) === current) queues.delete(key); });
    }
    function withLock(task) {
      return lockManager?.request ? lockManager.request(lockName, task) : withFallbackLock(task);
    }
    async function readValidated() {
      const stored = await storageArea.get(key);
      return validateSearchPlatforms(stored[key] === undefined ? [] : stored[key]);
    }
    async function list() {
      return readValidated();
    }
    return {
      list,
      async save(platforms, expectedPlatforms) {
        const normalized = validateSearchPlatforms(platforms);
        const expected = expectedPlatforms === undefined ? undefined : validateSearchPlatforms(expectedPlatforms);
        return withLock(async () => {
          const current = await readValidated();
          if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error(`${key}: stale configuration`);
          await storageArea.set({ [key]: normalized });
          return structuredClone(normalized);
        });
      },
      async previewImport(payload) {
        if (!payload || payload.version !== 1 || !Array.isArray(payload.platforms)) throw new Error('Unsupported platform import format');
        const existing = await list();
        const imported = validateSearchPlatforms(payload.platforms);
        const platforms = [...existing];
        const ids = new Set(existing.map(item => item.id));
        const commands = new Set(existing.flatMap(item => [...commandSet(item)]));
        const added = [];
        const conflicts = [];
        for (const platform of imported) {
          const incomingCommands = commandSet(platform);
          if (ids.has(platform.id) || [...incomingCommands].some(command => commands.has(command))) {
            conflicts.push(platform.name);
            continue;
          }
          platforms.push(platform);
          ids.add(platform.id);
          incomingCommands.forEach(command => commands.add(command));
          added.push(platform.name);
        }
        return { platforms: validateSearchPlatforms(platforms), added, conflicts };
      },
      async export() { return { version: 1, platforms: await list() }; },
    };
  }

  const api = { createSearchPlatformRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
