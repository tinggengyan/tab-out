'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowsingMemorySearchService } = require('../../extension/src/services/browsing-memory-search-service.js');
const now = Date.parse('2026-11-02T08:00:00Z');
function setup(modelClient = {}) {
  let rev = 1;
  const docs = [{ id: 'one', url: 'https://private.example/1', title: '部署随笔', text: '量化可以显著降低本机推理的内存占用。', visitedAt: now - 1000, capturedAt: now - 1000 }, { id: 'two', url: 'https://public.example/2', title: '旅游攻略', text: '', visitedAt: now - 2000, capturedAt: null }];
  const repo = { async revision() { return rev; }, async list({ since }) { return docs.filter(doc => doc.visitedAt >= since); }, async getMany(ids) { return docs.filter(doc => ids.includes(doc.id)); } };
  return { service: createBrowsingMemorySearchService({ repository: repo, modelClient, now: () => now }), mutate() { rev++; docs.length = 0; } };
}
test('semantic query expansion finds content absent from titles, without sending documents by default', async () => {
  let expandArgs;
  const { service } = setup({ async expand(args) { expandArgs = args; return { terms: ['量化', '内存占用'] }; }, async rerank() { throw new Error('must not send content'); } });
  const found = await service.search({ query: '少用点RAM的办法', useAI: true, includeContent: false, config: {} });
  assert.equal(found.mode, 'expanded');
  assert.equal(found.results[0].id, 'one');
  assert.equal(found.results[0].coverage, 'content');
  assert.match(found.results[0].snippet, /内存占用/);
  assert.equal('candidates' in expandArgs, false);
});
test('local search remains available when model calls fail', async () => {
  const { service } = setup({ async expand() { throw Object.assign(new Error('offline'), { code: 'model_network' }); } });
  const found = await service.search({ query: '量化', useAI: true, config: {} });
  assert.equal(found.results[0].id, 'one');
  assert.equal(found.mode, 'local');
  assert.ok(found.warnings.includes('model_network'));
});
test('deleting content during an AI search invalidates the late result', async () => {
  let done;
  const wait = new Promise(resolve => { done = resolve; });
  const { service, mutate } = setup({ async expand() { await wait; return { terms: ['量化'] }; } });
  const pending = service.search({ query: '内存', useAI: true, config: {} });
  await new Promise(resolve => setImmediate(resolve));
  mutate(); done();
  await assert.rejects(pending, error => error.code === 'stale_result');
});
test('summary refuses content disclosure without this-operation consent and refuses metadata-only records', async () => {
  let calls = 0;
  const { service } = setup({ async summarize() { calls++; return { items: [] }; } });
  await assert.rejects(service.summarize({ query: 'q', ids: ['one'], includeContent: false, config: {} }), error => error.code === 'content_permission_required');
  await assert.rejects(service.summarize({ query: 'q', ids: ['two'], includeContent: true, config: {} }), error => error.code === 'no_content');
  assert.equal(calls, 0);
});
test('untrusted model cannot add links or references outside selected records', async () => {
  const { service } = setup({ async summarize() { return { items: [{ text: 'Fake', sourceIds: ['invented'] }, { text: 'True', sourceIds: ['one'], quote: '量化可以显著降低本机推理的内存占用。' }] }; } });
  const result = await service.summarize({ query: 'q', ids: ['one'], includeContent: true, config: {} });
  assert.equal(result.items.length, 1);
  assert.equal(result.sources[0].url, 'https://private.example/1');
});
test('AI disabled never calls a provider even if content consent is set', async () => {
  const { service } = setup({ async expand() { throw new Error('unexpected network'); }, async rerank() { throw new Error('unexpected network'); } });
  const result = await service.search({ query: '量化', useAI: false, includeContent: true });
  assert.equal(result.mode, 'local');
  assert.equal(result.results[0].id, 'one');
  assert.deepEqual(result.warnings, []);
});
test('reranking rejects invented IDs, while content omission remains explicit', async () => {
  let candidatePayload;
  const { service } = setup({ async expand() { return { terms: [] }; }, async rerank(args) { candidatePayload = args.candidates; return [{ id: 'fake', url: 'https://fake.example/' }, { id: 'two' }]; } });
  const result = await service.search({ query: '旅行', useAI: true, includeContent: true, config: {} });
  assert.equal(result.results[0].id, 'two');
  assert.equal(result.results[0].coverage, 'metadata');
  assert.equal(result.results[0].snippet, '');
  assert.equal(result.results.some(item => item.id === 'fake'), false);
  assert.equal(candidatePayload.every(item => !('text' in item)), true);
});
test('late summaries are invalidated after document deletion', async () => {
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  const { service, mutate } = setup({ async summarize() { await waiting; return { items: [{ text: 'Valid', sourceIds: ['one'], quote: '量化可以显著降低本机推理的内存占用。' }] }; } });
  const pending = service.summarize({ query: 'q', ids: ['one'], includeContent: true, config: {} });
  await new Promise(done => setImmediate(done));
  mutate(); resolve();
  await assert.rejects(pending, error => error.code === 'stale_result');
});
test('search respects visit time rather than capture time and never fabricates metadata excerpts', async () => {
  const revision = async () => 1;
  const repository = { revision, async list({ since }) { return [{ id: 'recent', title: '近期标题', url: 'https://a.test', text: '', capturedAt: null, visitedAt: now - 1000 }, { id: 'old', title: '旧标题', url: 'https://b.test', text: '旧记录', capturedAt: now - 1000, visitedAt: now - 50 * 86400000 }].filter(record => record.visitedAt >= since); }, async getMany() { return []; } };
  const service = createBrowsingMemorySearchService({ repository, modelClient: {}, now: () => now });
  const result = await service.search({ query: '', days: 30 });
  assert.equal(result.scanned, 1);
  assert.equal(result.results[0].snippet, '');
  assert.equal(result.results[0].coverage, 'metadata');
});

