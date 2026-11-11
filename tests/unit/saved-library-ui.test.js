'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { savedDefaultName, legacySavedItems, createSavedContinuation } = require('../../extension/src/ui/saved-library.js');
const { buildSession } = require('../../extension/src/domain/session.js');
const { createChromeSessionAdapter } = require('../../extension/src/api/chrome-session-adapter.js');

test('unified saved read model includes legacy groups and active/archive deferred without modifying records', () => {
  const groups = [{ id: 'g', tabs: [{ title: 'Read me', url: 'https://docs.example/read' }] }];
  const deferred = [{ id: 'active', url: 'https://a.example/' }, { id: 'archived', completed: true, title: 'Archive', url: 'https://b.example/' }, { id: 'deleted', dismissed: true }];
  const before = structuredClone({ groups, deferred });
  const items = legacySavedItems(groups, deferred);
  assert.deepEqual(items.map(item => [item.id, item.kind, Boolean(item.archived)]), [['g', 'collected', false], ['active', 'deferred', false], ['archived', 'deferred', true]]);
  assert.equal(items[0].name, 'Read me');
  assert.deepEqual({ groups, deferred }, before);
});

test('optional save name derives from content instead of internal id or date', () => {
  assert.equal(savedDefaultName([{ title: 'Architecture notes', url: 'https://docs.example/a' }, { url: 'https://docs.example/b' }]), 'Architecture notes +1');
  assert.equal(savedDefaultName([{ title: 'https://docs.example/a', url: 'https://docs.example/a' }]), 'docs.example');
});

test('legacy continuation reuses existing pages, keeps full asset and retries failures in the same layout window', async () => {
  const session = buildSession({ windows: [{ id: 55, tabs: [
    { id: 1, url: 'https://docs.example/open', title: 'Already open', index: 0 },
    { id: 2, url: 'https://docs.example/one', title: 'One', index: 1, pinned: true, groupId: 8 },
    { id: 3, url: 'https://docs.example/two', title: 'Two', index: 2, groupId: 8 },
  ] }], groups: [{ id: 8, title: 'Reading', color: 'green', collapsed: true }] });
  const group = { id: 'legacy', tabs: session.windows[0].tabs.map(tab => ({ url: tab.url, title: tab.title })), session };
  const before = structuredClone(group);
  const tabs = [{ id: 10, windowId: 7, url: 'https://docs.example/open' }];
  const windows = new Map([[7, { id: 7 }]]);
  let failOnce = true; let next = 11;
  const creates = []; const groups = []; const metadata = [];
  const chromeApi = {
    tabs: {
      query: async () => tabs,
      create: async props => {
        creates.push(props);
        if (props.url.endsWith('/two') && failOnce) { failOnce = false; throw new Error('One failure'); }
        const tab = { id: next++, ...props }; tabs.push(tab); return tab;
      },
      update: async (id, props) => { metadata.push([id, props]); },
      group: async props => { groups.push(props); return 88; },
    },
    windows: { create: async props => { const tab = { id: next++, windowId: 9, url: props.url }; tabs.push(tab); windows.set(9, { id: 9 }); return { id: 9, tabs: [tab] }; }, get: async id => windows.get(id) },
    tabGroups: { update: async (id, props) => { metadata.push([id, props]); } },
  };
  const resume = createSavedContinuation({ chromeApi, sessionAdapter: createChromeSessionAdapter(chromeApi) });
  const first = await resume(group);
  assert.equal(first.failed, 1); assert.equal(first.opened, 1); assert.equal(first.reused, 1);
  assert.deepEqual(group, before, 'saved asset is never deleted or rewritten on partial success');
  const second = await resume(group);
  assert.equal(second.failed, 0); assert.equal(second.opened, 1);
  assert.equal(tabs.filter(tab => tab.url.endsWith('/one')).length, 1);
  assert.equal(tabs.filter(tab => tab.url.endsWith('/two')).length, 1);
  assert.equal(creates.at(-1).windowId, 9, 'retry uses the window already created');
  assert.equal(groups.at(-1).groupId, 88, 'retry preserves original native group mapping');
  assert.ok(metadata.some(([, props]) => props.title === 'Reading' && props.collapsed === true && props.color === 'green'));
  assert.ok(metadata.some(([, props]) => props.pinned === true));
  assert.deepEqual(group, before);
});

