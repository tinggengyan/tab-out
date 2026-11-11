'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowsingMemoryController, memoryModelOrigin, memorySettingsPayload, focusVisibleMemoryControl, handleMemoryConfirmationKeydown } = require('../../extension/src/ui/browsing-memory.js');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function confirmationHarness() {
  const control = () => ({ isConnected: true, disabled: false, offsetParent: null,
    getClientRects: () => [{ width: 80, height: 36 }], closest: () => null,
    focus(options) { this.focusOptions = options; this.focused = true; },
  });
  const no = control(); const yes = control();
  const dialog = { querySelectorAll: () => [no, yes] };
  function key(key, activeElement, shiftKey = false) {
    const event = { key, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    handleMemoryConfirmationKeydown(event, { dialog, activeElement });
    return event;
  }
  return { no, yes, dialog, key };
}

test('native confirmation controls receive focus even when their offsetParent is null', () => {
  const { no } = confirmationHarness();
  assert.equal(focusVisibleMemoryControl(no), true);
  assert.equal(no.focused, true);
  assert.deepEqual(no.focusOptions, { preventScroll: true });
  no.closest = () => ({ hidden: true }); no.focused = false;
  assert.equal(focusVisibleMemoryControl(no), false);
  assert.equal(no.focused, false);
  no.closest = () => null; no.getClientRects = () => [];
  assert.equal(focusVisibleMemoryControl(no), false);
});

test('native confirmation wraps Shift+Tab and Tab at its two visible buttons', () => {
  const { no, yes, key } = confirmationHarness();
  assert.equal(key('Tab', no, true).prevented, true);
  assert.equal(yes.focused, true);
  assert.deepEqual(yes.focusOptions, { preventScroll: true });
  assert.equal(key('Tab', yes).prevented, true);
  assert.equal(no.focused, true);
  assert.equal(key('Tab', no).prevented, false);
  assert.equal(key('Tab', yes, true).prevented, false);
});

test('confirmation redirects an absent focus into the dialog and leaves Escape for native cancel', () => {
  const { no, key } = confirmationHarness();
  assert.equal(key('Tab', null).prevented, true);
  assert.equal(no.focused, true);
  const escape = key('Escape', no);
  assert.equal(escape.stopped, true);
  assert.equal(escape.prevented, false);
});

test('model permission target is an HTTP(S) origin without credentials or query', () => {
  assert.equal(memoryModelOrigin('https://models.example.test/v1'), 'https://models.example.test/*');
  assert.equal(memoryModelOrigin('http://127.0.0.1:8000/v1/chat/completions'), 'http://127.0.0.1:8000/*');
  for (const url of ['javascript:alert(1)', 'https://user:secret@models.test/v1', 'https://models.test/v1?key=secret', 'https://models.test/v1#key']) assert.throws(() => memoryModelOrigin(url));
});

test('unchanged blank key preserves existing secret while an intentional blank clears it', () => {
  const form = { baseUrl: 'https://model.test/v1', model: 'chat', apiKey: '', retentionDays: '90', exclusions: 'bank.test\nmail.test' };
  assert.equal('apiKey' in memorySettingsPayload(form, false), false);
  assert.equal(memorySettingsPayload(form, true).apiKey, '');
  assert.deepEqual(memorySettingsPayload(form, false).exclusions, ['bank.test', 'mail.test']);
});

test('loading only requests status and never performs an AI search', async () => {
  const actions = [];
  const controller = createBrowsingMemoryController({ send: async action => { actions.push(action); return { settings: { recording: false }, stats: { total: 0 }, permissions: {} }; } });
  await controller.refresh();
  assert.deepEqual(actions, ['status']);
  assert.equal(controller.state.includeContent, false);
  assert.equal(controller.state.useAI, false);
});

test('later search wins even if an older request resolves last', async () => {
  const older = deferred();
  const controller = createBrowsingMemoryController({ send: async (action, payload) => payload.query === 'older' ? older.promise : { results: [{ id: 'new', title: 'New' }], mode: 'local', scanned: 1 } });
  const first = controller.search({ query: 'older', days: 30 });
  await controller.search({ query: 'newer', days: 30 });
  older.resolve({ results: [{ id: 'old', title: 'Old' }], mode: 'local' });
  await first;
  assert.deepEqual(controller.state.results.map(item => item.id), ['new']);
});

