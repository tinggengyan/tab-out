'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');
const { createChromeSessionAdapter } = require('../../extension/src/api/chrome-session-adapter.js');
const { createOperationService } = require('../../extension/src/services/operation-service.js');
const target = path.join(__dirname, '../../extension/src/services/project-service.js');
const { createProjectService } = fs.existsSync(target) ? require(target) : {};

function harness(options = {}) {
  let state = {};
  const events = [];
  const failUrls = new Set();
  let failSave = false;
  let tabId = 100;
  let windowId = 20;
  let groupId = 30;
  const windows = [{ id: 1, incognito: false }, { id: 2, incognito: false }];
  const tabs = [
    { id: 1, windowId: 1, url: 'https://source.example/a', title: 'Source A', pinned: false, index: 0, active: true, groupId: 5 },
    { id: 2, windowId: 1, url: 'https://source.example/b', title: 'Source B', pinned: false, index: 1, active: false, groupId: 5 },
    { id: 3, windowId: 1, url: 'https://pinned.example/', title: 'Pinned', pinned: true, index: 2, active: false, groupId: -1 },
    { id: 4, windowId: 1, url: 'chrome://settings/', title: 'Settings', pinned: false, index: 3, active: false, groupId: -1 },
    { id: 5, windowId: 2, url: 'https://other.example/', title: 'Other window', pinned: false, index: 0, active: true, groupId: -1 },
    { id: 6, windowId: 1, url: 'https://other-project.example/', title: 'Other project same window', pinned: false, index: 4, active: false, groupId: -1 },
  ];
  const storage = {
    async get(key) {
      if (Array.isArray(key)) return Object.fromEntries(key.map(name => [name, structuredClone(state[name])]));
      return key === null ? structuredClone(state) : { [key]: structuredClone(state[key]) };
    },
    async set(update) {
      if (failSave && update.workspacesV2) throw new Error('quota exceeded');
      events.push(['write', Object.keys(update)]);
      state = { ...state, ...structuredClone(update) };
    },
  };
  const chromeApi = {
    runtime: { id: 'test' },
    windows: {
      async getAll() { return windows.map(window => ({ ...window, tabs: tabs.filter(tab => tab.windowId === window.id) })); },
      async get(id) { const window = windows.find(item => item.id === id); if (!window) throw new Error('window missing'); return window; },
      async create(props) {
        if (options.failWindow) throw new Error('window create failed');
        const window = { id: ++windowId, incognito: false };
        windows.push(window);
        const tab = props.url ? await chromeApi.tabs.create({ url: props.url, windowId: window.id, active: false }) : undefined;
        return { ...window, tabs: tab ? [tab] : [] };
      },
    },
    tabs: {
      async query(query = {}) { return tabs.filter(tab => query.windowId === undefined || query.windowId === tab.windowId).map(tab => ({ ...tab })); },
      async get(id) { const tab = tabs.find(item => item.id === id); if (!tab) throw new Error('tab missing'); return { ...tab }; },
      async create(props) {
        events.push(['create', props]);
        if (failUrls.has(props.url)) throw new Error('injected create failure');
        const tab = { id: ++tabId, windowId: props.windowId ?? 1, index: props.index ?? 10, title: props.url, pinned: false, active: false, groupId: -1, ...props };
        tabs.push(tab);
        return { ...tab };
      },
      async remove(ids) {
        events.push(['remove', [...ids]]);
        for (const id of ids) { const index = tabs.findIndex(tab => tab.id === id); if (index >= 0) tabs.splice(index, 1); }
      },
      async update(id, patch) { const tab = tabs.find(item => item.id === id); if (!tab) throw new Error('tab missing'); Object.assign(tab, patch); return { ...tab }; },
      async group({ tabIds, groupId: existing }) { const id = existing ?? ++groupId; tabs.filter(tab => tabIds.includes(tab.id)).forEach(tab => { tab.groupId = id; }); return id; },
    },
    tabGroups: {
      async get(id) { return { id, title: 'Source group', color: 'green', collapsed: false }; },
      async update() {},
    },
  };
  const workspaceRepository = createWorkspaceRepository(storage);
  const sessionAdapter = createChromeSessionAdapter(chromeApi);
  const operationRepository = { async put(operation) { await storage.set({ operationsV2: [operation] }); }, async get(id) { return (state.operationsV2 || []).find(item => item.id === id); } };
  const operationService = createOperationService({
    captureTabs: sessionAdapter.captureTabs, removeTabs: chromeApi.tabs.remove,
    restoreSession: sessionAdapter.restoreSession, retryGroupFailures: sessionAdapter.retryGroupFailures,
    getExistingTabIds: async ids => tabs.filter(tab => ids.includes(tab.id)).map(tab => tab.id), repository: operationRepository,
  });
  assert.equal(typeof createProjectService, 'function', 'project service factory must exist');
  const service = createProjectService({ chromeApi, workspaceRepository, sessionAdapter, operationService, getWorkspaceLimit: async () => options.limit ?? Infinity });
  return { service, workspaceRepository, sessionAdapter, operationService, chromeApi, tabs, windows, events, failUrls, storage, failSave: () => { failSave = true; } };
}

