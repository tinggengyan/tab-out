(function initOperationRepository(globalScope) {
  'use strict';
  function createOperationRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'operationsV2';
    const legacyKey = options.legacyKey || 'operations';
    const maxEntries = options.maxEntries || 100;

    async function list() {
      const stored = await storageArea.get(key);
      if (Array.isArray(stored[key])) return stored[key];
      const legacy = await storageArea.get(legacyKey);
      return Array.isArray(legacy[legacyKey]) ? legacy[legacyKey] : [];
    }

    return {
      async list() { return list(); },
      async get(id) { return (await list()).find(item => item.id === id) || null; },
      async put(operation) {
        if (!operation?.id) throw new TypeError('Operation id is required');
        const operations = await list();
        const next = [operation, ...operations.filter(item => item.id !== operation.id)].slice(0, maxEntries);
        await storageArea.set({ [key]: next });
        return operation;
      },
    };
  }
  const api = { createOperationRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
