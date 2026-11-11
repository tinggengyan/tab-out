'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../../extension/src/ui/project-workbench.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};

function harness() {
  assert.equal(typeof api.createProjectWorkbenchController, 'function');
  const calls = [];
  const candidates = [
    { id: 1, url: 'https://code.example/project-a', title: 'Project A code', eligible: true, pinned: false },
    { id: 2, url: 'https://docs.example/project-a', title: 'Project A notes', eligible: true, pinned: false },
    { id: 3, url: 'https://code.example/project-b', title: 'Project B code', eligible: true, pinned: false },
    { id: 4, url: 'https://mail.example/', title: 'Mail', eligible: true, pinned: true },
    { id: 5, url: 'chrome://settings/', title: 'Settings', eligible: false },
  ];
  const projects = [
    { id: 'source', name: 'Project A', entries: [{ url: candidates[0].url }, { url: candidates[1].url }] },
    { id: 'target', name: 'Project B', entries: [{ url: candidates[2].url }] },
  ];
  const service = {
    async previewSave(input) {
      calls.push(['previewSave', input]);
      const ids = input.tabIds || [1, 2, 3];
      return { windowId: input.windowId, tabIds: ids, candidates: candidates.map(tab => ({ ...tab, selected: ids.includes(tab.id) })), fingerprint: `selection-${ids.join(',')}`, counts: { selected: ids.length, closable: ids.filter(id => id !== 4).length } };
    },
    async previewResume(input) {
      calls.push(['previewResume', input]);
      return { workspaceId: input.workspaceId, workspace: projects.find(item => item.id === input.workspaceId), mode: input.mode, fingerprint: 'target-version', counts: { total: 1, missing: 1, existing: 0, unsupported: 0 } };
    },
    async save(input) { calls.push(['save', input]); return { id: 'saved', name: input.name, entries: input.preview.tabIds.map(id => candidates.find(tab => tab.id === id)) }; },
    async park(input) { calls.push(['park', input]); return { status: 'complete', counts: { saved: input.preview.tabIds.length, closed: input.preview.tabIds.length }, failures: [] }; },
    async resume(input) { calls.push(['resume', input]); return { status: 'complete', counts: { opened: 1 }, failures: [] }; },
    async switchProject(input) { calls.push(['switch', input]); return { status: 'complete', counts: { saved: 2, opened: 1, closed: 2 }, failures: [] }; },
  };
  const controller = api.createProjectWorkbenchController({
    chromeApi: { windows: { getCurrent: async () => ({ id: 7 }) } },
    service,
    workspaceRepository: { list: async () => structuredClone(projects) },
  });
  return { calls, candidates, projects, service, controller };
}

test('a mixed-project window starts with no pages selected', async () => {
  const { controller, calls } = harness();
  await controller.begin('save');
  assert.deepEqual(calls[0], ['previewSave', { windowId: 7, tabIds: [], acrossWindows: false }]);
  assert.deepEqual(controller.state.preview.tabIds, []);
});

test('choosing an existing source project selects only its members across domains', async () => {
  const { controller } = harness();
  await controller.begin('switch', { workspaceId: 'target' });
  await controller.setSource('source');
  assert.deepEqual(controller.state.preview.tabIds, [1, 2]);
  assert.equal(controller.state.name, 'Project A');
});

test('saving uses the selected preview without silently selecting the rest of the window', async () => {
  const { controller, calls } = harness();
  await controller.begin('save');
  await controller.setSelection([1, 2]);
  controller.setName('Project A');
  const fingerprint = controller.state.preview.fingerprint;
  await controller.execute('save');
  const saved = calls.find(([method]) => method === 'save')[1];
  assert.deepEqual(saved.preview.tabIds, [1, 2]);
  assert.equal(saved.preview.fingerprint, fingerprint);
  assert.equal(calls.some(([method]) => method === 'park'), false);
});

test('switching passes the explicitly selected source and target to the service transaction', async () => {
  const { controller, calls } = harness();
  await controller.begin('switch', { workspaceId: 'target' });
  await controller.setSource('source');
  await controller.execute();
  const input = calls.find(([method]) => method === 'switch')[1];
  assert.equal(input.sourceWorkspaceId, 'source');
  assert.equal(input.targetPreview.workspaceId, 'target');
  assert.deepEqual(input.sourcePreview.tabIds, [1, 2]);
});

