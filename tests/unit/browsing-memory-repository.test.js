'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowsingMemoryRepository, createMemoryBrowsingMemoryStore } = require('../../extension/src/storage/browsing-memory-repository.js');
const now = Date.parse('2026-11-02T08:00:00Z');
function setup() { return createBrowsingMemoryRepository({ store: createMemoryBrowsingMemoryStore(), now: () => now }); }

test('concurrent memory writes persist unique URLs and monotonic revisions', async () => {
  const repo = setup();
  await Promise.all(Array.from({ length: 40 }, (_, n) => repo.upsert({ url: `https://example.com/${n}`, title: `Article ${n}`, visitedAt: now - n })));
  assert.equal((await repo.stats()).total, 40);
  assert.equal(await repo.revision(), 40);
  const before = (await repo.list()).find(item => item.url.endsWith('/0'));
  const updated = await repo.upsert({ url: before.url, title: 'Changed', visitedAt: now });
  assert.equal(updated.id, before.id);
  assert.equal((await repo.stats()).total, 40);
});
test('history metadata never erases recorded content or its capture timestamp', async () => {
  const repo = setup();
  const captured = await repo.upsert({ url: 'https://private.example/doc', title: 'Private doc', text: 'The actual loaded document.', capturedAt: now - 1000, visitedAt: now - 1000, source: 'capture' });
  const updated = await repo.upsert({ url: captured.url, text: '', visitedAt: now, source: 'history' });
  assert.equal(updated.text, captured.text);
  assert.equal(updated.capturedAt, captured.capturedAt);
  assert.equal(updated.visitedAt, now);
});
test('invalid batch import is rejected before any record is written', async () => {
  const repo = setup();
  await repo.upsert({ url: 'https://example.com/kept', visitedAt: now });
  await assert.rejects(repo.importRecords([{ url: 'https://example.com/new', visitedAt: now }, { url: 'javascript:alert(1)', visitedAt: now }]), /invalid_url/);
  assert.equal((await repo.stats()).total, 1);
  await assert.rejects(repo.upsert({ url: 'https://user:secret@example.com', visitedAt: now }), /invalid_url/);
});
test('retention, count and byte budgets evict oldest records with clear revision changes', async () => {
  const repo = setup();
  await repo.importRecords(Array.from({ length: 5 }, (_, n) => ({ url: `https://example.com/${n}`, text: 'x'.repeat(300), visitedAt: now - n * 86400000, capturedAt: now - n * 86400000 })));
  assert.equal((await repo.prune({ retentionDays: 2, maxRecords: 2, maxBytes: 10000 })).removed, 3);
  assert.deepEqual((await repo.list()).map(item => item.url), ['https://example.com/0', 'https://example.com/1']);
  await repo.prune({ retentionDays: 90, maxRecords: 5000, maxBytes: 100 });
  assert.equal((await repo.stats()).total, 0);
});
test('imports merge by URL, ignore foreign IDs and secrets, and deletion is durable', async () => {
  const store = createMemoryBrowsingMemoryStore();
  const repo = createBrowsingMemoryRepository({ store, now: () => now });
  const original = await repo.upsert({ url: 'https://example.com/', visitedAt: now });
  await repo.importRecords([{ id: 'attacker', url: original.url, text: 'Imported body', capturedAt: now, visitedAt: now, apiKey: 'should-never-survive' }]);
  const restarted = createBrowsingMemoryRepository({ store, now: () => now });
  assert.equal((await restarted.list())[0].id, original.id);
  assert.equal(JSON.stringify(await restarted.list()).includes('should-never-survive'), false);
  await restarted.remove([original.id]);
  assert.deepEqual(await repo.getMany([original.id]), []);
  await repo.upsert({ url: 'http://internal/doc', visitedAt: now });
  await repo.clear();
  assert.equal((await restarted.stats()).total, 0);
});
test('maintenance that removes nothing does not invalidate an in-flight search revision', async () => {
  const repo = setup();
  await repo.upsert({ url: 'https://example.com/new', text: 'Body', visitedAt: now });
  const revision = await repo.revision();
  assert.equal((await repo.prune()).removed, 0);
  assert.equal(await repo.revision(), revision);
});