test('clear invalidates a pending search and clears summary and selection', async () => {
  const searching = deferred();
  const controller = createBrowsingMemoryController({ send: async action => action === 'search' ? searching.promise : action === 'status' ? { settings: { recording: false }, stats: { total: 0 }, permissions: {} } : {} });
  const request = controller.search({ query: 'content', useAI: true, includeContent: true });
  controller.state.summary = { items: [{ text: 'Old' }] };
  await controller.clear();
  searching.resolve({ results: [{ id: 'deleted' }], mode: 'reranked' });
  await request;
  assert.deepEqual(controller.state.results, []);
  assert.equal(controller.state.summary, null);
  assert.equal(controller.state.selected.size, 0);
});

test('withdrawing consent cancels the pending search before it can send further candidate content', async () => {
  const searching = deferred();
  const calls = [];
  const controller = createBrowsingMemoryController({ createRequestId: () => 'search-request-1', send: async (action, payload) => { calls.push({ action, payload }); return action === 'search' ? searching.promise : {}; } });
  const pending = controller.search({ query: 'a topic', useAI: true, includeContent: true });
  controller.setContentConsent(false);
  assert.equal(controller.state.searching, false);
  assert.deepEqual(calls[1], { action: 'cancel', payload: { requestId: 'search-request-1' } });
  searching.resolve({ results: [{ id: 'old', coverage: 'content' }], mode: 'reranked' });
  assert.deepEqual(await pending, { stale: true });
  assert.deepEqual(controller.state.results, []);
});

test('a new search cancels the previous request with its original unique ID', async () => {
  const previous = deferred();
  const calls = [];
  let sequence = 0;
  const controller = createBrowsingMemoryController({ createRequestId: () => `request-${++sequence}`, send: async (action, payload) => { calls.push({ action, payload }); return action === 'search' && payload.query === 'old' ? previous.promise : { results: [] }; } });
  const older = controller.search({ query: 'old' });
  await controller.search({ query: 'new' });
  assert.deepEqual(calls[1], { action: 'cancel', payload: { requestId: 'request-1' } });
  assert.equal(calls[2].payload.requestId, 'request-2');
  previous.resolve({ results: [{ id: 'old' }] });
  await older;
  assert.deepEqual(controller.state.results, []);
});

test('clearing memory withdraws content consent and cancels pending imports', async () => {
  const controller = createBrowsingMemoryController({ send: async action => action === 'status' ? { settings: { recording: false }, stats: {} } : {} });
  controller.setContentConsent(true);
  controller.state.pendingImport = { backup: { records: [{ id: 'old' }] } };
  await controller.clear();
  assert.equal(controller.state.includeContent, false);
  assert.equal(controller.state.pendingImport, null);
});

test('summary requires explicit current content consent and selected content records', async () => {
  let calls = 0;
  const controller = createBrowsingMemoryController({ send: async () => { calls++; return {}; } });
  controller.state.results = [{ id: 'a', coverage: 'metadata' }];
  controller.setSelected('a', true);
  await assert.rejects(() => controller.summarize(), error => error.code === 'content_consent_required');
  controller.state.includeContent = true;
  await assert.rejects(() => controller.summarize(), error => error.code === 'content_required');
  assert.equal(calls, 0);
});

test('withdrawing content consent while summary is pending discards its eventual response', async () => {
  const summary = deferred();
  const controller = createBrowsingMemoryController({ send: async () => summary.promise });
  controller.state.results = [{ id: 'a', coverage: 'content' }];
  controller.setSelected('a', true);
  controller.setContentConsent(true);
  const pending = controller.summarize();
  controller.setContentConsent(false);
  summary.resolve({ items: [{ text: 'Must not reappear', sourceIds: ['a'] }] });
  assert.deepEqual(await pending, { stale: true });
  assert.equal(controller.state.summary, null);
});

test('changing selected records while summary is pending discards its eventual response', async () => {
  const summary = deferred();
  const controller = createBrowsingMemoryController({ send: async () => summary.promise });
  controller.state.results = [{ id: 'a', coverage: 'content' }];
  controller.setSelected('a', true);
  controller.setContentConsent(true);
  const pending = controller.summarize();
  controller.setSelected('a', false);
  summary.resolve({ items: [{ text: 'Wrong selection', sourceIds: ['a'] }] });
  assert.deepEqual(await pending, { stale: true });
  assert.equal(controller.state.summary, null);
});

test('recap validates maximum source count before starting a model request', async () => {
  let called = false;
  const controller = createBrowsingMemoryController({ send: async () => { called = true; return {}; } });
  controller.state.results = Array.from({ length: 9 }, (_, n) => ({ id: String(n), coverage: 'content' }));
  controller.selectAll(); controller.setContentConsent(true);
  await assert.rejects(() => controller.summarize(), error => error.code === 'too_many_summary_sources');
  assert.equal(called, false);
});

