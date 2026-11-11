#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixturePath = resolve('tools/fixtures/memory-retrieval.json');
const archivePath = resolve('docs/ai-tasks/2026-11-05-release-convergence/evidence/baseline-sources.tar.gz');
const output = resolve(process.env.TAB_OUT_RETRIEVAL_EVIDENCE || 'docs/ai-tasks/2026-11-05-release-convergence/evidence/retrieval.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'tab-out-retrieval-baseline-'));
const now = Date.parse('2026-11-05T00:00:00Z');
const records = [...fixture.pages, ...fixture.distractors].map(([id, title, url, text], i) => ({ id, title, url, text, visitedAt: now - i * 1000, capturedAt: now - i * 1000 }));
const repository = { list: async () => records, getMany: async ids => records.filter(record => ids.includes(record.id)), revision: async () => 1 };
const require = createRequire(import.meta.url);
async function evaluate(root) {
  const { createBrowsingMemorySearchService } = require(join(root, 'extension/src/services/browsing-memory-search-service.js'));
  const service = createBrowsingMemorySearchService({ repository, now: () => now });
  const rows = [];
  for (const [query, target] of fixture.queries) {
    const response = await service.search({ query, days: 30, limit: 100, useAI: false });
    const ids = response.results.map(item => item.id);
    rows.push({ query, target, targetRank: ids.includes(target) ? ids.indexOf(target) + 1 : null,
      top3: ids.slice(0, 3), resultCount: ids.length,
      distractors: ids.filter(id => fixture.distractors.some(row => row[0] === id)),
      maxSnippetLength: Math.max(0, ...response.results.map(item => item.snippet.length)),
      maxSnippetLines: Math.max(0, ...response.results.map(item => item.snippet.split('\n').length)) });
  }
  const explicitURL = await service.search({ query: 'https://baike.baidu.com/item/poem', useAI: false });
  return { top3Hits: rows.filter(row => row.targetRank && row.targetRank <= 3).length, totalQueries: rows.length,
    explicitURLFound: explicitURL.results.some(item => item.id === 'baike'), rows };
}
try {
  execFileSync('tar', ['-xzf', archivePath, '-C', temporary]);
  const baseline = await evaluate(temporary);
  const current = await evaluate(process.cwd());
  const report = { description: fixture.description, fixture: 'tools/fixtures/memory-retrieval.json',
    rules: 'Known target should rank in the first three. AI must exclude URL-only baike/baidu/paid/trail matches. Snippet <=240 chars and no legacy node-per-line expansion. Explicit URL remains searchable.', baseline, current,
    limitations: ['28 synthetic pages / 20 lexical queries; no statistical user-quality claim.', 'No live provider, embeddings or semantic relevance judgment.', 'No real user records, private content or network calls.'] };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(`Synthetic top-3: before ${baseline.top3Hits}/${baseline.totalQueries}; after ${current.top3Hits}/${current.totalQueries}`);
  console.log(`AI distractors: before ${baseline.rows[0].distractors.join(', ')}; after ${current.rows[0].distractors.join(', ') || '(none)'}`);
  console.log(`Evidence: ${output}`);
  assert.equal(current.top3Hits, current.totalQueries, 'known targets must be found in the top three');
  assert.equal(current.explicitURLFound, true, 'explicit URL must remain searchable');
  assert.ok(!current.rows[0].distractors.some(id => ['baike', 'baidu', 'paid', 'trail'].includes(id)), 'AI must not match incidental URL/word fragments');
  assert.ok(current.rows.every(row => row.maxSnippetLength <= 240), 'snippets must remain compact');
  assert.ok(current.rows.every(row => row.maxSnippetLines <= 3), 'legacy text-node newlines must not expand results');
} finally { await rm(temporary, { recursive: true, force: true }); }