function recordsService(records, modelClient = {}) {
  const repository = { async revision() { return 1; }, async list() { return records; }, async getMany(ids) { return records.filter(record => ids.includes(record.id)); } };
  return createBrowsingMemorySearchService({ repository, modelClient, now: () => now });
}
function page(id, title, text, url = `https://reading.test/${id}`) { return { id, title, text, url, visitedAt: now - 1000 }; }

test('short Latin queries match complete terms across fields, never incidental word/URL substrings', async () => {
  const service = recordsService([
    page('ai', 'AI assistant', 'Practical AI研究 notes.'),
    page('baike', '古诗解释', '诗词正文', 'https://baike.baidu.com/item/poem'),
    page('paid', 'Ticket notes', 'A paid trail passes a railway station.', 'https://example.test/capital'),
    page('go', 'Go concurrency', 'Go channels.'), page('mango', 'Mango', 'Mango grows in summer.'),
    page('rust', 'Rust notes', 'Rust borrowing.'), page('rustic', 'Rustic house', 'A rustic cottage.'),
  ]);
  assert.deepEqual((await service.search({ query: 'AI' })).results.map(item => item.id), ['ai']);
  assert.deepEqual((await service.search({ query: 'Go' })).results.map(item => item.id), ['go']);
  assert.deepEqual((await service.search({ query: 'Rust' })).results.map(item => item.id), ['rust']);
  for (const query of ['baike.baidu.com', 'https://baike.baidu.com/item/poem']) {
    const result = (await service.search({ query })).results[0];
    assert.equal(result.id, 'baike'); assert.ok(result.matchedFields.includes('url'));
  }
});

test('cleans old fragmented text and navigation at query time while retaining source bytes for citations', async () => {
  const original = 'Home\nMenu\nSign in\nCopyright 2026\nOrbital\nmechanics\nexplains\nsatellite\ntracking.\nNavigation\nAI\nSQL\nRelated posts\nCopyright 2026';
  const record = page('old', 'An old note', original);
  let sentSource;
  const service = recordsService([record], { async summarize({ sources }) { sentSource = sources[0].text; return { items: [{ text: 'Tracking', sourceIds: ['old'], quote: 'satellite\ntracking.' }] }; } });
  const result = (await service.search({ query: 'orbital mechanics' })).results[0];
  assert.equal(result.snippet, 'Orbital mechanics explains satellite tracking.');
  assert.equal(result.snippet.includes('\n'), false);
  assert.deepEqual(result.matchedFields, ['text']);
  assert.ok(result.matchedTerms.includes('orbital'));
  assert.equal(result.snippetParts.map(part => part.text).join(''), result.snippet);
  assert.ok(result.snippetParts.some(part => part.match && part.text.toLowerCase().includes('orbital')));
  assert.equal((await service.search({ query: 'AI' })).results.length, 0);
  await service.summarize({ query: 'tracking', ids: ['old'], includeContent: true });
  assert.equal(sentSource, original); assert.equal(record.text, original);
});

test('Unicode normalization and multilingual matching produce safe literal highlight text', async () => {
  const service = recordsService([page('unicode', 'ＡＩメモ Café Привет 日本語', 'Before <script> ＡＩ助手 studies café and 日本語の記事。')]);
  for (const query of ['AI', 'Café', 'Привет', '日本語']) {
    const result = (await service.search({ query })).results[0];
    assert.equal(result.id, 'unicode');
    assert.equal(result.snippetParts.map(part => part.text).join(''), result.snippet);
    assert.ok(result.matchedTerms.includes(query.normalize('NFKC').toLowerCase()));
  }
  const result = (await service.search({ query: 'AI' })).results[0];
  assert.equal(result.snippetParts.find(part => part.match).text, 'ＡＩ');
  assert.match(result.snippet, /<script>/); // Data is plain text; the UI must render text nodes.
  assert.equal(result.snippetParts.some(part => Object.hasOwn(part, 'html')), false);
});

test('compact excerpts center the matching passage and keep the entire contract under 240 characters', async () => {
  const text = 'An unrelated paragraph. '.repeat(100) + 'Photographic aperture controls the light. ' + 'Another long paragraph. '.repeat(100);
  const result = (await recordsService([page('long', 'Reading note', text)]).search({ query: 'aperture' })).results[0];
  assert.ok(result.snippet.length <= 240); assert.match(result.snippet, /aperture/);
  assert.equal(result.snippetParts.map(part => part.text).join(''), result.snippet);
  assert.ok(result.snippetParts.some(part => part.match && part.text === 'aperture'));
});

test('an aborted search rejects even when a model ignores cancellation and returns a late response', async () => {
  const controller = new AbortController();
  const service = recordsService([page('ai', 'AI', 'A reading note.')], { async expand() { controller.abort(); return { terms: ['reading'] }; } });
  await assert.rejects(service.search({ query: 'AI', useAI: true, signal: controller.signal }), { code: 'model_cancelled' });
});
