(function initTrashRepository(globalScope) {
  'use strict';
  function createTrashRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'trashV2';
    const retentionDays = options.retentionDays ?? 30;
    const now = options.now || (() => new Date());
    const createId = options.id || (() => globalScope.crypto.randomUUID());

    async function list() {
      const stored = await storageArea.get(key);
      return Array.isArray(stored[key]) ? stored[key] : [];
    }

    async function write(items) {
      await storageArea.set({ [key]: items });
    }

    return {
      list,
      async add(entityType, entityId, payload) {
        const deletedAt = now();
        const resolvedRetentionDays = typeof retentionDays === 'function' ? await retentionDays() : retentionDays;
        const purgeAt = new Date(deletedAt.getTime() + resolvedRetentionDays * 86400000);
        const item = {
          id: createId(), entityType, entityId, payload,
          deletedAt: deletedAt.toISOString(),
          purgeAt: purgeAt.toISOString(),
        };
        await write([item, ...(await list())]);
        return item;
      },
      async restore(id) {
        const items = await list();
        const item = items.find(entry => entry.id === id);
        if (!item) throw new Error('Trash item not found');
        await write(items.filter(entry => entry.id !== id));
        return item;
      },
      async remove(id) {
        await write((await list()).filter(entry => entry.id !== id));
      },
      async clear() { await write([]); },
      async purgeExpired() {
        const items = await list();
        const currentTime = now().getTime();
        const remaining = items.filter(item => new Date(item.purgeAt).getTime() > currentTime);
        await write(remaining);
        return items.length - remaining.length;
      },
    };
  }
  const api = { createTrashRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
