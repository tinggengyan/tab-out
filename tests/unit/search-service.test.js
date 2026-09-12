'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchIndex, parseSearchQuery, tokenize } = require('../../extension/src/services/search-service.js');

test('tokenize supports English words and Chinese bigrams', () => {
  assert.deepEqual(tokenize('GitHub Pull Request'), ['github', 'pull', 'request']);
  assert.deepEqual(tokenize('项目调研'), ['项目', '目调', '调研']);
});

test('search finds title, URL, domain and workspace names', () => {
  const index = createSearchIndex([
    { id: '1', type: 'open', title: 'Codex issue', url: 'https://github.com/openai/codex/issues/1' },
    { id: '2', type: 'workspace', title: 'Research project', subtitle: 'Market analysis' },
  ]);
  assert.equal(index.search('codex')[0].id, '1');
  assert.equal(index.search('github.com')[0].id, '1');
  assert.equal(index.search('market')[0].id, '2');
});

test('search filters by entity type and returns stable score order', () => {
  const index = createSearchIndex([
    { id: '1', type: 'open', title: 'Alpha Alpha', url: 'https://a.example' },
    { id: '2', type: 'history', title: 'Alpha', url: 'https://b.example' },
  ]);
  assert.deepEqual(index.search('alpha').map(item => item.id), ['1', '2']);
  assert.deepEqual(index.search('alpha', { types: ['history'] }).map(item => item.id), ['2']);
});

test('search returns no results for blank queries and enforces a limit', () => {
  const index = createSearchIndex(Array.from({ length: 20 }, (_, index) => ({ id: String(index), type: 'open', title: 'Same' })));
  assert.deepEqual(index.search(''), []);
  assert.equal(index.search('same', { limit: 5 }).length, 5);
});

test('parseSearchQuery extracts type and ISO date filters', () => {
  assert.deepEqual(parseSearchQuery('design type:history after:2026-01-01 before:2026-02-01'), {
    text: 'design', types: ['history'], after: '2026-01-01', before: '2026-02-01',
  });
});

test('search supports type-only and time range filters', () => {
  const index = createSearchIndex([
    { id: 'old', type: 'history', title: 'Design', capturedAt: '2026-01-01T00:00:00Z' },
    { id: 'new', type: 'history', title: 'Design', capturedAt: '2026-03-01T00:00:00Z' },
    { id: 'tab', type: 'open', title: 'Design', capturedAt: '2026-03-01T00:00:00Z' },
  ]);
  assert.deepEqual(index.search('', { types: ['history'], after: '2026-02-01' }).map(item => item.id), ['new']);
});