test('partial service results remain partial in the result UI state', async () => {
  const { controller, service } = harness();
  service.resume = async () => ({ status: 'partial', counts: { opened: 1, failed: 1 }, failures: [{ code: 'create_failed' }], retryPreview: { workspaceId: 'target', retry: true } });
  await controller.begin('resume', { workspaceId: 'target' });
  const result = await controller.execute();
  assert.equal(result.status, 'partial');
  assert.equal(controller.state.result.status, 'partial');
  assert.equal(controller.state.step, 'result');
});

test('a second execution cannot submit while the first action is running', async () => {
  const { controller, service } = harness();
  let release;
  service.resume = () => new Promise(resolve => { release = resolve; });
  await controller.begin('resume', { workspaceId: 'target' });
  const first = controller.execute();
  await assert.rejects(controller.execute(), error => error.code === 'operation_busy');
  release({ status: 'complete', counts: { opened: 1 }, failures: [] });
  await first;
  assert.equal(controller.state.busy, false);
});

test('a project cannot be selected as both source and destination', async () => {
  const { controller } = harness();
  await controller.begin('switch', { workspaceId: 'target' });
  await assert.rejects(controller.setSource('target'), error => error.code === 'same_workspace');
});

test('candidate filtering finds project pages by title or domain', () => {
  assert.equal(typeof api.filterProjectCandidates, 'function');
  const tabs = [{ id: 1, title: 'Architecture', url: 'https://docs.example/a' }, { id: 2, title: 'Build', url: 'https://code.example/a' }];
  assert.deepEqual(api.filterProjectCandidates(tabs, 'DOCS.EXAMPLE').map(tab => tab.id), [1]);
  assert.deepEqual(api.filterProjectCandidates(tabs, 'build').map(tab => tab.id), [2]);
});

test('selecting filtered results never silently selects hidden pages from another project', () => {
  assert.equal(typeof api.selectFilteredProjectTabIds, 'function');
  const tabs = [
    { id: 1, title: 'Atlas research', url: 'https://docs.example/atlas', eligible: true },
    { id: 2, title: 'Beacon research', url: 'https://docs.example/beacon', eligible: true },
    { id: 3, title: 'Atlas settings', url: 'chrome://settings', eligible: false },
  ];
  assert.deepEqual(api.selectFilteredProjectTabIds(tabs, [], 'atlas'), [1]);
  assert.deepEqual(api.selectFilteredProjectTabIds(tabs, [2], 'atlas'), [2, 1]);
});

test('restore failure codes resolve to user-facing messages with a safe fallback', () => {
  assert.equal(typeof api.projectFailureMessageKey, 'function');
  assert.equal(api.projectFailureMessageKey('create_failed'), 'project.failure.create_failed');
  assert.equal(api.projectFailureMessageKey('window_create_failed'), 'project.failure.window_create_failed');
  assert.equal(api.projectFailureMessageKey('group_restore_failed'), 'project.failure.group_restore_failed');
  assert.equal(api.projectFailureMessageKey('internal_unexpected_code'), 'project.failure.unknown');
});

test('changing restore destination blocks submission until the new preview is ready', async () => {
  const { controller, service } = harness();
  await controller.begin('resume', { workspaceId: 'target' });
  let release;
  service.previewResume = input => new Promise(resolve => { release = () => resolve({ ...controller.state.targetPreview, mode: input.mode }); });
  const updating = controller.setRestoreMode('merge-current');
  await assert.rejects(controller.execute(), error => error.code === 'operation_busy');
  release();
  await updating;
  assert.equal(controller.state.previewBusy, false);
  assert.equal(controller.state.targetPreview.mode, 'merge-current');
});

test('late restore-mode previews cannot overwrite the most recently chosen destination', async () => {
  const { controller, service } = harness();
  await controller.begin('resume', { workspaceId: 'target' });
  const pending = [];
  service.previewResume = input => new Promise(resolve => { pending.push(() => resolve({ ...controller.state.targetPreview, mode: input.mode })); });
  const first = controller.setRestoreMode('merge-current');
  const second = controller.setRestoreMode('new-window');
  pending[1]();
  await second;
  pending[0]();
  await first;
  assert.equal(controller.state.targetPreview.mode, 'new-window');
  assert.equal(controller.state.previewBusy, false);
});

