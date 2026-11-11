'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAICompatibleClient, normalizeOpenAIBaseUrl } = require('../../extension/src/services/openai-compatible-client.js');
const config = { baseUrl: 'https://model.example/v1', model: 'my-model', apiKey: 'private-key' };
function response(value) { return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }); } }; }

test('compatible endpoint accepts a root, API base or full completion URL and rejects URL credentials', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://model.example'), 'https://model.example/v1/chat/completions');
  assert.equal(normalizeOpenAIBaseUrl(config.baseUrl), 'https://model.example/v1/chat/completions');
  assert.equal(normalizeOpenAIBaseUrl('http://localhost:9000/v1/chat/completions'), 'http://localhost:9000/v1/chat/completions');
  for (const url of ['javascript:alert(1)', 'https://name:secret@model.example/v1', 'https://model.example/v1?key=secret', 'https://model.example/#secret']) assert.throws(() => normalizeOpenAIBaseUrl(url), /invalid_model_url/);
});
test('query expansion posts only the query and minimal chat-compatible fields', async () => {
  let request;
  const client = createOpenAICompatibleClient({ fetchImpl: async (url, options) => { request = { url, options }; return response('```json\n{"terms":["量化","memory footprint"]}\n```'); } });
  assert.deepEqual((await client.expand({ query: '上个月本地跑模型的内存文章', config })).terms, ['量化', 'memory footprint']);
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'my-model');
  assert.equal(body.stream, false);
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer private-key');
  assert.equal('tools' in body, false);
  assert.equal('response_format' in body, false);
});
test('model error bodies and network errors never expose credentials', async () => {
  const client = createOpenAICompatibleClient({ fetchImpl: async () => ({ ok: false, status: 401, async text() { return 'private-key SECRET'; } }) });
  await assert.rejects(client.expand({ query: 'query', config }), error => error.code === 'model_http_401' && !error.message.includes('private-key'));
  const network = createOpenAICompatibleClient({ fetchImpl: async () => { throw new Error('private-key failure'); } });
  await assert.rejects(network.expand({ query: 'query', config }), error => error.code === 'model_network' && !error.message.includes('private-key'));
});
test('timeouts are bounded even when a provider ignores AbortSignal', async () => {
  const client = createOpenAICompatibleClient({ fetchImpl: async () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(client.test({ config }), error => error.code === 'model_timeout');
});
test('reranking only accepts candidate IDs and summary requires genuine source quotes', async () => {
  const candidates = [{ id: 'real', title: 'A', url: 'https://real.example/', snippet: 'Actual body' }];
  const client = createOpenAICompatibleClient({ fetchImpl: async () => response({ rankings: [{ id: 'fake', url: 'https://fake.example/' }, { id: 'real', reason: 'Related' }] }) });
  assert.deepEqual((await client.rerank({ query: 'q', candidates, config })).map(item => item.id), ['real']);
  const summary = createOpenAICompatibleClient({ fetchImpl: async () => response({ items: [{ text: 'Supported', sourceIds: ['real'], quote: 'Actual body' }, { text: 'Invented', sourceIds: ['fake'], quote: 'Wrong' }] }) });
  assert.equal((await summary.summarize({ query: 'q', sources: [{ ...candidates[0], text: 'Actual body of the document' }], config })).items.length, 1);
});
test('plain text, missing choices, invented quotes and unsupported model replies fail safely', async () => {
  const invalid = createOpenAICompatibleClient({ fetchImpl: async () => response('not valid JSON private-key') });
  await assert.rejects(invalid.expand({ query: 'q', config }), error => error.code === 'invalid_model_response' && !error.message.includes('private-key'));
  const quotes = createOpenAICompatibleClient({ fetchImpl: async () => response({ items: [{ text: 'Unsupported claim', sourceIds: ['real'], quote: 'not present' }] }) });
  await assert.rejects(quotes.summarize({ query: 'q', config, sources: [{ id: 'real', text: 'Actual source' }] }), error => error.code === 'invalid_citations');
});
test('connection probe has no archive content and supports services without API keys', async () => {
  let request;
  const client = createOpenAICompatibleClient({ fetchImpl: async (_, options) => { request = options; return response('OK'); } });
  assert.deepEqual(await client.test({ config: { ...config, apiKey: '' } }), { ok: true, model: 'my-model' });
  assert.equal('Authorization' in request.headers, false);
  assert.match(JSON.parse(request.body).messages[0].content, /Connection check/);
});
