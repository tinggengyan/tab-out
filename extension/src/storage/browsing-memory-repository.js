(function initBrowsingMemoryRepository(globalScope) {
  'use strict';
  const MAX_TEXT_LENGTH = 30000;
  const MAX_IMPORT_RECORDS = 5000;
  const fail = code => Object.assign(new Error(code), { code });
  function normalizeMemoryUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) throw fail('invalid_url');
      return url.href;
    } catch { throw fail('invalid_url'); }
  }
  function normalizeMemoryRecord(input, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_memory_record');
    const url = normalizeMemoryUrl(input.url);
    const visitedAt = input.visitedAt === undefined ? now : Number(input.visitedAt);
    if (!Number.isFinite(visitedAt) || visitedAt < 0 || visitedAt > now + 300000) throw fail('invalid_memory_date');
    if (input.text !== undefined && typeof input.text !== 'string') throw fail('invalid_memory_text');
    const text = String(input.text || '').replace(/\u0000/g, '').slice(0, MAX_TEXT_LENGTH);
    const capturedAt = text ? (input.capturedAt == null ? visitedAt : Number(input.capturedAt)) : null;
    if (capturedAt !== null && (!Number.isFinite(capturedAt) || capturedAt < 0 || capturedAt > now + 300000)) throw fail('invalid_memory_date');
    const source = ['capture', 'history', 'import'].includes(input.source) ? input.source : text ? 'capture' : 'history';
    return { url, title: String(input.title || '').replace(/\u0000/g, '').slice(0, 1024), text, visitedAt, capturedAt, source,
      ...(input.truncated || String(input.text || '').length > MAX_TEXT_LENGTH ? { truncated: true } : {}) };
  }
  function mergeRecord(existing, input, createId) {
    const useContent = Boolean(input.text) && (!existing?.text || (input.capturedAt || 0) >= (existing.capturedAt || 0));
    return {
      id: existing?.id || createId(), url: input.url,
      title: input.title || existing?.title || input.url,
      text: useContent ? input.text : existing?.text || '',
      visitedAt: Math.max(input.visitedAt, existing?.visitedAt || 0),
      capturedAt: useContent ? input.capturedAt : existing?.capturedAt || null,
      source: useContent ? input.source : existing?.text ? existing.source : input.source,
      ...(useContent ? input.truncated ? { truncated: true } : {} : existing?.truncated ? { truncated: true } : {}),
    };
  }
  function byteSize(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  const sortRecords = records => records.sort((a, b) => b.visitedAt - a.visitedAt || a.id.localeCompare(b.id));

  function createIndexedDBStore(indexedDB, dbName) {
    if (!indexedDB?.open) throw new TypeError('IndexedDB is required');
    let openPromise;
    function open() {
      if (openPromise) return openPromise;
      openPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('documents')) {
            const documents = db.createObjectStore('documents', { keyPath: 'id' });
            documents.createIndex('url', 'url', { unique: true });
          }
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        request.onerror = () => { openPromise = null; reject(fail('memory_storage_unavailable')); };
        request.onblocked = () => { openPromise = null; reject(fail('memory_storage_blocked')); };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); openPromise = null; };
          resolve(db);
        };
      });
      return openPromise;
    }
    return {
      async run(mode, action) {
        const db = await open();
        return new Promise((resolve, reject) => {
          let result, actionError;
          const tx = db.transaction(['documents', 'meta'], mode);
          const docs = tx.objectStore('documents'), meta = tx.objectStore('meta');
          const request = value => new Promise((done, rejectRequest) => {
            value.onsuccess = () => done(value.result);
            value.onerror = () => rejectRequest(fail('memory_storage_failed'));
          });
          const port = {
            all: () => request(docs.getAll()),
            get: id => request(docs.get(id)),
            byUrl: url => request(docs.index('url').get(url)),
            put: record => request(docs.put(record)),
            remove: id => request(docs.delete(id)),
            clear: () => request(docs.clear()),
            getRevision: async () => Number(await request(meta.get('revision'))) || 0,
            setRevision: value => request(meta.put(value, 'revision')),
          };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(actionError || fail('memory_storage_failed'));
          tx.onabort = () => reject(actionError || fail('memory_storage_failed'));
          Promise.resolve().then(() => action(port)).then(value => { result = value; }).catch(error => {
            actionError = error;
            try { tx.abort(); } catch { reject(error); }
          });
        });
      },
    };
  }

  // Injectable transaction adapter for deterministic Node tests. Production always uses IndexedDB.
  function createMemoryBrowsingMemoryStore() {
    let documents = new Map(), revision = 0, queue = Promise.resolve();
    return {
      run(mode, action) {
        const run = queue.then(async () => {
          const next = new Map([...documents].map(([id, value]) => [id, structuredClone(value)]));
          let nextRevision = revision;
          const value = await action({
            async all() { return [...next.values()].map(item => structuredClone(item)); },
            async get(id) { return structuredClone(next.get(id)); },
            async byUrl(url) { return structuredClone([...next.values()].find(item => item.url === url)); },
            async put(record) { next.set(record.id, structuredClone(record)); },
            async remove(id) { next.delete(id); },
            async clear() { next.clear(); },
            async getRevision() { return nextRevision; },
            async setRevision(value) { nextRevision = value; },
          });
          if (mode === 'readwrite') { documents = next; revision = nextRevision; }
          return structuredClone(value);
        });
        queue = run.catch(() => {});
        return run;
      },
    };
  }
  function createBrowsingMemoryRepository(options = {}) {
    const { now = () => Date.now(), dbName = 'tab-out-browsing-memory-v1' } = options;
    const store = options.store || createIndexedDBStore(options.indexedDB || globalScope.indexedDB, dbName);
    let queue = Promise.resolve();
    function write(action, shouldIncrement = () => true) {
      const run = queue.then(() => store.run('readwrite', async port => {
        const result = await action(port);
        if (shouldIncrement(result)) await port.setRevision(await port.getRevision() + 1);
        return result;
      }));
      queue = run.catch(() => {});
      return run;
    }
    const createId = () => globalScope.crypto.randomUUID();
    return {
      async list({ since = 0, until = Infinity, limit = 5000 } = {}) {
        await queue;
        return store.run('readonly', async port => sortRecords((await port.all()).filter(record => record.visitedAt >= since && record.visitedAt <= until)).slice(0, Math.max(0, Math.min(Number(limit) || 5000, 5000))));
      },
      async getMany(ids) {
        await queue;
        const unique = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])].slice(0, 5000);
        return store.run('readonly', async port => (await Promise.all(unique.map(id => port.get(id)))).filter(Boolean));
      },
      async upsert(input) {
        const record = normalizeMemoryRecord(input, now());
        return write(async port => {
          const result = mergeRecord(await port.byUrl(record.url), record, createId);
          await port.put(result);
          return result;
        });
      },
      async importRecords(records) {
        if (!Array.isArray(records) || records.length > MAX_IMPORT_RECORDS) throw fail('invalid_memory_import');
        const normalized = records.map(record => normalizeMemoryRecord(record, now()));
        if (byteSize(normalized) > 32 * 1024 * 1024) throw fail('memory_import_too_large');
        return write(async port => {
          let added = 0, updated = 0;
          for (const record of normalized) {
            const existing = await port.byUrl(record.url);
            await port.put(mergeRecord(existing, record, createId));
            if (existing) updated++; else added++;
          }
          return { added, updated, skipped: 0 };
        });
      },
      async remove(ids) {
        const unique = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
        return write(async port => {
          let removed = 0;
          for (const id of unique) if (await port.get(id)) { await port.remove(id); removed++; }
          return { removed };
        });
      },
      async clear() { return write(async port => { const removed = (await port.all()).length; await port.clear(); return { removed }; }); },
      async prune({ retentionDays = 90, maxRecords = 5000, maxBytes = 32 * 1024 * 1024 } = {}) {
        if (!Number.isFinite(retentionDays) || retentionDays < 1 || !Number.isFinite(maxRecords) || maxRecords < 0 || !Number.isFinite(maxBytes) || maxBytes < 0) throw fail('invalid_memory_budget');
        return write(async port => {
          const all = sortRecords(await port.all());
          const retained = all.filter(record => record.visitedAt >= now() - retentionDays * 86400000).slice(0, Math.floor(maxRecords));
          let bytes = retained.reduce((sum, record) => sum + byteSize(record), 0);
          while (bytes > maxBytes && retained.length) bytes -= byteSize(retained.pop());
          const keep = new Set(retained.map(record => record.id));
          for (const record of all) if (!keep.has(record.id)) await port.remove(record.id);
          return { removed: all.length - retained.length, remaining: retained.length, bytes };
        }, result => result.removed > 0);
      },
      async stats() {
        await queue;
        return store.run('readonly', async port => {
          const all = await port.all(), withContent = all.filter(record => Boolean(record.text)).length;
          return { total: all.length, withContent, metadataOnly: all.length - withContent,
            bytes: all.reduce((sum, record) => sum + byteSize(record), 0),
            lastCapturedAt: all.reduce((last, record) => Math.max(last, record.capturedAt || 0), 0) || null,
            oldestVisitedAt: all.reduce((oldest, record) => Math.min(oldest, record.visitedAt), Infinity) === Infinity ? null : Math.min(...all.map(record => record.visitedAt)) };
        });
      },
      async revision() { await queue; return store.run('readonly', port => port.getRevision()); },
    };
  }
  const api = { createBrowsingMemoryRepository, createMemoryBrowsingMemoryStore, normalizeMemoryRecord, normalizeMemoryUrl, MEMORY_MAX_TEXT_LENGTH: MAX_TEXT_LENGTH };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