test('a failed destination preview releases the waiting state and keeps the prior preview', async () => {
  const { controller, service } = harness();
  await controller.begin('resume', { workspaceId: 'target' });
  service.previewResume = async () => { throw new Error('cannot read project'); };
  await assert.rejects(controller.setRestoreMode('merge-current'), /cannot read/);
  assert.equal(controller.state.previewBusy, false);
  assert.equal(controller.state.targetPreview.mode, 'new-window');
});

function focusControl(input = {}) {
  return { hidden: false, disabled: false, isConnected: true, offsetParent: {}, focused: false,
    focus() { this.focused = true; }, ...input };
}

test('result focus waits for enabled visible controls and prefers a retry action', () => {
  assert.equal(typeof api.focusVisibleProjectAction, 'function');
  const retry = focusControl({ disabled: true });
  const done = focusControl({ disabled: true });
  assert.equal(api.focusVisibleProjectAction([retry, done]), undefined);
  assert.equal(retry.focused, false);
  retry.disabled = false;
  done.disabled = false;
  assert.equal(api.focusVisibleProjectAction([retry, done]), retry);
  assert.equal(retry.focused, true);
});

test('complete result focus skips hidden preview actions and chooses Undo or Done', () => {
  assert.equal(typeof api.focusVisibleProjectAction, 'function');
  const hiddenPreview = focusControl({ offsetParent: null });
  const undo = focusControl();
  const done = focusControl();
  assert.equal(api.focusVisibleProjectAction([hiddenPreview, undo, done]), undo);
  undo.hidden = true;
  assert.equal(api.focusVisibleProjectAction([hiddenPreview, undo, done]), done);
});

test('project focus skips hidden dashboard ancestors and prevents a visible fallback from scrolling', () => {
  const hiddenAction = focusControl({ closest: () => ({ hidden: true }) });
  let focusOptions;
  const fallback = focusControl({ focus(options) { focusOptions = options; } });
  assert.equal(api.focusVisibleProjectAction([hiddenAction, fallback]), fallback);
  assert.equal(hiddenAction.focused, false);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test('closing a result restores focus to the replacement project button after list redraw', () => {
  assert.equal(typeof api.restoreProjectFocus, 'function');
  const previous = focusControl({ isConnected: false });
  const unrelated = focusControl({ dataset: { projectId: 'other', projectAction: 'resume' } });
  const replacement = focusControl({ dataset: { projectId: 'atlas', projectAction: 'resume' } });
  const fallback = focusControl();
  const target = api.restoreProjectFocus({ previous, projectId: 'atlas', action: 'resume', buttons: [unrelated, replacement], fallback });
  assert.equal(target, replacement);
  assert.equal(replacement.focused, true);
  assert.equal(previous.focused, false);
});

test('closing a result falls back to Save a project when its original project button is gone', () => {
  assert.equal(typeof api.restoreProjectFocus, 'function');
  const previous = focusControl({ isConnected: false });
  const fallback = focusControl();
  assert.equal(api.restoreProjectFocus({ previous, projectId: 'deleted', action: 'resume', buttons: [], fallback }), fallback);
  assert.equal(fallback.focused, true);
});

test('switch preview excludes target-shared pages from its close count while ordinary parking keeps its count', () => {
  assert.equal(typeof api.projectSelectionImpact, 'function');
  const preview = {
    tabIds: [1, 2, 3, 4, 5], closeTabIds: [2, 3, 4, 5], counts: { selected: 5, closable: 4 },
    candidates: [
      { id: 1, eligible: true, pinned: true, url: 'https://mail.example/' },
      { id: 2, eligible: true, pinned: false, url: 'https://shared.example' },
      ...[3, 4, 5].map(id => ({ id, eligible: true, pinned: false, url: `https://atlas.example/${id}` })),
    ],
  };
  const session = { windows: [{ tabs: [{ url: 'https://shared.example/' }, { url: 'https://beacon.example/' }] }] };
  assert.deepEqual(api.projectSelectionImpact({ mode: 'switch', preview, targetPreview: { session } }), { selected: 5, closable: 3, sharedTabIds: [2] });
  assert.deepEqual(api.projectSelectionImpact({ mode: 'park', preview, targetPreview: { session } }), { selected: 5, closable: 4, sharedTabIds: [] });
  assert.equal(api.projectSelectionImpact({ mode: 'switch', preview, targetPreview: { workspace: { entries: [{ url: 'https://shared.example/' }] } } }).closable, 3);
});

test('a selected set can be saved without a name and receives the first page title', async () => {
  const { controller, calls } = harness();
  await controller.begin('save'); await controller.setSelection([1, 2]);
  assert.equal(controller.state.name, '');
  await controller.execute('save');
  assert.equal(calls.find(([method]) => method === 'save')[1].name, 'Project A code +1');
});

function workbenchListHarness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, handlers: {}, textContent: '', innerHTML: '', hidden: false, open: false,
      style: { display: 'none' }, options: [{}, {}], dataset: {}, value: '',
      setAttribute() {}, querySelectorAll: () => [],
      addEventListener(event, handler) { this.handlers[event] = handler; },
    });
    return nodes.get(id);
  };
  const data = {
    workspaces: [{ id: 'project-a', name: 'Original project name', entries: [{ title: 'Code', url: 'https://code.example/' }] }, { id: 'migrated-a', legacyGroupId: 'collection-a', name: 'Migrated research', entries: [{ title: 'Notes', url: 'https://notes.example/' }] }],
    tabGroups: [{ id: 'collection-a', name: 'Temporary research', tabs: [{ title: 'Notes', url: 'https://notes.example/' }] }],
    deferred: [
      { id: 'later-a', title: 'Read next', url: 'https://read.example/' },
      { id: 'archive-a', title: 'Read before', url: 'https://archive.example/', completed: true },
      { id: 'dismissed-a', title: 'Dismissed', url: 'https://dismissed.example/', dismissed: true },
    ],
  };
  const translations = [];
  const workbench = api.createProjectWorkbench({
    document: { getElementById: node, documentElement: { lang: 'en' } },
    translate(key, params) { translations.push({ key, params }); return params?.n === undefined ? key : `${key}:${params.n}`; },
    workspaceRepository: { list: async () => data.workspaces },
    chromeApi: {
      tabs: { query: async () => [{ id: 1, windowId: 7, url: 'https://code.example/' }] },
      windows: { getCurrent: async () => ({ id: 7 }) },
      storage: { local: { get: async () => data }, onChanged: { addListener() {} } },
    },
    getSavedResult: id => id === 'collection-a' ? { opened: 1, reused: 0, failed: 1 } : null,
  });
  const cardIds = (id, attribute) => [...node(id).innerHTML.matchAll(new RegExp(`<article\\b[^>]*${attribute}="([^"]+)"`, 'g'))].map(match => match[1]);
  return { workbench, data, node, translations, cardIds };
}

