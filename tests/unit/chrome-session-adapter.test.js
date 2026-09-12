'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChromeSessionAdapter } = require('../../extension/src/api/chrome-session-adapter.js');

function fakeChrome() {
  const calls = [];
  let nextTabId = 100;
  return {
    calls,
    windows: {
      async getAll() {
        return [{
          id: 9, focused: true, incognito: false, state: 'normal',
          tabs: [
            { id: 1, windowId: 9, index: 0, url: 'https://a.example', title: 'A', active: true, pinned: true, groupId: 7 },
            { id: 2, windowId: 9, index: 1, url: 'https://b.example', title: 'B', active: false, pinned: false, groupId: 7 },
          ],
        }];
      },
      async create(props) {
        const firstTab = props?.url ? { id: nextTabId++, url: props.url } : undefined;
        calls.push(['windows.create', props, firstTab?.id]);
        return { id: 20, tabs: firstTab ? [firstTab] : [] };
      },
    },
    tabGroups: {
      async get(id) { return { id, title: 'Research', color: 'blue', collapsed: true }; },
      async update(id, props) { calls.push(['tabGroups.update', id, props]); },
    },
    tabs: {
      async create(props) { const tab = { id: nextTabId++, ...props }; calls.push(['tabs.create', props, tab.id]); return tab; },
      async move(ids, props) { calls.push(['tabs.move', ids, props]); },
      async update(id, props) { calls.push(['tabs.update', id, props]); },
      async group(props) { calls.push(['tabs.group', props]); return 40; },
    },
  };
}

test('captureTabs keeps only requested tabs and preserves native group metadata', async () => {
  const chrome = fakeChrome();
  const adapter = createChromeSessionAdapter(chrome, {
    deviceId: 'device-1',
    now: () => '2026-08-10T00:00:00.000Z',
    id: () => 'session-1',
  });
  const session = await adapter.captureTabs([2]);

  assert.equal(session.windows[0].tabs.length, 1);
  assert.equal(session.windows[0].tabs[0].url, 'https://b.example/');
  assert.equal(session.windows[0].groups[0].title, 'Research');
  assert.deepEqual(session.windows[0].groups[0].tabIds, ['tab:2']);
});

test('captureAll captures every normal-window tab using the requested snapshot type', async () => {
  const chrome = fakeChrome();
  const adapter = createChromeSessionAdapter(chrome, {
    deviceId: 'device-1',
    now: () => '2026-08-10T00:00:00.000Z',
    id: () => 'session-all',
  });
  const session = await adapter.captureAll('manual');
  assert.equal(session.id, 'session-all');
  assert.equal(session.type, 'manual');
  assert.equal(session.stats.tabCount, 2);
  assert.equal(session.stats.groupCount, 1);
});

test('restoreSession recreates tab order, pinned state and native groups', async () => {
  const chrome = fakeChrome();
  const adapter = createChromeSessionAdapter(chrome, { deviceId: 'device-1' });
  const session = await adapter.captureTabs([1, 2]);
  const result = await adapter.restoreSession(session, { mode: 'new-window' });

  assert.equal(result.succeeded, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(chrome.calls.find(call => call[0] === 'windows.create')[1].url, 'https://a.example/');
  assert.equal(chrome.calls.filter(call => call[0] === 'tabs.create').length, 1);
  assert.equal(chrome.calls.some(call => call[0] === 'tabs.group'), true);
  assert.equal(chrome.calls.some(call => call[0] === 'tabGroups.update' && call[2].title === 'Research'), true);
  assert.equal(chrome.calls.some(call => call[0] === 'tabs.update' && call[2].pinned === true), true);
});

test('restoreSession reports unsupported URLs without failing valid tabs', async () => {
  const chrome = fakeChrome();
  const adapter = createChromeSessionAdapter(chrome, { deviceId: 'device-1' });
  const result = await adapter.restoreSession({
    windows: [{ tabs: [
      { id: 'a', url: 'chrome://settings', restorable: false, index: 0 },
      { id: 'b', url: 'https://ok.example', restorable: true, index: 1 },
    ], groups: [] }],
  });

  assert.equal(result.succeeded, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'unsupported_url');
});

test('native group failures retain safe retry data and can be retried without reopening tabs', async () => {
  const chrome = fakeChrome();
  let attempts = 0;
  chrome.tabs.group = async props => {
    chrome.calls.push(['tabs.group', props]);
    if (attempts++ === 0) throw new Error('temporary group failure');
    return 41;
  };
  const adapter = createChromeSessionAdapter(chrome, { deviceId: 'device-1' });
  const session = await adapter.captureTabs([1, 2]);
  const first = await adapter.restoreSession(session, { mode: 'new-window' });
  const failure = first.failed.find(item => item.code === 'group_restore_failed');
  assert.deepEqual(failure.targetTabIds, [100, 101]);
  assert.equal(failure.group.title, 'Research');
  const createdBeforeRetry = chrome.calls.filter(call => call[0] === 'tabs.create').length;
  const retry = await adapter.retryGroupFailures([failure]);
  assert.equal(retry.succeeded, 1);
  assert.equal(retry.failed.length, 0);
  assert.equal(chrome.calls.filter(call => call[0] === 'tabs.create').length, createdBeforeRetry);
});

test('capture never persists incognito windows even when the extension can see them', async () => {
  const chrome = fakeChrome();
  const original = chrome.windows.getAll;
  chrome.windows.getAll = async () => [...await original(), { id: 10, incognito: true, tabs: [{ id: 3, windowId: 10, index: 0, url: 'https://private.example', title: 'Private' }] }];
  const adapter = createChromeSessionAdapter(chrome, { id: () => 'safe' });
  const session = await adapter.captureAll();
  assert.equal(session.windows.length, 1);
  assert.equal(session.windows.some(window => window.incognito), false);
});