test('selection actions only send IDs that still exist in visible results', async () => {
  const calls = [];
  const controller = createBrowsingMemoryController({ send: async (action, payload) => { calls.push({ action, payload }); return { opened: 1, reused: 0, failed: [] }; } });
  controller.state.results = [{ id: 'real', coverage: 'content' }];
  controller.state.selected = new Set(['real', 'forged']);
  await controller.runSelected('open');
  assert.deepEqual(calls[0], { action: 'open', payload: { ids: ['real'] } });
});

test('enable recording requests permission synchronously before sending runtime commands', async () => {
  const calls = [];
  const grant = deferred();
  const controller = createBrowsingMemoryController({ requestPermissions: spec => { calls.push(['permission', spec]); return grant.promise; }, send: async action => { calls.push(['runtime', action]); return action === 'status' ? { settings: { recording: true }, stats: {}, permissions: {} } : {}; } });
  const enabling = controller.setRecording(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'permission');
  grant.resolve(true);
  await enabling;
  assert.equal(calls[1][1], 'setRecording');
});

test('permission rejection does not send recording or import commands', async () => {
  const calls = [];
  const controller = createBrowsingMemoryController({ requestPermissions: async () => false, send: async action => { calls.push(action); return {}; } });
  await assert.rejects(() => controller.setRecording(true), error => error.code === 'permission_denied');
  await assert.rejects(() => controller.importHistory(), error => error.code === 'permission_denied');
  assert.deepEqual(calls, []);
});

test('connection test saves changed settings after obtaining model origin permission', async () => {
  const calls = [];
  const controller = createBrowsingMemoryController({ requestPermissions: spec => { calls.push(['permission', spec]); return Promise.resolve(true); }, send: async (action, payload) => { calls.push([action, payload]); return {}; } });
  await controller.testConnection({ baseUrl: 'https://model.test/v1', model: 'chat', apiKey: 'test-key', retentionDays: 90, exclusions: '' }, true);
  assert.equal(calls[0][0], 'permission');
  assert.equal(calls[1][0], 'saveSettings');
  assert.equal(calls[2][0], 'testConnection');
});

test('import preview is read-only until explicitly confirmed and cancel drops pending data', async () => {
  const calls = [];
  const controller = createBrowsingMemoryController({ send: async (action, payload) => { calls.push({ action, payload }); return { added: 1 }; } });
  const backup = { format: 'tab-out-memory', version: 1, records: [] };
  await controller.previewImport(backup);
  assert.equal(calls[0].payload.preview, true);
  controller.cancelImport();
  await assert.rejects(() => controller.confirmImport(), error => error.code === 'import_required');
  assert.equal(calls.length, 1);
});

test('memory highlight parts render literal text and fall back when the parts do not match the snippet', () => {
  const { memorySnippetParts, renderMemorySnippetHTML } = require('../../extension/src/ui/browsing-memory.js');
  const { escapeHtml } = require('../../extension/src/shared/sanitize.js');
  const item = { snippet: '<img> AI', snippetParts: [{ text: '<img> ', match: false }, { text: 'AI', match: true }] };
  assert.equal(renderMemorySnippetHTML(item, escapeHtml), '&lt;img&gt; <mark>AI</mark>');
  assert.deepEqual(memorySnippetParts({ snippet: '<script>', snippetParts: [{ text: 'Wrong', match: true }] }), [{ text: '<script>', match: false }]);
});

test('switching a pending query-only AI search to local cancels it and rejects its late response', async () => {
  const searching = deferred(); const calls = [];
  const controller = createBrowsingMemoryController({ createRequestId: () => 'query-only-ai', send: async (action, payload) => {
    calls.push({ action, payload });
    return action === 'search' && payload.useAI ? searching.promise : { results: [{ id: 'local-result' }], mode: 'local' };
  } });
  const pendingAI = controller.search({ query: 'remembered words', useAI: true, includeContent: false });
  controller.setSearchMode(false);
  assert.equal(controller.state.useAI, false);
  assert.equal(controller.state.searching, false);
  assert.equal(controller.state.includeContent, false);
  assert.deepEqual(calls[1], { action: 'cancel', payload: { requestId: 'query-only-ai' } });
  await controller.search({ query: 'new local words', useAI: false, includeContent: false });
  searching.resolve({ results: [{ id: 'late-ai' }], mode: 'reranked' });
  assert.deepEqual(await pendingAI, { stale: true });
  assert.equal(controller.state.mode, 'local');
  assert.deepEqual(controller.state.results.map(item => item.id), ['local-result']);
});