test('canonical projects share the main list and read-later active/archive remain separate', async () => {
  const { workbench, node, cardIds, data } = workbenchListHarness();
  const before = structuredClone(data);
  await workbench.refresh();
  assert.deepEqual(cardIds('projectList', 'data-project-id'), ['project-a', 'migrated-a']);
  assert.deepEqual(cardIds('projectList', 'data-saved-id'), []);
  assert.equal(node('projectListCount').textContent, 'project.projectCount:2');
  assert.equal(node('projectEmpty').hidden, true);
  assert.equal(node('savedCollectionsList').innerHTML, '');
  assert.deepEqual(cardIds('savedLaterList', 'data-saved-id'), ['later-a']);
  assert.deepEqual(cardIds('savedArchiveList', 'data-saved-id'), ['archive-a']);
  assert.equal(node('savedCollectionsTitle').textContent, '');
  assert.equal(node('savedLaterTitle').textContent, 'saved.later:2');
  assert.equal(node('savedArchiveTitle').textContent, 'saved.archive:1');
  assert.match(node('projectList').innerHTML, /data-project-action="update"/);
  assert.match(node('projectList').innerHTML, /data-project-action="rename"/);
  assert.match(node('projectList').innerHTML, /data-project-action="delete"/);
  assert.match(node('savedLaterList').innerHTML, /data-saved-kind="deferred"/);
  assert.deepEqual(data, before, 'rendering must preserve original names and stored records');
});

test('legacy records cannot suppress the project empty state, including when only archive remains', async () => {
  const { workbench, node, data, cardIds } = workbenchListHarness();
  data.workspaces = [];
  await workbench.refresh();
  assert.equal(node('projectListCount').textContent, 'project.projectCount:0');
  assert.equal(node('projectEmpty').hidden, false);
  assert.equal(node('projectList').innerHTML, '');
  data.tabGroups = [];
  data.deferred = data.deferred.filter(item => item.completed);
  await workbench.refresh();
  assert.equal(node('projectEmpty').hidden, false);
  assert.equal(node('savedCollectionsTitle').textContent, '');
  assert.equal(node('savedLaterTitle').textContent, 'saved.later:1');
  assert.equal(node('savedArchive').hidden, false);
  assert.deepEqual(cardIds('savedArchiveList', 'data-saved-id'), ['archive-a']);
  data.deferred = [];
  await workbench.refresh();
  assert.equal(node('savedArchive').hidden, true);
  assert.equal(node('savedLaterTitle').textContent, 'saved.later:0');
});

