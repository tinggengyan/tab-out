'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compilePattern, matchWorkspaceRules } = require('../../extension/src/domain/rule-engine.js');

test('compilePattern matches exact domains and URL wildcards', () => {
  assert.equal(compilePattern('github.com')('https://github.com/openai/codex'), true);
  assert.equal(compilePattern('github.com')('https://notgithub.com/'), false);
  assert.equal(compilePattern('https://github.com/openai/*')('https://github.com/openai/codex/issues'), true);
  assert.equal(compilePattern('https://github.com/openai/*')('https://github.com/other/repo'), false);
});

test('compilePattern rejects executable or malformed patterns', () => {
  assert.throws(() => compilePattern('javascript:*'), /invalid/i);
  assert.throws(() => compilePattern(''), /invalid/i);
});

test('matchWorkspaceRules returns enabled matches and honors exclusions', () => {
  const rules = [
    { id: 'r1', workspaceId: 'w1', pattern: 'github.com', enabled: true, mode: 'suggest' },
    { id: 'r2', workspaceId: 'w2', pattern: '*.example.com', enabled: false, mode: 'auto' },
  ];
  assert.deepEqual(matchWorkspaceRules('https://github.com/openai/codex', rules).map(rule => rule.id), ['r1']);
  assert.deepEqual(matchWorkspaceRules('https://github.com/openai/codex', rules, ['github.com']), []);
});

test('wildcard subdomain patterns do not match the bare parent domain', () => {
  const matcher = compilePattern('*.example.com');
  assert.equal(matcher('https://docs.example.com/page'), true);
  assert.equal(matcher('https://example.com/page'), false);
});