function combinedGroupFixture({ failGroupCalls = [1], failUpdateCalls = [], failCreate = true, reusedPage = true } = {}) {
  const names = reusedPage ? ['a', 'b', 'c', 'reused'] : ['a', 'b', 'c'];
  const session = buildSession({ windows: [{ id: 7, tabs: names.map((name, index) => ({ id: index + 1, url: `https://fixture.example/${name}`, groupId: 8, index })) }], groups: [{ id: 8, title: 'Reading', color: 'green', collapsed: true }] });
  const source = { id: 'combined', session };
  const original = JSON.stringify(source);
  const tabs = reusedPage ? [{ id: 1, windowId: 6, groupId: 44, url: 'https://fixture.example/reused' }] : [];
  const groupCalls = []; const updateCalls = []; const createCalls = []; const windowCalls = [];
  let nextTab = 10; let nextGroup = 90; let failCreateOnce = failCreate;
  const chromeApi = {
    tabs: {
      query: async () => tabs,
      create: async props => {
        createCalls.push(props);
        if (props.url.endsWith('/c') && failCreateOnce) { failCreateOnce = false; throw new Error('Create failed'); }
        const tab = { ...props, id: nextTab++, groupId: -1 }; tabs.push(tab); return tab;
      },
      update: async () => {},
      group: async props => {
        groupCalls.push(structuredClone(props));
        if (failGroupCalls.includes(groupCalls.length)) throw new Error('Group failed');
        const groupId = props.groupId ?? nextGroup++;
        for (const tab of tabs) if (props.tabIds.includes(tab.id)) tab.groupId = groupId;
        return groupId;
      },
    },
    windows: {
      create: async props => { windowCalls.push(props); const tab = { id: nextTab++, windowId: 70, url: props.url, groupId: -1 }; tabs.push(tab); return { id: 70, tabs: [tab] }; },
      get: async () => ({ id: 70 }),
    },
    tabGroups: { update: async (groupId, props) => { updateCalls.push({ groupId, props }); if (failUpdateCalls.includes(updateCalls.length)) throw new Error('Group metadata failed'); } },
  };
  const resume = createSavedContinuation({ chromeApi, sessionAdapter: createChromeSessionAdapter(chromeApi) });
  const ownedTabs = () => tabs.filter(tab => !tab.url.endsWith('/reused'));
  const assertKept = () => {
    assert.equal(JSON.stringify(source), original, 'the saved asset is byte-for-byte unchanged');
    if (reusedPage) assert.deepEqual(tabs.find(tab => tab.id === 1), { id: 1, windowId: 6, groupId: 44, url: 'https://fixture.example/reused' });
  };
  const assertRecovered = result => {
    assert.equal(result.status, 'complete'); assert.equal(result.failed, 0);
    assert.equal(new Set(ownedTabs().map(tab => tab.groupId)).size, 1, 'all newly restored source-group members must share one native group');
    assert.ok(ownedTabs().every(tab => tab.groupId >= 0));
    assert.equal(new Set(ownedTabs().map(tab => tab.url)).size, 3);
    assert.equal(ownedTabs().length, 3, 'successful pages are not recreated on retry');
    assert.equal(windowCalls.length, 1);
    assertKept();
    assert.deepEqual(updateCalls.at(-1).props, { title: 'Reading', color: 'green', collapsed: true });
  };
  return { chromeApi, source, resume, tabs, ownedTabs, groupCalls, updateCalls, createCalls, assertKept, assertRecovered };
}

test('combined create and native-group failure retry consolidates all owned members without moving an already open page', async () => {
  const h = combinedGroupFixture();
  const first = await h.resume(h.source);
  assert.equal(first.failed, 2); assert.equal(first.opened, 2); h.assertKept();
  const second = await h.resume(h.source);
  h.assertRecovered(second);
  assert.equal(second.opened, 1);
  assert.equal(h.groupCalls.at(-1).groupId, 90, 'the group created for the missing member is reused for all owned members');
  assert.equal(h.groupCalls.at(-1).tabIds.length, 3);
});

test('a repeated group failure keeps the full merged membership retryable without reopening successful pages', async () => {
  const h = combinedGroupFixture({ failGroupCalls: [1, 2, 3] });
  await h.resume(h.source);
  const second = await h.resume(h.source);
  assert.equal(second.status, 'partial'); assert.equal(second.failed, 1); h.assertKept();
  assert.equal(second.failures[0].targetTabIds.length, 3, 'retry must retain old and newly created group members');
  const third = await h.resume(h.source);
  h.assertRecovered(third);
  assert.equal(third.opened, 0);
});