test('refreshing changed records preserves each secondary section disclosure state', async () => {
  const { workbench, node, data } = workbenchListHarness();
  await workbench.refresh();
  assert.equal(node('savedCollections').open, false);
  assert.equal(node('savedLater').open, false);
  node('savedCollections').open = true;
  node('savedLater').open = true;
  node('savedArchive').open = true;
  data.tabGroups.push({ id: 'collection-b', tabs: [] });
  data.workspaces = [];
  await workbench.refresh();
  assert.equal(node('savedCollections').open, true);
  assert.equal(node('savedLater').open, true);
  assert.equal(node('savedArchive').open, true);
  assert.equal(node('savedCollectionsTitle').textContent, '');
  node('savedCollections').open = false;
  await workbench.refresh();
  assert.equal(node('savedCollections').open, false);
  assert.equal(node('savedLater').open, true);
});

test('project scope uses dashboard window ordinals and current-window copy without exposing Chrome IDs', () => {
  const windowNumbers = api.projectWindowNumbers([
    { windowId: 240646169, url: 'https://first.example/' },
    { windowId: 240646180, url: 'https://second.example/' },
    { windowId: 240646120, url: 'chrome://settings/' },
    { windowId: 240646180, url: 'https://another.example/' },
  ], 240646169);
  assert.deepEqual([...windowNumbers], [[240646169, 1], [240646180, 2]]);
  const translate = (key, params) => key === 'project.scopeCurrent' ? '当前窗口' : `窗口 ${params.n}`;
  const state = { currentWindowId: 240646169, windowNumbers };
  assert.equal(api.projectWindowScope(state, 240646169, translate), '当前窗口');
  assert.equal(api.projectWindowScope(state, 240646180, translate), '窗口 2');
  assert.ok(!api.projectWindowScope(state, 240646180, translate).includes('240646180'));
});

test('an explicitly targeted source window preserves real IDs internally and stores readable display ordinals', async () => {
  const { controller, calls } = harness();
  await controller.begin('park', { windowId: 240646169, tabIds: [1] });
  assert.equal(controller.state.windowId, 240646169);
  assert.equal(controller.state.currentWindowId, 7);
  assert.equal(controller.state.windowNumbers.get(240646169), 1);
  assert.equal(calls[0][1].windowId, 240646169);
});


test('adding to an existing saved group keeps the newly selected pages and passes append mode', async () => {
  const { controller, calls } = harness();
  await controller.begin('save', { tabIds: [3], acrossWindows: true });
  await controller.setSource('source');
  assert.deepEqual(controller.state.preview.tabIds, [3]);
  await controller.execute('save');
  const input = calls.find(([method]) => method === 'save')[1];
  assert.equal(input.workspaceId, 'source');
  assert.equal(input.updateMode, 'append');
  assert.deepEqual(input.preview.tabIds, [3]);
});

test('explicit replacement preselects only open saved members and keeps its mode when refreshing', async () => {
  const { controller, calls } = harness();
  await controller.begin('save', { workspaceId: 'source', updateMode: 'replace' });
  assert.deepEqual(controller.state.preview.tabIds, [1, 2]);
  await controller.setSelection([2, 3]);
  await controller.refreshPreview();
  assert.equal(controller.state.updateMode, 'replace');
  assert.deepEqual(controller.state.preview.tabIds, [2, 3]);
  await controller.execute('save');
  assert.equal(calls.find(([method]) => method === 'save')[1].updateMode, 'replace');
});


test('selection refresh cannot silently accept a changed target version; explicit refresh rebuilds the content snapshot', async () => {
  const { controller, service, projects } = harness();
  service.projectFingerprint = workspace => workspace.name;
  const original = service.previewSave;
  service.previewSave = async input => ({ ...(await original(input)), workspaceVersions: { source: projects[0].name } });
  await controller.begin('save', { tabIds: [3] });
  await controller.setSource('source');
  projects[0].name = 'Changed in another document';
  await controller.setSelection([3, 4]);
  assert.equal(controller.state.preview.workspaceVersions.source, 'Project A');
  assert.equal(controller.state.workspaces[0].name, 'Project A');
  await controller.refreshPreview();
  assert.equal(controller.state.preview.workspaceVersions.source, 'Changed in another document');
  assert.equal(controller.state.workspaces[0].name, 'Changed in another document');
});

