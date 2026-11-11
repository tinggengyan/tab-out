'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, searchAll, highlight, flattenBookmarks, dayBucket } = require('../../extension/lib/search.js');

const keys = result => result.groups.map(group => group.key);
const items = (result, key) => result.groups.find(group => group.key === key)?.items || [];

test('tokenize lowercases and splits on whitespace', () => {
  assert.deepEqual(tokenize('  Rust   ASYNC '), ['rust', 'async']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize(undefined), []);
});

test('an empty query finds nothing', () => {
  const result = searchAll({ query: ' ', tabs: [{ id: 1, url: 'https://a.test/', title: 'A' }] });
  assert.deepEqual(result.groups, []);
});

test('every word must appear in the title or the address, in any case', () => {
  const tabs = [
    { id: 1, windowId: 1, url: 'https://github.com/rust-lang/rust', title: 'Compiler' },
    { id: 2, windowId: 1, url: 'https://youtube.com/watch', title: 'Rust in 100 seconds' },
    { id: 3, windowId: 1, url: 'https://example.com/', title: 'Rust only' },
  ];
  const result = searchAll({ query: 'RUST github', tabs });
  assert.deepEqual(items(result, 'tabs').map(item => item.id), [1]);
  assert.deepEqual(items(searchAll({ query: 'rust', tabs }), 'tabs').map(item => item.id), [1, 2, 3]);
});

test('Chinese matches as a substring', () => {
  const saved = [{ id: 's1', url: 'https://blog.test/1', title: 'Rust 错误处理的几种模式', savedAt: '2026-11-09T00:00:00Z' }];
  assert.equal(items(searchAll({ query: '错误处理', saved }), 'saved').length, 1);
});

test('groups come in a fixed order and empty groups are left out', () => {
  const page = title => ({ url: `https://x.test/${title}`, title });
  const result = searchAll({
    query: 'q',
    tabs: [{ id: 1, windowId: 1, ...page('q-tab') }],
    saved: [],
    stash: [{ id: 'r1', name: 'Other', savedAt: '2026-11-01T00:00:00Z', tabs: [page('q-stash')] }],
    bookmarks: [{ id: 'b1', ...page('q-bookmark'), path: [] }],
    history: [{ ...page('q-history'), lastVisitTime: 1 }],
  });
  assert.deepEqual(keys(result), ['tabs', 'stash', 'bookmarks', 'history']);
});

test('bookmarks and history are left out entirely until they are granted', () => {
  const result = searchAll({ query: 'q', tabs: [{ id: 1, windowId: 1, url: 'https://q.test/', title: 'q' }], bookmarks: null, history: null });
  assert.deepEqual(keys(result), ['tabs']);
});

test('saved for later only searches items that are neither done nor dismissed', () => {
  const saved = [
    { id: 'a', url: 'https://a.test/', title: 'match open', savedAt: '2026-11-01T00:00:00Z' },
    { id: 'b', url: 'https://b.test/', title: 'match done', completed: true },
    { id: 'c', url: 'https://c.test/', title: 'match gone', dismissed: true },
  ];
  assert.deepEqual(items(searchAll({ query: 'match', saved }), 'saved').map(item => item.id), ['a']);
  assert.deepEqual(items(searchAll({ query: 'match', saved }), 'saved')[0],
    { kind: 'saved', id: 'a', url: 'https://a.test/', title: 'match open', savedAt: '2026-11-01T00:00:00Z' });
});

test('a record name finds the record; its pages are found by their own title or address', () => {
  const stash = [
    { id: 'r1', name: 'Rust async reading', savedAt: '2026-11-07T00:00:00Z', tabs: [
      { url: 'https://without.boats/pin', title: 'Async Rust: Pin' },
      { url: 'https://tokio.rs/tutorial', title: 'Tokio tutorial' },
    ] },
    { id: 'r2', savedAt: '2026-11-05T00:00:00Z', tabs: [{ url: 'https://youtube.com/rustconf', title: 'RustConf keynote' }] },
  ];
  const found = items(searchAll({ query: 'rust', stash }), 'stash');
  assert.deepEqual(found, [
    { kind: 'record', recordId: 'r1', name: 'Rust async reading', count: 2, savedAt: '2026-11-07T00:00:00Z' },
    { kind: 'stashPage', recordId: 'r1', recordName: 'Rust async reading', savedAt: '2026-11-07T00:00:00Z', url: 'https://without.boats/pin', title: 'Async Rust: Pin' },
    { kind: 'stashPage', recordId: 'r2', recordName: '', savedAt: '2026-11-05T00:00:00Z', url: 'https://youtube.com/rustconf', title: 'RustConf keynote' },
  ]);
});

