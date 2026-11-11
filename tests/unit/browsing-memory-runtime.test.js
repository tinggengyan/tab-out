'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/src/storage/workspace-repository.js');
require('../../extension/src/services/entitlement-service.js');
const { createBrowsingMemoryRuntime, safeMemoryURL, excludedMemoryURL, memoryModelOrigin } = require('../../extension/src/services/browsing-memory-runtime.js');

function setup() {
  const now = Date.now();
  const data = {};
  const documents = new Map();
  const calls = [];
  let allow = true;
  const storage = { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])); },
    async set(values) { Object.assign(data, structuredClone(values)); }, async setAccessLevel(value) { calls.push(['access', value]); } };
  const tab = { id: 4, windowId: 1, url: 'https://docs.internal.example/article', incognito: false };
  const chromeApi = {
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path }, storage: { local: storage },
    permissions: { async contains() { return allow; } },
    scripting: { async unregisterContentScripts() { calls.push(['unregister']); }, async registerContentScripts(scripts) { calls.push(['register', scripts]); }, async executeScript() { calls.push(['inject']); } },
    tabs: { async get() { return tab; }, async query() { return [tab]; }, async sendMessage() {},
      async create(value) { calls.push(['create', value]); return { id: 6, ...value }; }, async update(id, value) { calls.push(['activate', id, value]); } },
    windows: { async update(id, value) { calls.push(['focus', id, value]); } },
    history: { async search(query) { calls.push(['history', query]); return [{ url: tab.url, title: 'Past title', lastVisitTime: now - 100 }]; } },
  };
  const repository = {
    async upsert(record) { const current = [...documents.values()].find(item => item.url === record.url); const result = { ...current, ...record, id: current?.id || `id-${documents.size}` };
      if (!record.text && current?.text) { result.text = current.text; result.capturedAt = current.capturedAt; }
      documents.set(result.id, result); return result; },
    async list() { return [...documents.values()]; }, async getMany(ids) { return ids.map(id => documents.get(id)).filter(Boolean); },
    async remove(ids) { ids.forEach(id => documents.delete(id)); }, async clear() { documents.clear(); },
    async prune() {}, async stats() { return { total: documents.size, withContent: [...documents.values()].filter(item => item.text).length }; },
    async importRecords(records) { for (const record of records) await this.upsert(record); return { added: records.length, updated: 0, skipped: 0 }; },
  };
  const modelClient = { async test(value) { calls.push(['test', value]); return { ok: true }; } };
  const searchService = { async search(value) { calls.push(['search', value]); return { results: [], warnings: [] }; }, async summarize(value) { calls.push(['summary', value]); return {}; } };
  const runtime = createBrowsingMemoryRuntime({ chromeApi, repository, modelClient, searchService, now: () => now });
  const trusted = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
  const content = { id: 'test-extension', url: tab.url, tab, frameId: 0 };
  return { runtime, chromeApi, data, calls, documents, now, tab, trusted, content, repository, searchService, setAllowed(value) { allow = value; } };
}

test('URL normalization rejects credentials and non-web URLs; exclusions match host boundaries', () => {
  assert.equal(safeMemoryURL('https://user:secret@site.example/a'), null);
  assert.equal(safeMemoryURL('javascript:alert(1)'), null);
  assert.equal(safeMemoryURL('https://docs.example/a#/workspace/2'), 'https://docs.example/a#/workspace/2');
  assert.equal(excludedMemoryURL('https://docs.example/a', ['example']), true);
  assert.equal(excludedMemoryURL('https://notexample/a', ['example']), false);
  assert.equal(memoryModelOrigin('https://models.example/v1'), 'https://models.example/*');
  assert.throws(() => memoryModelOrigin('https://models.example/v1?key=secret'));
});

test('initialization does not register a collector, import history or call a model by default', async () => {
  const f = setup(); await f.runtime.init();
  assert.equal((await f.runtime.action('status')).settings.recording, false);
  assert.ok(!f.calls.some(([name]) => ['register', 'history', 'test', 'search'].includes(name)));
  assert.deepEqual(f.calls.find(([name]) => name === 'access')[1], { accessLevel: 'TRUSTED_CONTEXTS' });
});

