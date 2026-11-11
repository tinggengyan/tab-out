'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isRealTabUrl, groupTabsBySite, duplicateTabIds, faviconUrl } = require('../../extension/lib/grouping.js');

let nextId = 1;
const tab = (url, extra = {}) => ({ id: nextId++, url, title: url, windowId: 1, index: 0, active: false, pinned: false, ...extra });

test('isRealTabUrl excludes browser-internal pages', () => {
  assert.equal(isRealTabUrl('https://example.com'), true);
  assert.equal(isRealTabUrl('file:///tmp/a.md'), true);
  for (const url of ['chrome://newtab/', 'chrome-extension://abc/index.html', 'about:blank', 'edge://settings', 'brave://settings', '']) {
    assert.equal(isRealTabUrl(url), false, url);
  }
});

test('groupTabsBySite puts landing pages first and groups by hostname', () => {
  const groups = groupTabsBySite([
    tab('https://github.com/a/b'),
    tab('file:///tmp/a.md'),
    tab('https://x.com/home'),
    tab('https://github.com/a/b'),
  ], {});
  assert.deepEqual(groups.map(group => group.domain), ['__landing-pages__', 'github.com', 'local-files']);
  assert.equal(groups[1].tabs.length, 2);
});

test('landing page rules match the original patterns', () => {
  const groups = groupTabsBySite([
    tab('https://mail.google.com/mail/u/0/#inbox'),
    tab('https://mail.google.com/mail/u/0/#inbox/FMfcg'),
    tab('https://github.com/'),
    tab('https://www.youtube.com/watch?v=1'),
  ], {});
  const landing = groups.find(group => group.domain === '__landing-pages__');
  assert.deepEqual(landing.tabs.map(item => item.url), ['https://mail.google.com/mail/u/0/#inbox', 'https://github.com/']);
});

test('custom group rule merges hostnames under groupKey', () => {
  const groups = groupTabsBySite([
    tab('https://a.docs.example.com/x'),
    tab('https://b.docs.example.com/y'),
  ], { customGroups: [{ hostnameEndsWith: '.docs.example.com', groupKey: 'docs', groupLabel: 'Docs' }] });
  assert.deepEqual(groups, [{ domain: 'docs', label: 'Docs', tabs: groups[0].tabs }]);
  assert.equal(groups[0].tabs.length, 2);
});

test('extra landing patterns from config are honoured', () => {
  const groups = groupTabsBySite([tab('https://news.ycombinator.com/')], { landingPatterns: [{ hostname: 'news.ycombinator.com' }] });
  assert.equal(groups[0].domain, '__landing-pages__');
});

test('duplicateTabIds keeps the active copy', () => {
  const tabs = [tab('https://a.test/x', { id: 1 }), tab('https://a.test/x', { id: 2, active: true }), tab('https://a.test/x', { id: 3 }), tab('https://a.test/y', { id: 4 })];
  assert.deepEqual(duplicateTabIds(tabs), [1, 3]);
});

test('duplicateTabIds keeps the first copy when none is active', () => {
  const tabs = [tab('https://a.test/x', { id: 7 }), tab('https://a.test/x', { id: 8 })];
  assert.deepEqual(duplicateTabIds(tabs), [8]);
});

test('duplicateTabIds keeps a pinned copy and never returns pinned tabs', () => {
  const tabs = [tab('https://a.test/x', { id: 1 }), tab('https://a.test/x', { id: 2, pinned: true })];
  assert.deepEqual(duplicateTabIds(tabs), [1]);
  const bothPinned = [tab('https://a.test/z', { id: 5, pinned: true }), tab('https://a.test/z', { id: 6, pinned: true })];
  assert.deepEqual(duplicateTabIds(bothPinned), []);
});

test('faviconUrl uses the extension favicon endpoint and never google', () => {
  const url = faviconUrl('https://a.test/x?y=1', 'extid');
  assert.equal(url, 'chrome-extension://extid/_favicon/?pageUrl=https%3A%2F%2Fa.test%2Fx%3Fy%3D1&size=16');
  assert.doesNotMatch(url, /google/);
});