test('empty selection preview keeps all candidates and does not select mixed-window projects', async () => {
  const h = harness();
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [] });
  assert.equal(preview.candidates.filter(tab => tab.eligible).length, 4);
  assert.equal(preview.tabIds.length, 0);
  assert.equal(preview.closeTabIds.length, 0);
  await assert.rejects(h.service.park({ preview, name: 'Empty' }), { code: 'empty_selection' });
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('saving selected project captures only selected source-window tabs and preserves native layout', async () => {
  const h = harness();
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [1, 2, 5] });
  const workspace = await h.service.save({ preview, name: 'Source' });
  assert.equal(workspace.entries.length, 2);
  assert.equal(workspace.session.windows.length, 1);
  assert.equal(workspace.session.windows[0].groups[0].title, 'Source group');
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('parking closes only selected non-pinned pages after project persistence', async () => {
  const h = harness();
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [1, 2, 3, 4, 5] });
  const result = await h.service.park({ preview, name: 'Source' });
  assert.equal(result.status, 'complete');
  assert.equal(result.counts.closed, 2);
  assert.deepEqual(h.events.find(event => event[0] === 'remove')[1], [1, 2]);
  assert.deepEqual(h.tabs.map(tab => tab.id).sort(), [3, 4, 5, 6]);
  assert.ok(h.events.findIndex(event => event[0] === 'write' && event[1].includes('workspacesV2')) < h.events.findIndex(event => event[0] === 'remove'));
  assert.ok(result.operation.id);
});

test('quota and project limit failures leave every page open', async () => {
  for (const scenario of ['quota', 'limit']) {
    const h = harness({ limit: scenario === 'limit' ? 0 : Infinity });
    const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
    if (scenario === 'quota') h.failSave();
    await assert.rejects(h.service.park({ preview, name: 'Source' }));
    assert.equal(h.tabs.length, 6);
    assert.equal(h.events.some(event => event[0] === 'remove'), false);
  }
});

test('changed URL or pinned state invalidates a close preview', async () => {
  for (const patch of [{ url: 'https://changed.example/' }, { pinned: true }]) {
    const h = harness();
    const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
    Object.assign(h.tabs[0], patch);
    await assert.rejects(h.service.park({ preview, name: 'Source' }), { code: 'preview_stale' });
    assert.equal(h.events.some(event => event[0] === 'remove'), false);
  }
});

