'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChromeSessionAdapter } = require('../../extension/src/api/chrome-session-adapter.js');

function largeChrome() {
  let nextCreatedTab = 1000;
  let nextWindow = 100;
  let nextGroup = 500;
  const calls = { windows: 0, tabs: 0, groups: 0 };
  const windows = Array.from({ length: 10 }, (_, windowIndex) => ({
    id: windowIndex + 1, focused: windowIndex === 0, incognito: false, state: 'normal',
    tabs: Array.from({ length: 10 }, (_, tabIndex) => ({
      id: windowIndex * 10 + tabIndex + 1, windowId: windowIndex + 1, index: tabIndex,
      url: `https://example.com/${windowIndex}/${tabIndex}`, title: `Tab ${windowIndex}-${tabIndex}`,
      active: tabIndex === 0, pinned: tabIndex === 0, groupId: windowIndex * 2 + Math.floor(tabIndex / 5) + 1,
    })),
  }));
  return {
    calls,
    windows: {
      async getAll() { return structuredClone(windows); },
      async create({ url }) { calls.windows += 1; return { id: nextWindow++, tabs: url ? [{ id: nextCreatedTab++, url }] : [] }; },
    },
    tabs: {
      async create(props) { calls.tabs += 1; return { id: nextCreatedTab++, ...props }; },
      async update() {}, async move() {},
      async group() { calls.groups += 1; return nextGroup++; },
    },
    tabGroups: {
      async get(id) { return { id, title: `Group ${id}`, color: 'blue', collapsed: id % 2 === 0 }; },
      async update() {},
    },
  };
}

test('100 tabs across 10 windows and 20 native groups capture and restore without loss', async () => {
  const chrome = largeChrome();
  const adapter = createChromeSessionAdapter(chrome, { id: () => 'large-session', now: () => '2026-08-10T00:00:00Z' });
  const session = await adapter.captureAll('manual');
  assert.deepEqual(session.stats, { windowCount: 10, tabCount: 100, groupCount: 20 });
  const result = await adapter.restoreSession(session, { mode: 'new-window' });
  assert.equal(result.succeeded, 100);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(chrome.calls, { windows: 10, tabs: 90, groups: 20 });
});