test('consolidated group metadata failure keeps a single mapping for a later retry', async () => {
  const h = combinedGroupFixture({ failUpdateCalls: [2] });
  await h.resume(h.source);
  const second = await h.resume(h.source);
  assert.equal(second.status, 'partial'); assert.equal(second.failed, 1); h.assertKept();
  assert.equal(second.failures[0].existingGroupId, 90);
  const third = await h.resume(h.source);
  h.assertRecovered(third);
  assert.equal(third.opened, 0);
  assert.equal(h.groupCalls.at(-1).groupId, 90);
});

test('metadata-only group failures retry through the real adapter without creating successful pages again', async () => {
  const h = combinedGroupFixture({ failCreate: false, failGroupCalls: [], failUpdateCalls: [1], reusedPage: false });
  const first = await h.resume(h.source);
  assert.equal(first.status, 'partial'); assert.equal(first.failed, 1);
  const second = await h.resume(h.source);
  h.assertRecovered(second);
  assert.equal(second.opened, 0);
});

test('a successful page closed between retries is recreated once and its stale ID is excluded from group repair', async () => {
  const h = combinedGroupFixture();
  await h.resume(h.source);
  const closed = h.tabs.find(tab => tab.url.endsWith('/a'));
  h.tabs.splice(h.tabs.indexOf(closed), 1);
  const second = await h.resume(h.source);
  h.assertRecovered(second);
  assert.equal(second.opened, 2, 'only the closed member and previously failed member are created');
  assert.ok(h.groupCalls.at(-1).tabIds.every(id => h.tabs.some(tab => tab.id === id)));
  assert.ok(!h.groupCalls.at(-1).tabIds.includes(closed.id));
});

function strictRetryFixture({ grouped = true, failCreateOnce = grouped, failPinnedOnce = !grouped, failGroupMetadataOnce = false, vanishBeforeGroup = false, vanishBeforeUpdate = false, temporaryGroupError = false } = {}) {
  const tabs = []; const windows = new Map(); const groups = new Map();
  const calls = { group: [], groupGet: [], update: [], create: [], groupUpdate: [] };
  let nextTab = 10; let nextWindow = 70; let nextGroup = 90;
  let createFailure = failCreateOnce; let pinnedFailure = failPinnedOnce; let groupMetadataFailure = failGroupMetadataOnce;
  let groupRace = false; let updateRace = false; let temporaryError = false;
  const api = {
    tabs: {
      query: async () => tabs,
      create: async props => {
        calls.create.push(props);
        if (props.url.endsWith('/c') && createFailure) { createFailure = false; throw new Error('Create failed'); }
        if (!windows.has(props.windowId)) throw new Error(`No window with id ${props.windowId}`);
        const tab = { id: nextTab++, groupId: -1, ...props }; tabs.push(tab); return tab;
      },
      update: async (id, props) => {
        calls.update.push({ id, props });
        const tab = tabs.find(tab => tab.id === id);
        if (!tab) throw new Error(`No tab with id ${id}`);
        if (pinnedFailure && 'pinned' in props) { pinnedFailure = false; throw new Error('Pinned update failed'); }
        Object.assign(tab, props);
      },
      group: async props => {
        calls.group.push(structuredClone(props));
        if (groupRace && props.groupId !== undefined) { groupRace = false; groups.delete(props.groupId); }
        if (temporaryError) { temporaryError = false; throw new Error('Temporary grouping error'); }
        if (props.groupId !== undefined && !groups.has(props.groupId)) throw new Error(`No group with id ${props.groupId}`);
        for (const id of props.tabIds) if (!tabs.some(tab => tab.id === id)) throw new Error(`No tab with id ${id}`);
        const id = props.groupId ?? nextGroup++;
        const windowId = props.createProperties?.windowId ?? groups.get(id)?.windowId ?? tabs.find(tab => tab.id === props.tabIds[0]).windowId;
        groups.set(id, { ...(groups.get(id) || {}), windowId });
        for (const tab of tabs) if (props.tabIds.includes(tab.id)) { tab.groupId = id; tab.windowId = windowId; }
        return id;
      },
    },
    windows: {
      create: async props => { const id = nextWindow++; windows.set(id, { id }); const tab = { id: nextTab++, url: props.url, groupId: -1, windowId: id }; tabs.push(tab); return { id, tabs: [tab] }; },
      get: async id => { if (!windows.has(id)) throw new Error(`No window with id ${id}`); return windows.get(id); },
    },
    tabGroups: {
      get: async id => { calls.groupGet.push(id); if (!groups.has(id)) throw new Error(`No group with id ${id}`); return { id, ...groups.get(id) }; },
      update: async (id, props) => {
        calls.groupUpdate.push({ id, props });
        if (updateRace) { updateRace = false; groups.delete(id); }
        if (!groups.has(id)) throw new Error(`No group with id ${id}`);
        if (groupMetadataFailure) { groupMetadataFailure = false; throw new Error('Temporary group metadata error'); }
        groups.set(id, { ...groups.get(id), ...props });
      },
    },
  };
  const names = grouped ? ['a', 'b', 'c'] : ['a'];
  const session = buildSession({ windows: [{ id: 1, tabs: names.map((name, index) => ({ id: index + 1, index, url: `https://fixture.example/${name}`, pinned: !grouped, ...(grouped ? { groupId: 8 } : {}) })) }], groups: grouped ? [{ id: 8, title: 'Reading', color: 'green', collapsed: true }] : [] });
  const source = { id: 'stale-retry', session }; const original = JSON.stringify(source);
  const resume = createSavedContinuation({ chromeApi: api, sessionAdapter: createChromeSessionAdapter(api) });
  const closeAll = () => { tabs.length = 0; groups.clear(); windows.clear(); };
  const armRace = () => { groupRace = vanishBeforeGroup; updateRace = vanishBeforeUpdate; temporaryError = temporaryGroupError; };
  const assertKept = () => assert.equal(JSON.stringify(source), original);
  const assertComplete = result => {
    assert.equal(result.status, 'complete'); assert.equal(result.failed, 0); assertKept();
    assert.equal(tabs.length, names.length); assert.equal(new Set(tabs.map(tab => tab.url)).size, names.length);
    if (grouped) {
      assert.equal(new Set(tabs.map(tab => tab.groupId)).size, 1);
      assert.ok(groups.has(tabs[0].groupId));
      assert.deepEqual(groups.get(tabs[0].groupId), { windowId: tabs[0].windowId, title: 'Reading', color: 'green', collapsed: true });
    } else assert.ok(tabs.every(tab => tab.pinned === true));
  };
  return { api, source, tabs, groups, windows, calls, closeAll, armRace, resume, assertKept, assertComplete };
}