test('bookmarks and history keep only http, https and file addresses', () => {
  const result = searchAll({
    query: 'tool',
    bookmarks: [
      { id: 'b1', url: 'javascript:alert(1)', title: 'tool bookmarklet', path: [] },
      { id: 'b2', url: 'https://tool.test/', title: 'tool site', path: ['Bar'] },
      { id: 'b3', url: 'file:///Users/me/tool.html', title: 'tool file', path: [] },
    ],
    history: [
      { url: 'data:text/html,tool', title: 'tool data', lastVisitTime: 3 },
      { url: 'chrome-extension://abc/index.html', title: 'tool tab out', lastVisitTime: 2 },
      { url: 'http://tool.test/old', title: 'tool old', lastVisitTime: 1 },
    ],
  });
  assert.deepEqual(items(result, 'bookmarks').map(item => item.id), ['b2', 'b3']);
  assert.deepEqual(items(result, 'history').map(item => item.url), ['http://tool.test/old']);
});

test('history drops pages shown in an earlier group, repeats, and sorts newest first', () => {
  const result = searchAll({
    query: 'page',
    tabs: [{ id: 1, windowId: 1, url: 'https://open.test/', title: 'open page' }],
    saved: [{ id: 's', url: 'https://saved.test/', title: 'saved page' }],
    stash: [{ id: 'r', savedAt: '2026-11-01T00:00:00Z', tabs: [{ url: 'https://stash.test/', title: 'stash page' }] }],
    bookmarks: [{ id: 'b', url: 'https://mark.test/', title: 'marked page', path: [] }],
    history: [
      { url: 'https://open.test/', title: 'open page', lastVisitTime: 50 },
      { url: 'https://saved.test/', title: 'saved page', lastVisitTime: 40 },
      { url: 'https://stash.test/', title: 'stash page', lastVisitTime: 30 },
      { url: 'https://mark.test/', title: 'marked page', lastVisitTime: 20 },
      { url: 'https://older.test/', title: 'older page', lastVisitTime: 5 },
      { url: 'https://newer.test/', title: 'newer page', lastVisitTime: 9 },
      { url: 'https://newer.test/', title: 'newer page', lastVisitTime: 9 },
    ],
  });
  assert.deepEqual(items(result, 'history'), [
    { kind: 'history', url: 'https://newer.test/', title: 'newer page', lastVisitTime: 9 },
    { kind: 'history', url: 'https://older.test/', title: 'older page', lastVisitTime: 5 },
  ]);
});

test('a page without a title is still found by its address', () => {
  const history = [{ url: 'https://docs.rs/serde', title: '', lastVisitTime: 1 }];
  assert.equal(items(searchAll({ query: 'serde', history }), 'history').length, 1);
});

test('highlight marks every occurrence of every word, case-insensitively', () => {
  assert.equal(highlight('Rust and rust-lang', ['rust']), '<mark>Rust</mark> and <mark>rust</mark>-lang');
  assert.equal(highlight('Plain', []), 'Plain');
});

test('highlight merges overlapping words into one mark', () => {
  assert.equal(highlight('asynchronous', ['async', 'sync']), '<mark>async</mark>hronous');
  assert.equal(highlight('abcdef', ['abc', 'cde']), '<mark>abcde</mark>f');
});

test('highlight escapes markup around marks', () => {
  assert.equal(highlight('<img src=x> "rust" & co', ['rust']), '&lt;img src=x&gt; &quot;<mark>rust</mark>&quot; &amp; co');
  assert.equal(highlight('<b>', ['b']), '&lt;<mark>b</mark>&gt;');
});

test('highlight falls back to plain text when case folding changes length', () => {
  assert.equal(highlight('İstanbul <x>', ['stan']), 'İstanbul &lt;x&gt;');
});

test('flattenBookmarks lists pages with their folder path below the root', () => {
  const tree = [{ id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks bar', children: [
      { id: '10', title: 'Learn', children: [{ id: '100', title: 'Rust book', url: 'https://doc.rust-lang.org/book/' }] },
      { id: '11', title: 'Top', url: 'https://top.test/' },
    ] },
    { id: '2', title: 'Other bookmarks', children: [] },
  ] }];
  assert.deepEqual(flattenBookmarks(tree), [
    { id: '100', title: 'Rust book', url: 'https://doc.rust-lang.org/book/', path: ['Bookmarks bar', 'Learn'] },
    { id: '11', title: 'Top', url: 'https://top.test/', path: ['Bookmarks bar'] },
  ]);
  assert.deepEqual(flattenBookmarks(undefined), []);
});

test('dayBucket tells today and yesterday apart by calendar day', () => {
  const now = new Date(2026, 10, 12, 0, 30).getTime();
  assert.equal(dayBucket(new Date(2026, 10, 12, 0, 1).getTime(), now), 'today');
  assert.equal(dayBucket(new Date(2026, 10, 11, 23, 59).getTime(), now), 'yesterday');
  assert.equal(dayBucket(new Date(2026, 10, 11, 0, 0).getTime(), now), 'yesterday');
  assert.equal(dayBucket(new Date(2026, 10, 10, 23, 59).getTime(), now), 'earlier');
});