test('cross-window replacement preselects current-window members only, leaving same-URL copies elsewhere untouched', async () => {
  const { controller, service } = harness();
  const original = service.previewSave;
  service.previewSave = async input => {
    const preview = await original(input);
    preview.candidates = [...preview.candidates.map(tab => ({ ...tab, windowId: 7 })), { id: 8, windowId: 9, url: 'https://code.example/project-a', eligible: true }];
    return preview;
  };
  await controller.begin('save', { workspaceId: 'source', updateMode: 'replace', acrossWindows: true });
  assert.deepEqual(controller.state.preview.tabIds, [1, 2]);
});


test('background saved-list redraw preserves only menus that are currently open by project identity', () => {
  function menu(id, open) { return { open, closest: () => ({ dataset: { projectId: id } }) }; }
  let menus = [menu('a', true), menu('b', false), menu('removed', true)];
  const list = { querySelectorAll: selector => selector.includes('[open]') ? menus.filter(item => item.open) : menus };
  const openIds = api.captureOpenProjectMenus(list);
  // A redraw changes element identity and order, but must not close the user's menu.
  menus = [menu('b', false), menu('new', false), menu('a', false)];
  api.restoreOpenProjectMenus(list, openIds);
  assert.deepEqual(menus.map(item => item.open), [false, false, true]);
  // A deliberate close before the next redraw is respected, not revived from older state.
  menus[2].open = false;
  const closedIds = api.captureOpenProjectMenus(list);
  menus = [menu('a', false), menu('b', false)];
  api.restoreOpenProjectMenus(list, closedIds);
  assert.deepEqual(menus.map(item => item.open), [false, false]);
});


test('redrawing an open saved menu restores keyboard focus by project and action, with a summary fallback', () => {
  let focused;
  function makeMenu(id, actionNames) {
    const menu = { open: true, closest: () => ({ dataset: { projectId: id } }) };
    const control = (tagName, action) => ({ tagName, dataset: { projectAction: action }, offsetParent: {}, isConnected: true, getClientRects: () => [{}], closest: selector => selector === '.project-card-menu' ? menu : selector === '[data-project-action]' && action ? { dataset: { projectAction: action } } : null, focus: options => { focused = { id, tagName, action, options }; } });
    const summary = control('SUMMARY');
    const actions = actionNames.map(name => control('BUTTON', name));
    menu.querySelector = () => summary;
    menu.querySelectorAll = () => actions;
    return { menu, summary, actions };
  }
  const original = makeMenu('saved-a', ['rename', 'replace']);
  let menus = [original.menu];
  const list = { contains: () => true, querySelectorAll: () => menus };
  const snapshot = api.captureProjectMenuFocus(list, original.actions[1]);
  assert.deepEqual(snapshot, { projectId: 'saved-a', action: 'replace' });
  menus = [makeMenu('other', ['replace']).menu, makeMenu('saved-a', ['replace']).menu];
  api.restoreProjectMenuFocus(list, snapshot);
  assert.equal(focused.id, 'saved-a'); assert.equal(focused.action, 'replace'); assert.deepEqual(focused.options, { preventScroll: true });
  menus = [makeMenu('saved-a', ['rename']).menu];
  api.restoreProjectMenuFocus(list, snapshot);
  assert.equal(focused.tagName, 'SUMMARY'); assert.equal(focused.id, 'saved-a');
  list.contains = () => false;
  assert.equal(api.captureProjectMenuFocus(list, original.actions[0]), null, 'focus outside the list is not taken over');
});


test('closing a save-and-put-away result falls back to visible Tabs navigation when the selection toolbar disappears', () => {
  let focused;
  const hiddenSave = { hidden: true, offsetParent: null, focus: () => assert.fail('hidden toolbar must not receive focus') };
  const tabsNavigation = { offsetParent: {}, getClientRects: () => [{}], closest: () => null, focus: options => { focused = options; } };
  const target = api.restoreProjectFocus({ previous: hiddenSave, buttons: [], fallback: hiddenSave, fallbacks: [tabsNavigation] });
  assert.equal(target, tabsNavigation);
  assert.deepEqual(focused, { preventScroll: true });
});