test('expired group and window mappings are discarded before restoring pages into a replacement window', async () => {
  const h = strictRetryFixture();
  assert.equal((await h.resume(h.source)).failed, 1);
  h.closeAll(); const before = h.calls.group.length;
  h.assertComplete(await h.resume(h.source));
  assert.ok(h.calls.groupGet.includes(90));
  assert.ok(h.calls.group.slice(before).every(call => call.groupId !== 90));
  const third = await h.resume(h.source); h.assertComplete(third); assert.equal(third.opened, 0);
});

test('an expired existingGroupId on a previous metadata failure is not reused after the group disappears', async () => {
  const h = strictRetryFixture({ failGroupMetadataOnce: true });
  const first = await h.resume(h.source); assert.equal(first.failed, 2);
  assert.equal(first.failures.find(failure => failure.code === 'group_restore_failed').existingGroupId, 90);
  h.closeAll(); const before = h.calls.group.length;
  h.assertComplete(await h.resume(h.source));
  assert.ok(h.calls.group.slice(before).every(call => call.groupId !== 90));
  h.assertComplete(await h.resume(h.source));
});

test('closed tab metadata targets are discarded and replacement pages receive their own pinned state', async () => {
  const h = strictRetryFixture({ grouped: false });
  const first = await h.resume(h.source); assert.equal(first.failed, 1);
  const staleTabId = h.tabs[0].id;
  h.closeAll(); const before = h.calls.update.length;
  h.assertComplete(await h.resume(h.source));
  assert.ok(h.calls.update.slice(before).every(call => call.id !== staleTabId));
  const third = await h.resume(h.source); h.assertComplete(third); assert.equal(third.opened, 0);
});

test('still-live group and metadata retry targets remain reusable', async () => {
  const group = strictRetryFixture();
  await group.resume(group.source); group.assertComplete(await group.resume(group.source));
  assert.equal(group.tabs[0].groupId, 90);
  assert.ok(group.calls.groupGet.includes(90));
  const metadata = strictRetryFixture({ grouped: false });
  await metadata.resume(metadata.source); const liveId = metadata.tabs[0].id;
  const second = await metadata.resume(metadata.source); metadata.assertComplete(second);
  assert.equal(second.opened, 0); assert.equal(metadata.tabs[0].id, liveId);
  assert.ok(metadata.calls.update.filter(call => call.id === liveId && call.props.pinned === true).length >= 2);
});

