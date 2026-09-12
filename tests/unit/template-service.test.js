'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTemplateService } = require('../../extension/src/services/template-service.js');

test('createFromWorkspace excludes private URLs unless explicitly requested', () => {
  const service = createTemplateService({ id: () => 't1' });
  const workspace = { id: 'w1', name: 'Research', color: '#123', entries: [{ url: 'https://private.example', title: 'Private' }] };
  assert.deepEqual(service.createFromWorkspace(workspace).entries, []);
  assert.equal(service.createFromWorkspace(workspace, { includeUrls: true }).entries.length, 1);
});

test('instantiate creates a workspace and applies template rules', async () => {
  const calls = [];
  const service = createTemplateService();
  const workspace = await service.instantiate({
    name: 'Development', color: '#456', entries: [],
    rules: [{ pattern: 'github.com', mode: 'suggest' }],
  }, {
    workspaceRepository: { async create(input) { calls.push(['workspace', input]); return { id: 'w1', ...input }; } },
    ruleRepository: { async create(input) { calls.push(['rule', input]); return input; } },
  });
  assert.equal(workspace.id, 'w1');
  assert.equal(calls[1][1].workspaceId, 'w1');
  assert.equal(calls[1][1].pattern, 'github.com');
});

test('builtInTemplates contain no private URLs', () => {
  const service = createTemplateService();
  assert.equal(service.builtInTemplates().length >= 3, true);
  assert.equal(service.builtInTemplates().every(template => template.entries.length === 0), true);
});