test('resume only creates missing URLs and a second resume creates no duplicates', async () => {
  const h = harness();
  const workspace = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://source.example/a' }, { url: 'https://target.example/new' }] });
  const preview = await h.service.previewResume({ workspaceId: workspace.id });
  assert.equal(preview.counts.existing, 1);
  const first = await h.service.resume({ preview });
  assert.equal(first.counts.opened, 1);
  assert.equal(first.counts.reused, 1);
  const again = await h.service.previewResume({ workspaceId: workspace.id });
  const second = await h.service.resume({ preview: again });
  assert.equal(second.counts.opened, 0);
  assert.equal(h.tabs.filter(tab => tab.url === 'https://target.example/new').length, 1);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('resume detects edits to the target project after preview', async () => {
  const h = harness();
  const workspace = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://target.example/new' }] });
  const preview = await h.service.previewResume({ workspaceId: workspace.id });
  await h.workspaceRepository.addEntries(workspace.id, [{ url: 'https://target.example/changed' }]);
  await assert.rejects(h.service.resume({ preview }), { code: 'preview_stale' });
  assert.equal(h.events.some(event => event[0] === 'create'), false);
});

test('switch saves source and restores target before closing only selected source pages', async () => {
  const h = harness();
  const target = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://source.example/a' }, { url: 'https://target.example/new' }] });
  const sourcePreview = await h.service.previewSave({ windowId: 1, tabIds: [1, 2] });
  const targetPreview = await h.service.previewResume({ workspaceId: target.id });
  const result = await h.service.switchProject({ sourcePreview, sourceName: 'Source', targetPreview });
  assert.equal(result.status, 'complete');
  assert.deepEqual(h.events.find(event => event[0] === 'remove')[1], [2]);
  assert.ok(h.tabs.some(tab => tab.id === 1), 'shared target page must remain open');
  assert.ok(h.tabs.some(tab => tab.id === 6), 'another project in the same window must remain open');
  assert.ok(h.events.findIndex(event => event[0] === 'create') < h.events.findIndex(event => event[0] === 'remove'));
});

test('target restoration failure preserves all source pages and reports a retryable result', async () => {
  const h = harness();
  const target = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://target.example/ok' }, { url: 'https://target.example/fail' }] });
  h.failUrls.add('https://target.example/fail');
  const sourcePreview = await h.service.previewSave({ windowId: 1, tabIds: [1, 2] });
  const targetPreview = await h.service.previewResume({ workspaceId: target.id });
  const result = await h.service.switchProject({ sourcePreview, sourceName: 'Source', targetPreview });
  assert.notEqual(result.status, 'complete');
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
  assert.ok(result.failures.length);
  h.failUrls.clear();
  const retry = await h.service.resume({ preview: result.retryPreview });
  assert.equal(retry.status, 'complete');
  assert.equal(h.tabs.filter(tab => tab.url === 'https://target.example/ok').length, 1);
});

test('switch rejects choosing the same source and target project', async () => {
  const h = harness();
  const workspace = await h.workspaceRepository.create({ name: 'Same', entries: [{ url: 'https://source.example/a' }] });
  const sourcePreview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
  const targetPreview = await h.service.previewResume({ workspaceId: workspace.id });
  await assert.rejects(h.service.switchProject({ sourcePreview, sourceWorkspaceId: workspace.id, sourceName: 'Same', targetPreview }), { code: 'same_workspace' });
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('a newly opened target page between preview and resume is reused', async () => {
  const h = harness();
  const workspace = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://target.example/new' }] });
  const preview = await h.service.previewResume({ workspaceId: workspace.id });
  h.tabs.push({ id: 9, windowId: 2, url: 'https://target.example/new', pinned: false, index: 1 });
  const result = await h.service.resume({ preview });
  assert.equal(result.counts.opened, 0);
  assert.equal(result.counts.reused, 1);
});

test('group-only resume retry preserves opened target tabs', async () => {
  const h = harness();
  const session = { windows: [{ sourceWindowId: 77, tabs: [
    { id: 'target:1', url: 'https://target.example/a', index: 0, restorable: true },
    { id: 'target:2', url: 'https://target.example/b', index: 1, restorable: true },
  ], groups: [{ ref: 'group:77', title: 'Target group', color: 'blue', collapsed: true, tabIds: ['target:1', 'target:2'] }] }] };
  const workspace = await h.workspaceRepository.saveSession({ name: 'Target', session });
  let failures = 1;
  h.chromeApi.tabGroups.update = async () => { if (failures-- > 0) throw new Error('group update failed'); };
  const first = await h.service.resume({ preview: await h.service.previewResume({ workspaceId: workspace.id }) });
  assert.equal(first.status, 'partial');
  assert.equal(first.counts.opened, 2);
  const second = await h.service.resume({ preview: first.retryPreview });
  assert.equal(second.status, 'complete');
  assert.equal(second.counts.opened, 2);
  assert.equal(h.events.filter(event => event[0] === 'create').length, 2);
});

test('original undo retries failed tabs into the same replacement source window', async () => {
  const h = harness();
  const operation = await h.operationService.close([1, 2]);
  h.windows.splice(0, 1);
  h.failUrls.add('https://source.example/b');
  const first = await h.operationService.undo(operation.id);
  assert.equal(first.status, 'partially_failed');
  const firstRestoredWindow = h.tabs.find(tab => tab.url === 'https://source.example/a').windowId;
  h.failUrls.clear();
  const second = await h.operationService.undo(operation.id);
  assert.equal(second.status, 'undone');
  assert.equal(h.tabs.find(tab => tab.url === 'https://source.example/b').windowId, firstRestoredWindow);
  assert.equal(h.tabs.filter(tab => tab.url === 'https://source.example/a').length, 1);
  assert.equal(h.tabs.find(tab => tab.url === 'https://source.example/a').groupId, h.tabs.find(tab => tab.url === 'https://source.example/b').groupId);
});

test('group-only undo retry consumes no successful restored pages', async () => {
  const h = harness();
  const operation = await h.operationService.close([1, 2]);
  let failures = 1;
  h.chromeApi.tabGroups.update = async () => { if (failures-- > 0) throw new Error('group update failed'); };
  const first = await h.operationService.undo(operation.id);
  assert.equal(first.status, 'partially_failed');
  assert.equal(first.before.windows.length, 0);
  const second = await h.operationService.undo(operation.id);
  assert.equal(second.status, 'undone');
  assert.equal(h.tabs.filter(tab => tab.url.startsWith('https://source.example')).length, 2);
});

test('a second destructive action is rejected while persistence is pending', async () => {
  const h = harness();
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
  const save = h.workspaceRepository.saveSession;
  let continueSave;
  const waiting = new Promise(resolve => { continueSave = resolve; });
  h.workspaceRepository.saveSession = async input => { await waiting; return save(input); };
  const first = h.service.park({ preview, name: 'Source' });
  await assert.rejects(h.service.park({ preview, name: 'Duplicate' }), { code: 'operation_busy' });
  continueSave();
  await first;
  assert.equal(h.events.filter(event => event[0] === 'remove').length, 1);
  assert.equal((await h.workspaceRepository.list()).length, 1);
});

test('updating an edited source project requires another preview', async () => {
  const h = harness();
  const workspace = await h.workspaceRepository.create({ name: 'Source', entries: [{ url: 'https://source.example/a' }] });
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
  await h.workspaceRepository.addEntries(workspace.id, [{ url: 'https://edited-elsewhere.example/' }]);
  await assert.rejects(h.service.park({ preview, workspaceId: workspace.id, name: 'Source' }), { code: 'preview_stale' });
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
  assert.equal((await h.workspaceRepository.get(workspace.id)).entries.length, 2);
});

module.exports = { harness };

test('append is the default for existing projects and preserves saved windows and native group metadata', async () => {
  const h = harness();
  const first = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 2, 3] }), name: 'Research' });
  const originalWindows = structuredClone(first.session.windows);
  const next = await h.service.save({ preview: await h.service.previewSave({ windowId: 2, tabIds: [5] }), workspaceId: first.id, name: 'Research' });
  assert.equal(next.entries.length, 4);
  assert.deepEqual(next.session.windows.slice(0, originalWindows.length), originalWindows);
  assert.equal(next.session.stats.tabCount, 4);
  assert.equal(next.session.windows[0].groups[0].title, 'Source group');
  assert.equal(next.session.windows[0].tabs[2].pinned, true);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('repeated append deduplicates URLs and remaps captured references without altering prior layout', async () => {
  const h = harness();
  const first = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1] }), name: 'Research' });
  const original = structuredClone(first.session.windows[0]);
  const second = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 2] }), workspaceId: first.id, name: 'Research' });
  const third = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [2] }), workspaceId: first.id, name: 'Research' });
  assert.equal(third.entries.length, 2);
  assert.deepEqual(third.session.windows, second.session.windows);
  assert.deepEqual(third.session.windows[0], original);
  const tabs = third.session.windows.flatMap(window => window.tabs);
  const refs = tabs.map(tab => tab.id);
  assert.equal(new Set(refs).size, refs.length);
  assert.equal(new Set(third.session.windows.map(window => window.sourceWindowId)).size, third.session.windows.length);
  const groups = third.session.windows.flatMap(window => window.groups);
  assert.equal(new Set(groups.map(group => group.ref)).size, groups.length);
  assert.ok(groups.every(group => group.tabIds.every(ref => refs.includes(ref))));
  assert.ok(tabs.every(tab => !tab.groupRef || groups.some(group => group.ref === tab.groupRef && group.tabIds.includes(tab.id))));
});