test('content messages cannot read settings or invoke privileged actions', async () => {
  const f = setup();
  f.data.browsingMemorySecretV1 = { apiKey: 'never-return-this', origin: 'https://models.example' };
  const result = await f.runtime.handleMessage({ type: 'browsing-memory', action: 'getSettings' }, f.content);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'unauthorized');
  assert.ok(!JSON.stringify(result).includes('never-return-this'));
  assert.equal((await f.runtime.handleMessage({ type: 'browsing-memory', action: 'clear' }, { ...f.trusted, id: 'other' })).ok, false);
});

test('capture requires opt-in, matching live top-frame URL and non-incognito sender', async () => {
  const f = setup(); const payload = { url: f.tab.url, text: 'Body evidence', title: 'A page', documentStartedAt: f.now - 100 };
  await f.runtime.capture(payload, f.content); assert.equal(f.documents.size, 0);
  await f.runtime.action('setRecording', { enabled: true });
  await f.runtime.capture({ ...payload, url: 'https://other.example/' }, f.content); assert.equal(f.documents.size, 0);
  await assert.rejects(f.runtime.capture(payload, { ...f.content, frameId: 1 }), { code: 'capture_not_allowed' });
  await assert.rejects(f.runtime.capture(payload, { ...f.content, tab: { ...f.tab, incognito: true } }), { code: 'capture_not_allowed' });
  await f.runtime.capture(payload, f.content); assert.equal(f.documents.size, 1);
  assert.equal([...f.documents.values()][0].text, 'Body evidence');
});

test('permission refusal does not enable recording and revocation prevents subsequent capture', async () => {
  const f = setup(); f.setAllowed(false);
  await assert.rejects(f.runtime.action('setRecording', { enabled: true }), { code: 'capture_permission_required' });
  f.setAllowed(true); await f.runtime.action('setRecording', { enabled: true }); f.setAllowed(false);
  assert.equal((await f.runtime.capture({ url: f.tab.url, text: 'private' }, f.content)).recording, false);
  await f.runtime.refreshCapture(); assert.equal((await f.runtime.action('getSettings')).recording, false);
  assert.equal(f.documents.size, 0);
});

test('delete suppresses re-capture by the same open document, clear pauses and blocks queued capture', async () => {
  const f = setup(); await f.runtime.action('setRecording', { enabled: true });
  const payload = { url: f.tab.url, text: 'saved', documentStartedAt: f.now - 100 };
  const row = await f.runtime.capture(payload, f.content);
  await f.runtime.action('remove', { ids: [row.id] });
  await f.runtime.capture(payload, f.content); assert.equal(f.documents.size, 0);
  await f.runtime.capture({ ...payload, documentStartedAt: f.now + 1 }, f.content); assert.equal(f.documents.size, 1);
  await Promise.all([f.runtime.action('clear'), f.runtime.capture(payload, f.content)]);
  assert.equal(f.documents.size, 0); assert.equal((await f.runtime.action('getSettings')).recording, false);
});

test('model secret is masked, omitted key preserves, changed origin clears and export excludes configuration', async () => {
  const f = setup();
  const value = await f.runtime.action('saveSettings', { baseUrl: 'https://models.example/v1', model: 'custom', apiKey: 'private-key' });
  assert.equal(value.apiKeyConfigured, true); assert.ok(!JSON.stringify(value).includes('private-key'));
  await f.runtime.action('saveSettings', { model: 'custom-v2' });
  await f.runtime.action('testConnection'); assert.equal(f.calls.at(-1)[1].config.apiKey, 'private-key');
  assert.ok(!JSON.stringify(await f.runtime.action('export')).includes('private-key'));
  await f.runtime.action('saveSettings', { baseUrl: 'https://other-model.example/v1' });
  assert.equal((await f.runtime.action('getSettings')).apiKeyConfigured, false);
  await f.runtime.action('saveSettings', { apiKey: 'new-key' });
  await f.runtime.action('saveSettings', { apiKey: '' });
  assert.equal((await f.runtime.action('getSettings')).apiKeyConfigured, false);
});

