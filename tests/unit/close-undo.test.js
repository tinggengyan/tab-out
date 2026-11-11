'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUndoController } = require('../../extension/lib/close-undo.js');

// In-memory stand-in for chrome.tabs / chrome.windows. Like Chrome, a
// window disappears once its last tab is removed, and remove() rejects
// when any id is unknown.
function fakeBrowser(initialTabs) {
  let tabs = initialTabs.map(tab => ({ pinned: false, ...tab }));
  let nextTabId = 1000;
  let nextWindowId = 500;
  const calls = { remove: [], create: [], windowCreate: [] };
  const windowIds = () => [...new Set(tabs.map(tab => tab.windowId))];
  const tabsApi = {
    async query() { return tabs.map(tab => ({ ...tab })); },
    async remove(ids) {
      calls.remove.push([...ids]);
      for (const id of ids) if (!tabs.some(tab => tab.id === id)) throw new Error(`No tab with id: ${id}.`);
      tabs = tabs.filter(tab => !ids.includes(tab.id));
    },
    async create({ windowId, index, url, active }) {
      calls.create.push({ windowId, index, url, active });
      const tab = { id: nextTabId++, windowId, index, url, pinned: false };
      tabs.push(tab);
      return tab;
    },
  };
  const windowsApi = {
    async getAll() { return windowIds().map(id => ({ id })); },
    async create({ url, focused }) {
      const id = nextWindowId++;
      calls.windowCreate.push({ url, focused });
      const tab = { id: nextTabId++, windowId: id, index: 0, url, pinned: false };
      tabs.push(tab);
      return { id, tabs: [tab] };
    },
  };
  return { tabsApi, windowsApi, calls, tabs: () => tabs };
}

const tab = (id, url, windowId, index, extra = {}) => ({ id, url, windowId, index, pinned: false, ...extra });

test('close removes by id and records positions', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://a.test/2', 7, 1), tab(3, 'https://b.test/', 7, 2)]);
  const undo = createUndoController(browser);
  const result = await undo.close([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://a.test/2', 7, 1)], { kind: 'domain' });
  assert.deepEqual(result, { closed: 2, skippedPinned: 0 });
  assert.deepEqual(browser.calls.remove, [[1, 2]]);
  assert.deepEqual(browser.tabs().map(item => item.id), [3]);
  assert.equal(undo.canUndo(), true);
});

test('pinned tabs are never closed', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0, { pinned: true }), tab(2, 'https://a.test/2', 7, 1)]);
  const undo = createUndoController(browser);
  const result = await undo.close([tab(1, 'https://a.test/1', 7, 0, { pinned: true }), tab(2, 'https://a.test/2', 7, 1)]);
  assert.deepEqual(result, { closed: 1, skippedPinned: 1 });
  assert.deepEqual(browser.calls.remove, [[2]]);
});

test('close skips tabs that no longer exist', async () => {
  const browser = fakeBrowser([tab(2, 'https://a.test/2', 7, 1)]);
  const undo = createUndoController(browser);
  const result = await undo.close([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://a.test/2', 7, 1)]);
  assert.deepEqual(result, { closed: 1, skippedPinned: 0 });
  assert.deepEqual(browser.calls.remove, [[2]]);
});

test('closing nothing keeps the previous undo record', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://a.test/2', 7, 1)]);
  const undo = createUndoController(browser);
  await undo.close([tab(1, 'https://a.test/1', 7, 0)], { kind: 'single' });
  const result = await undo.close([tab(99, 'https://gone.test/', 7, 4)], { kind: 'single' });
  assert.deepEqual(result, { closed: 0, skippedPinned: 0 });
  const restored = await undo.undo();
  assert.equal(restored.restored, 1);
  assert.equal(browser.calls.create[0].url, 'https://a.test/1');
});

test('undo restores into the original window at the original index', async () => {
  const browser = fakeBrowser([tab(1, 'https://keep.test/', 7, 0), tab(2, 'https://a.test/2', 7, 2), tab(3, 'https://a.test/5', 7, 5)]);
  const undo = createUndoController(browser);
  await undo.close([tab(3, 'https://a.test/5', 7, 5), tab(2, 'https://a.test/2', 7, 2)]);
  const result = await undo.undo();
  assert.equal(result.restored, 2);
  assert.deepEqual(browser.calls.create.map(call => [call.windowId, call.index, call.url, call.active]),
    [[7, 2, 'https://a.test/2', false], [7, 5, 'https://a.test/5', false]]);
  assert.equal(undo.canUndo(), false);
});

test('undo recreates a closed window', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 9, 0), tab(2, 'https://a.test/2', 9, 1), tab(3, 'https://other.test/', 7, 0)]);
  const undo = createUndoController(browser);
  await undo.close([tab(1, 'https://a.test/1', 9, 0), tab(2, 'https://a.test/2', 9, 1)]);
  await undo.undo();
  assert.equal(browser.calls.windowCreate.length, 1);
  assert.equal(browser.calls.windowCreate[0].url, 'https://a.test/1');
  const newWindowId = browser.tabs().find(item => item.url === 'https://a.test/1').windowId;
  assert.notEqual(newWindowId, 9);
  assert.deepEqual(browser.calls.create.map(call => [call.windowId, call.url]), [[newWindowId, 'https://a.test/2']]);
});

test('undo expires after 30 seconds', async () => {
  let clock = 1000;
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://a.test/2', 7, 1)]);
  const undo = createUndoController({ ...browser, now: () => clock });
  await undo.close([tab(1, 'https://a.test/1', 7, 0)]);
  clock += 30000;
  assert.equal(undo.canUndo(), true);
  clock += 1;
  assert.equal(undo.canUndo(), false);
  assert.equal(await undo.undo(), null);
  assert.equal(browser.calls.create.length, 0);
});

test('undo returns meta so callers can delete a collected record', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://b.test/', 7, 1)]);
  const undo = createUndoController(browser);
  await undo.close([tab(1, 'https://a.test/1', 7, 0)], { kind: 'collect', collectedId: 'c1' });
  const result = await undo.undo();
  assert.equal(result.meta.collectedId, 'c1');
  assert.equal(result.meta.kind, 'collect');
});

test('clear forgets the last operation', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1', 7, 0), tab(2, 'https://b.test/', 7, 1)]);
  const undo = createUndoController(browser);
  await undo.close([tab(1, 'https://a.test/1', 7, 0)]);
  undo.clear();
  assert.equal(undo.canUndo(), false);
  assert.equal(await undo.undo(), null);
});