test('explicit replacement and update impact distinguish additions, retained pages and removals', async () => {
  const { projectUpdateImpact } = require(target);
  const h = harness();
  const first = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 2] }), name: 'Research' });
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [2, 3] });
  const impact = projectUpdateImpact(first, preview, 'replace');
  assert.deepEqual(impact.added.map(page => page.url), ['https://pinned.example/']);
  assert.deepEqual(impact.retained.map(page => page.url), ['https://source.example/b']);
  assert.deepEqual(impact.removed.map(page => page.url), ['https://source.example/a']);
  const appended = projectUpdateImpact(first, preview);
  assert.equal(appended.retained.length, 2);
  assert.deepEqual(appended.removed, []);
  const replaced = await h.service.save({ preview, workspaceId: first.id, name: 'Research', updateMode: 'replace' });
  assert.deepEqual(replaced.entries.map(entry => entry.url), ['https://source.example/b', 'https://pinned.example/']);
  assert.equal(replaced.id, first.id);
});

test('removing a saved entry preserves remaining layout and never closes a browser tab', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 2, 3] }), name: 'Research' });
  const expectedTab = structuredClone(saved.session.windows[0].tabs[1]);
  const removed = await h.service.removeSavedEntry({ workspaceId: saved.id, url: 'https://source.example/a', expectedFingerprint: h.service.projectFingerprint(saved) });
  assert.equal(removed.entries.length, 2);
  assert.deepEqual(removed.session.windows[0].tabs[0], expectedTab);
  assert.equal(removed.session.windows[0].groups[0].title, 'Source group');
  assert.deepEqual(removed.session.windows[0].groups[0].tabIds, [expectedTab.id]);
  assert.equal(removed.session.stats.tabCount, 2);
  assert.equal(h.tabs.some(tab => tab.id === 1), true);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('remove rejects the last saved page and stale details without writing', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1] }), name: 'Research' });
  await assert.rejects(h.service.removeSavedEntry({ workspaceId: saved.id, url: saved.entries[0].url, expectedFingerprint: h.service.projectFingerprint(saved) }), { code: 'empty_selection' });
  await h.workspaceRepository.update(saved.id, { name: 'Changed' });
  await assert.rejects(h.service.removeSavedEntry({ workspaceId: saved.id, url: saved.entries[0].url, expectedFingerprint: h.service.projectFingerprint(saved) }), { code: 'preview_stale' });
  assert.equal((await h.workspaceRepository.get(saved.id)).entries.length, 1);
  assert.equal(h.tabs.some(tab => tab.id === 1), true);
});

