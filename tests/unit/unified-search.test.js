const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const target = '../../extension/src/services/unified-search-service.js';
const api = fs.existsSync(require('node:path').join(__dirname, target)) ? require(target) : {};

test('free search preserves duplicate identity and full URLs', () => {
  assert.equal(typeof api.searchOpenTabs, 'function');
  const tabs = [
    { id: 1, windowId: 10, title: 'API docs', url: 'https://example.com/docs?q=one' },
    { id: 2, windowId: 20, title: 'API docs', url: 'https://example.com/docs?q=one' },
    { id: 3, windowId: 10, title: 'API docs', url: 'https://example.com/docs?q=two' },
  ];
  const results = api.searchOpenTabs('API', tabs);
  assert.deepEqual(results.map(x => [x.tabId, x.windowId, x.duplicateCount]), [[1,10,2],[2,20,2],[3,10,1]]);
});

test('switch targets the selected duplicate, not the first URL match', async () => {
  assert.equal(typeof api.activateSearchResult, 'function');
  const calls = [];
  const chrome = {
    tabs: { get: async id => ({ id, windowId: 20 }), update: async (...args) => calls.push(['tab', ...args]) },
    windows: { update: async (...args) => calls.push(['window', ...args]) },
  };
  await api.activateSearchResult({ type: 'open', tabId: 2 }, chrome);
  assert.deepEqual(calls, [['window',20,{focused:true}],['tab',2,{active:true}]]);
});

test('closed tabs reject without reopening; external search always creates', async () => {
  assert.equal(typeof api.activateSearchResult, 'function');
  const opened = [];
  const chrome = { tabs: { get: async () => { throw new Error('gone'); }, create: async item => opened.push(item) } };
  await assert.rejects(api.activateSearchResult({ type: 'open', tabId: 1, url: 'https://example.com' }, chrome), /stale/);
  assert.equal(opened.length, 0);
  await api.activateSearchResult({ type:'platform', url:'https://example.com/?q=hello' }, chrome);
  assert.deepEqual(opened, [{url:'https://example.com/?q=hello'}]);
  await assert.rejects(api.activateSearchResult({type:'platform',url:'javascript:alert(1)'},chrome));
});
