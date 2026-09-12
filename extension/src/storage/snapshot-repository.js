(function initSnapshotRepository(globalScope) {
  'use strict';
  function createSnapshotRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'snapshotsV2';
    const automaticLimit = options.automaticLimit ?? 3;
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;

    async function resolveAutomaticLimit() {
      const value = typeof automaticLimit === 'function' ? await automaticLimit() : automaticLimit;
      return value === Infinity ? Infinity : Math.max(0, Number(value) || 0);
    }

    async function list() {
      const stored = await storageArea.get(key);
      const values = Array.isArray(stored[key]) ? stored[key] : [];
      return values.sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')));
    }

    return {
      list,
      async get(id) { return (await list()).find(item => item.id === id) || null; },
      async add(session) {
        const current = await list();
        const incomingType = session.type || 'automatic';
        const latestType = current[0]?.type || 'automatic';
        if (incomingType === 'automatic' && latestType === 'automatic' && current[0]?.fingerprint && current[0].fingerprint === session.fingerprint) return false;
        const combined = [session, ...current.filter(item => item.id !== session.id)];
        const limit = await resolveAutomaticLimit();
        let automaticSeen = 0;
        const retained = combined.filter(item => {
          if ((item.type || 'automatic') !== 'automatic') return true;
          automaticSeen += 1;
          return automaticSeen <= limit;
        });
        while (new TextEncoder().encode(JSON.stringify(retained)).byteLength > maxBytes) {
          let oldestAutomatic = -1;
          for (let index = retained.length - 1; index >= 0; index -= 1) {
            if ((retained[index].type || 'automatic') === 'automatic') { oldestAutomatic = index; break; }
          }
          if (oldestAutomatic < 0) throw new Error('Snapshot capacity exhausted; export or delete manual snapshots');
          retained.splice(oldestAutomatic, 1);
        }
        if (!retained.some(item => item.id === session.id)) return false;
        await storageArea.set({ [key]: retained });
        return true;
      },
      async remove(id) {
        await storageArea.set({ [key]: (await list()).filter(item => item.id !== id) });
      },
      async prune({ automaticDays, now = Date.now() } = {}) {
        if (!Number.isFinite(automaticDays) || automaticDays < 0) return;
        const cutoff = now - automaticDays * 86400000;
        const retained = (await list()).filter(item =>
          (item.type || 'automatic') !== 'automatic' || Date.parse(item.capturedAt || 0) >= cutoff
        );
        await storageArea.set({ [key]: retained });
      },
    };
  }
  const api = { createSnapshotRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
