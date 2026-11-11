'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { escapeHtml, normalizeWebUrl } = require('../../extension/src/shared/sanitize.js');

const app = fs.readFileSync(path.join(__dirname, '../../extension/app.js'), 'utf8');
function sourceBetween(start, end) {
  const offset = app.indexOf(start);
  return app.slice(offset, app.indexOf(end, offset + start.length));
}

function createHarness() {
  const nodes = new Map();
  const timers = new Map();
  let timerId = 0;
  let tabs = [];
  let queries = 0;
  const event = () => ({
    listeners: [],
    addListener(listener) { this.listeners.push(listener); },
    emit(...args) { this.listeners.forEach(listener => listener(...args)); },
  });
  const chrome = {
    runtime: { id: 'tab-out-test' },
    tabs: {
      query: async () => { queries++; return tabs; },
      onCreated: event(), onRemoved: event(), onUpdated: event(),
    },
    storage: { local: { get: async () => ({}) }, onChanged: event() },
  };
  const context = vm.createContext({
    chrome, URL, console, escapeHtml, TabOutCore: { normalizeWebUrl }, selectedSaveTabIds: new Set(), updateTabsSelectionToolbar() {},
    openTabs: [], domainGroups: [], openTabsViewMode: 'domain', _currentLocale: 'en',
    ICONS: { close: '' }, t: key => key, tPlural: key => key,
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { style: { display: 'none' }, innerHTML: '', setAttribute() {} });
        return nodes.get(id);
      },
      querySelectorAll: () => [],
    },
    renderDomainCard: group => group.tabs.map(tab => `${tab.url} ${tab.title}`).join('\n'),
    checkTabOutDupes() {}, renderDeferredColumn: async () => {}, renderTabGroups: async () => {},
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext([
    sourceBetween('async function fetchOpenTabs()', '\n/**'),
    sourceBetween('function getRealTabs()', '\n/**'),
    sourceBetween('async function renderStaticDashboard()', '\nasync function renderDashboard()'),
    app.slice(app.indexOf('let commandRefreshTimer;')),
  ].join('\n'), context);
  return {
    context, chrome, nodes,
    setTabs(value) { tabs = value; },
    queryCount: () => queries,
    async flush() {
      while (timers.size) {
        const callbacks = [...timers.values()];
        timers.clear();
        await Promise.all(callbacks.map(callback => callback()));
      }
    },
  };
}

test('restored tabs appear in their domain before navigation commits', async () => {
  const harness = createHarness();
  harness.setTabs([{ id: 7, windowId: 1, url: 'about:blank', pendingUrl: 'https://restored.example/report' }]);
  await harness.context.renderStaticDashboard();
  assert.equal(harness.nodes.get('openTabsSection').style.display, 'block');
  assert.match(harness.nodes.get('openTabsMissions').innerHTML, /https:\/\/restored\.example\/report/);
});

test('pending Tab Out pages retain their identity and stay out of domain cards', async () => {
  const harness = createHarness();
  harness.setTabs([{ id: 8, url: '', pendingUrl: 'chrome-extension://tab-out-test/index.html' }]);
  await harness.context.fetchOpenTabs();
  assert.equal(harness.context.openTabs[0].isTabOut, true);
  assert.equal(harness.context.getRealTabs().length, 0);
});

test('navigation completion refreshes restored tab titles without reloading the page', async () => {
  const harness = createHarness();
  harness.setTabs([{ id: 7, windowId: 1, url: 'https://restored.example/report', title: 'Loading' }]);
  await harness.context.renderStaticDashboard();
  harness.setTabs([{ id: 7, windowId: 1, url: 'https://restored.example/report', title: 'Restored report' }]);
  harness.chrome.tabs.onUpdated.emit(7, { status: 'complete', title: 'Restored report' });
  await harness.flush();
  assert.match(harness.nodes.get('openTabsMissions').innerHTML, /Restored report/);
});

test('tab event bursts share a refresh and removed tabs disappear from the dashboard', async () => {
  const harness = createHarness();
  await harness.context.renderStaticDashboard();
  harness.setTabs([{ id: 7, windowId: 1, url: 'https://restored.example/report', title: 'Report' }]);
  harness.chrome.tabs.onCreated.emit({ id: 7 });
  harness.chrome.tabs.onUpdated.emit(7, { url: 'https://restored.example/report' });
  harness.chrome.tabs.onUpdated.emit(7, { title: 'Report' });
  await harness.flush();
  assert.equal(harness.queryCount(), 2);
  assert.equal(harness.nodes.get('openTabsSection').style.display, 'block');
  harness.setTabs([]);
  harness.chrome.tabs.onRemoved.emit(7);
  await harness.flush();
  assert.equal(harness.nodes.get('openTabsSection').style.display, 'none');
});

test('favicon-only updates do not redraw the dashboard', async () => {
  const harness = createHarness();
  await harness.context.renderStaticDashboard();
  harness.chrome.tabs.onUpdated.emit(7, { favIconUrl: 'https://restored.example/icon.png' });
  await harness.flush();
  assert.equal(harness.queryCount(), 1);
});
