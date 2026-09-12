'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchIndex } = require('../../extension/src/services/search-service.js');

for (const size of [100, 1000, 10000]) {
  test(`local search returns stable results across ${size} assets`, () => {
    const assets = Array.from({ length: size }, (_, index) => ({
      id: String(index), type: index % 2 ? 'history' : 'workspace',
      title: index === size - 1 ? 'Needle target document' : `Project document ${index}`,
      url: `https://example.com/project/${index}`, capturedAt: '2026-08-10T00:00:00Z',
    }));
    const started = Date.now();
    const index = createSearchIndex(assets);
    const results = index.search('needle target', { limit: 20 });
    assert.equal(results[0].id, String(size - 1));
    assert.ok(Date.now() - started < 5000, 'index and query should complete within five seconds');
  });
}
