'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeCleanup } = require('../../extension/src/services/cleanup-analyzer.js');

test('analyzeCleanup reports duplicate extras while preserving one tab', () => {
  const result = analyzeCleanup([
    { id: 1, url: 'https://a.example', pinned: false },
    { id: 2, url: 'https://a.example', pinned: false },
    { id: 3, url: 'https://b.example', pinned: false },
  ]);
  assert.deepEqual(result.duplicates.map(tab => tab.id), [2]);
});

test('analyzeCleanup identifies stale tabs but protects pinned and whitelisted domains', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const old = now - 15 * 86400000;
  const result = analyzeCleanup([
    { id: 1, url: 'https://old.example', lastAccessed: old, pinned: false },
    { id: 2, url: 'https://pinned.example', lastAccessed: old, pinned: true },
    { id: 3, url: 'https://mail.example', lastAccessed: old, pinned: false },
  ], { now, staleDays: 7, whitelist: ['mail.example'] });
  assert.deepEqual(result.stale.map(tab => tab.id), [1]);
  assert.deepEqual(result.protected.map(tab => tab.id).sort(), [2, 3]);
});

test('analyzeCleanup reports overload only above the configured threshold', () => {
  const tabs = Array.from({ length: 6 }, (_, index) => ({ id: index, url: `https://${index}.example` }));
  assert.equal(analyzeCleanup(tabs, { overloadThreshold: 5 }).overload, true);
  assert.equal(analyzeCleanup(tabs, { overloadThreshold: 10 }).overload, false);
});

test('analyzeCleanup ignores browser internal pages', () => {
  const result = analyzeCleanup([{ id: 1, url: 'chrome://settings', lastAccessed: 0 }], { now: Date.now(), staleDays: 1 });
  assert.equal(result.stale.length, 0);
  assert.equal(result.total, 0);
});