test('append rejects an edit racing during capture and does not close source tabs', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1] }), name: 'Research' });
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [2] });
  const originalCapture = h.sessionAdapter.captureTabs;
  h.sessionAdapter.captureTabs = async ids => {
    const captured = await originalCapture(ids);
    await h.workspaceRepository.update(saved.id, { name: 'Edited elsewhere' });
    return captured;
  };
  await assert.rejects(h.service.park({ preview, workspaceId: saved.id, name: 'Research' }), { code: 'preview_stale' });
  const current = await h.workspaceRepository.get(saved.id);
  assert.equal(current.name, 'Edited elsewhere');
  assert.equal(current.entries.length, 1);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('navigation while capturing a save is rejected before storing the project', async () => {
  const h = harness();
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
  const originalCapture = h.sessionAdapter.captureTabs;
  h.sessionAdapter.captureTabs = async ids => {
    const captured = await originalCapture(ids);
    h.tabs.find(tab => tab.id === 1).url = 'https://navigated.example/';
    return captured;
  };
  await assert.rejects(h.service.park({ preview, name: 'Research' }), { code: 'preview_stale' });
  assert.equal((await h.workspaceRepository.list()).length, 0);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('append storage failure keeps the old snapshot and all selected browser pages', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1] }), name: 'Research' });
  const preview = await h.service.previewSave({ windowId: 1, tabIds: [2] });
  h.failSave();
  await assert.rejects(h.service.park({ preview, name: saved.name, workspaceId: saved.id }), /quota exceeded/);
  assert.deepEqual(await h.workspaceRepository.get(saved.id), saved);
  assert.equal(h.events.some(event => event[0] === 'remove'), false);
});

test('remove rechecks the version inside the commit and preserves an intervening edit', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 2] }), name: 'Research' });
  const originalSave = h.workspaceRepository.saveSession;
  h.workspaceRepository.saveSession = async input => {
    await h.workspaceRepository.update(saved.id, { name: 'Other editor' });
    return originalSave(input);
  };
  await assert.rejects(h.service.removeSavedEntry({ workspaceId: saved.id, url: saved.entries[0].url, expectedFingerprint: h.service.projectFingerprint(saved) }), { code: 'preview_stale' });
  const current = await h.workspaceRepository.get(saved.id);
  assert.equal(current.name, 'Other editor');
  assert.equal(current.entries.length, 2);
  assert.deepEqual(current.session, saved.session);
});