test('history import sets 30-day bounds and explicit count, preserves captured content', async () => {
  const f = setup();
  await f.repository.upsert({ url: f.tab.url, title: 'Current', text: 'Current captured content', capturedAt: f.now - 500, visitedAt: f.now - 200 });
  await f.runtime.action('importHistory', { days: 30 });
  const query = f.calls.find(([name]) => name === 'history')[1];
  assert.equal(query.startTime, f.now - 30 * 86400000); assert.equal(query.maxResults, 5000);
  assert.equal([...f.documents.values()][0].text, 'Current captured content');
  assert.equal([...f.documents.values()][0].capturedAt, f.now - 500);
});

test('malformed import is rejected before any data mutation and previews do not import', async () => {
  const f = setup();
  const row = { url: f.tab.url, title: 'Valid', text: 'Body', visitedAt: f.now, capturedAt: f.now, source: 'capture' };
  const backup = { format: 'tab-out-memory', version: 1, exportedAt: new Date(f.now).toISOString(), records: [row] };
  assert.equal((await f.runtime.action('import', { backup, preview: true })).count, 1); assert.equal(f.documents.size, 0);
  await assert.rejects(f.runtime.action('import', { backup: { ...backup, records: [row, { ...row, url: 'javascript:bad' }] }, preview: false }), { code: 'invalid_import' });
  assert.equal(f.documents.size, 0);
  await f.runtime.action('import', { backup, preview: false }); assert.equal(f.documents.size, 1);
  await assert.rejects(f.runtime.action('import', { backup: { ...backup, apiKey: 'not-importable' }, preview: false }), { code: 'invalid_import' });
});

test('opening uses fresh local records, reuses existing tab and rejects stale IDs', async () => {
  const f = setup(); const document = await f.repository.upsert({ url: f.tab.url, title: 'Saved', text: '' });
  assert.deepEqual(await f.runtime.action('open', { ids: [document.id, document.id] }), { opened: 0, reused: 1, failed: 0 });
  assert.ok(!f.calls.some(([name]) => name === 'create'));
  await f.repository.remove([document.id]);
  await assert.rejects(f.runtime.action('open', { ids: [document.id] }), { code: 'stale_result' });
});

test('search uses persisted configuration only, propagates explicit disclosure and falls back when unconfigured', async () => {
  const f = setup();
  const local = await f.runtime.action('search', { query: 'meaning', useAI: true, config: { baseUrl: 'https://attacker.invalid', apiKey: 'bad' } });
  assert.deepEqual(local.warnings, ['model_not_configured']);
  assert.equal(f.calls.at(-1)[1].useAI, false);
  await f.runtime.action('saveSettings', { baseUrl: 'https://models.example/v1', model: 'custom', apiKey: 'local-key' });
  await f.runtime.action('search', { query: 'meaning', useAI: true });
  const sent = f.calls.at(-1)[1];
  assert.equal(sent.includeContent, false); assert.equal(sent.config.apiKey, 'local-key');
});

test('permission revocation invalidates capture waiting for the live tab lookup', async () => {
  const f = setup(); await f.runtime.action('setRecording', { enabled: true });
  let release;
  f.chromeApi.tabs.get = () => new Promise(done => { release = done; });
  const pending = f.runtime.capture({ url: f.tab.url, text: 'must not be captured' }, f.content);
  while (!release) await new Promise(done => setImmediate(done));
  f.setAllowed(false); await f.runtime.refreshCapture();
  release(f.tab); await pending;
  assert.equal(f.documents.size, 0);
});

test('cancelling a request propagates AbortSignal and rejects late returned results', async () => {
  const f = setup(); let release, signal;
  f.searchService.search = value => { signal = value.signal; return new Promise(done => { release = done; }); };
  const pending = f.runtime.action('search', { query: 'private', requestId: 'request-1', includeContent: true }).catch(error => error.code);
  while (!release) await new Promise(done => setImmediate(done));
  await f.runtime.action('cancel', { requestId: 'request-1' });
  assert.equal(signal.aborted, true);
  release({ results: [{ text: 'late' }], warnings: [] });
  assert.equal(await pending, 'model_cancelled');
});