test('a group disappearing after validation is recreated once and preserves one complete native group', async () => {
  const h = strictRetryFixture({ vanishBeforeGroup: true });
  await h.resume(h.source); h.armRace();
  h.assertComplete(await h.resume(h.source));
  assert.ok(h.tabs.every(tab => tab.groupId !== 90));
  assert.equal(h.tabs.length, 3);
});

test('a group disappearing between grouping and property update is recreated once', async () => {
  const h = strictRetryFixture({ failCreateOnce: false, failGroupMetadataOnce: true, vanishBeforeUpdate: true });
  await h.resume(h.source); h.armRace();
  h.assertComplete(await h.resume(h.source));
  h.assertComplete(await h.resume(h.source));
});

test('an ordinary transient grouping error remains partial and its live group mapping is retried next time', async () => {
  const h = strictRetryFixture({ temporaryGroupError: true });
  await h.resume(h.source); h.armRace();
  const second = await h.resume(h.source);
  assert.equal(second.status, 'partial'); assert.equal(second.failed, 1); h.assertKept();
  assert.equal(second.failures[0].existingGroupId, 90);
  h.assertComplete(await h.resume(h.source));
  assert.ok(h.tabs.every(tab => tab.groupId === 90));
});

test('a group disappearing during facade-only retry is recreated once without any page creation', async () => {
  const h = strictRetryFixture({ failCreateOnce: false, failGroupMetadataOnce: true, vanishBeforeGroup: true });
  assert.equal((await h.resume(h.source)).failed, 1);
  h.armRace();
  const second = await h.resume(h.source); h.assertComplete(second);
  assert.equal(second.opened, 0);
  assert.ok(h.tabs.every(tab => tab.groupId !== 90));
});

test('a mapping moved to another window is not used to move new or already-open pages', async () => {
  const h = strictRetryFixture();
  await h.resume(h.source);
  h.windows.set(800, { id: 800 });
  h.groups.get(90).windowId = 800;
  h.tabs.forEach(tab => { tab.windowId = 800; });
  const priorTabs = h.tabs.map(tab => ({ ...tab }));
  const before = h.calls.group.length;
  const result = await h.resume(h.source);
  assert.equal(result.failed, 0); h.assertKept();
  assert.deepEqual(h.tabs.filter(tab => priorTabs.some(prior => prior.id === tab.id)), priorTabs);
  const added = h.tabs.find(tab => tab.url.endsWith('/c'));
  assert.equal(added.windowId, 70); assert.notEqual(added.groupId, 90);
  assert.ok(h.calls.group.slice(before).every(call => call.groupId !== 90));
});

async function migratedProjectResume(h) {
  const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');
  const { createProjectService } = require('../../extension/src/services/project-service.js');
  const api = h.api || h.chromeApi;
  let data = { tabGroups: [{ ...h.source, tabs: h.source.session.windows.flatMap(window => window.tabs) }] };
  const area = { get: async key => ({ [key]: structuredClone(data[key]) }), set: async update => { Object.assign(data, structuredClone(update)); } };
  const repository = createWorkspaceRepository(area);
  const project = (await repository.list())[0];
  const service = createProjectService({ chromeApi: api, workspaceRepository: repository, sessionAdapter: createChromeSessionAdapter(api), operationService: {} });
  let preview = await service.previewResume({ workspaceId: project.id });
  return async () => {
    const result = await service.resume({ preview });
    preview = result.retryPreview || await service.previewResume({ workspaceId: project.id });
    assert.equal((await repository.list()).length, 1);
    assert.equal((await repository.get(project.id)).legacyGroupId, h.source.id);
    return { ...result, ...result.counts };
  };
}
test('migrated canonical project consolidates simultaneous create/group failures through projectService', async () => {
  const h = combinedGroupFixture(); const resume = await migratedProjectResume(h);
  const first = await resume(); assert.equal(first.failed, 2);
  h.assertRecovered(await resume());
});
test('migrated canonical project reopens all missing pages after the successful group/window disappears', async () => {
  const h = strictRetryFixture(); const resume = await migratedProjectResume(h);
  assert.equal((await resume()).failed, 1); h.closeAll();
  h.assertComplete(await resume()); h.assertComplete(await resume());
});
test('migrated canonical project drops closed metadata targets and pins replacement pages', async () => {
  const h = strictRetryFixture({ grouped: false }); const resume = await migratedProjectResume(h);
  assert.equal((await resume()).failed, 1); h.closeAll();
  h.assertComplete(await resume()); h.assertComplete(await resume());
});