test('remove prunes an empty saved window and group while keeping the other window unchanged', async () => {
  const h = harness();
  const saved = await h.service.save({ preview: await h.service.previewSave({ windowId: 1, tabIds: [1, 5], acrossWindows: true }), name: 'Research' });
  const expectedWindow = structuredClone(saved.session.windows[1]);
  const result = await h.service.removeSavedEntry({ workspaceId: saved.id, url: 'https://source.example/a', expectedFingerprint: h.service.projectFingerprint(saved) });
  assert.deepEqual(result.session.windows, [expectedWindow]);
  assert.deepEqual(result.session.stats, { windowCount: 1, tabCount: 1, groupCount: 0 });
});

test('update impact uses normalized selected URLs and excludes ineligible candidates', () => {
  const { projectUpdateImpact } = require(target);
  const impact = projectUpdateImpact({ entries: [{ url: 'https://old.example', title: 'Old' }] }, {
    tabIds: [1, 2, 3, 4], candidates: [
      { id: 1, url: 'https://old.example/', eligible: true },
      { id: 2, url: 'https://new.example', title: 'New', eligible: true },
      { id: 3, url: 'https://new.example/', title: 'Duplicate', eligible: true },
      { id: 4, url: 'chrome://settings', eligible: false },
      { id: 5, url: 'https://unselected.example/', eligible: true },
    ],
  }, 'replace');
  assert.deepEqual(impact, {
    added: [{ url: 'https://new.example/', title: 'New' }],
    retained: [{ url: 'https://old.example/', title: 'Old' }],
    removed: [],
  });
});

for (const change of ['navigate', 'pin']) {
  test(`park keeps the source when it changes (${change}) while pending close is persisted`, async () => {
    const h = harness();
    const preview = await h.service.previewSave({ windowId: 1, tabIds: [1] });
    const originalSet = h.storage.set;
    h.storage.set = async update => {
      await originalSet(update);
      if (update.operationsV2?.[0]?.status === 'pending') {
        const tab = h.tabs.find(tab => tab.id === 1);
        if (change === 'navigate') tab.url = 'https://navigated-after-save.example/';
        else tab.pinned = true;
      }
    };
    const result = await h.service.park({ preview, name: 'Race' });
    assert.equal(result.status, 'failed');
    assert.equal(result.counts.closed, 0);
    assert.equal(result.counts.kept, 1);
    assert.equal(result.failures[0].code, 'preview_stale');
    assert.equal(h.events.some(event => event[0] === 'remove'), false);
    const pending = (await h.storage.get('operationsV2')).operationsV2[0];
    assert.equal(pending.status, 'partially_failed');
    assert.equal(pending.result.succeeded, 0);
    assert.equal((await h.workspaceRepository.list())[0].entries[0].url, 'https://source.example/a');
    assert.equal(h.tabs.some(tab => tab.id === 1), true);
  });
}

for (const stage of ['restore', 'pending-close']) {
  test(`switch keeps its source when target is edited during ${stage}`, async () => {
    const h = harness();
    const targetProject = await h.workspaceRepository.create({ name: 'Target', entries: [{ url: 'https://target.example/new' }] });
    const sourcePreview = await h.service.previewSave({ windowId: 1, tabIds: [1, 2] });
    const targetPreview = await h.service.previewResume({ workspaceId: targetProject.id });
    if (stage === 'restore') {
      const originalCreate = h.chromeApi.tabs.create;
      h.chromeApi.tabs.create = async props => {
        await h.workspaceRepository.addEntries(targetProject.id, [{ url: 'https://target-edited-during-restore.example/' }]);
        return originalCreate(props);
      };
    } else {
      const originalSet = h.storage.set;
      h.storage.set = async update => {
        await originalSet(update);
        if (update.operationsV2?.[0]?.status === 'pending') await h.workspaceRepository.addEntries(targetProject.id, [{ url: 'https://target-edited-during-pending.example/' }]);
      };
    }
    const result = await h.service.switchProject({ sourcePreview, sourceName: 'Source', targetPreview });
    assert.equal(result.status, 'failed');
    assert.equal(result.counts.closed, 0);
    assert.equal(result.counts.kept, 2);
    assert.equal(result.failures[0].code, 'preview_stale');
    assert.equal(h.events.some(event => event[0] === 'remove'), false);
    assert.equal((await h.workspaceRepository.get(targetProject.id)).entries.length, 2);
    assert.ok(h.tabs.some(tab => tab.id === 1) && h.tabs.some(tab => tab.id === 2));
  });
}
