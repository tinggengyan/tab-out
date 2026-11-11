'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExport, parseImport } = require('../../extension/lib/config-io.js');

const shortcuts = [{ id: 's1', name: 'Mail', url: 'https://mail.test/' }];
const deferred = [{ id: 'd1', url: 'https://read.test/', title: 'Read', savedAt: '2026-11-01T00:00:00.000Z', completed: false, dismissed: false }];
const collectedGroups = [{ id: 'c1', savedAt: '2026-11-10T00:00:00.000Z', name: 'Docs', tabs: [{ url: 'https://docs.test/', title: 'Docs' }] }];

test('parseImport accepts v3 export round-trip', () => {
  const exported = buildExport({ shortcuts, deferred, collectedGroups }, '2026-11-11T00:00:00.000Z');
  assert.equal(exported.version, 3);
  assert.equal(exported.exportedAt, '2026-11-11T00:00:00.000Z');
  assert.deepEqual(parseImport(JSON.parse(JSON.stringify(exported))), { shortcuts, deferred, collectedGroups });
});

test('parseImport converts v1 tabGroups', () => {
  const parsed = parseImport({ version: 1, shortcuts, deferred, tabGroups: [{ id: '1716', savedAt: '2026-05-21T00:00:00.000Z', tabs: [{ url: 'https://a.test/', title: 'A' }] }] });
  assert.deepEqual(parsed.shortcuts, shortcuts);
  assert.deepEqual(parsed.deferred, deferred);
  assert.equal(parsed.collectedGroups.length, 1);
  assert.equal(parsed.collectedGroups[0].sourceId, 'tabGroup:1716');
  assert.deepEqual(parsed.collectedGroups[0].tabs, [{ url: 'https://a.test/', title: 'A' }]);
});

test('parseImport converts v2.3 backup workspaces', () => {
  const backup = {
    version: 2,
    exportedAt: '2026-11-06T00:00:00.000Z',
    data: {
      shortcuts,
      deferred,
      workspacesV2: [
        { id: 'w1', name: 'Payments', entries: [{ id: 'e1', url: 'https://pay.test/a', title: 'Pay A' }] },
        { id: 'w2', name: 'Docs', entries: [{ id: 'e2', url: 'https://docs.test/b', title: 'Docs B' }] },
      ],
      snapshotsV2: [{ ignored: true }],
    },
  };
  const parsed = parseImport(backup);
  assert.deepEqual(parsed.shortcuts, shortcuts);
  assert.deepEqual(parsed.deferred, deferred);
  assert.equal(parsed.collectedGroups.length, 2);
  assert.equal(parsed.collectedGroups[0].tabs[0].url, 'https://pay.test/a');
  assert.equal(parsed.collectedGroups[0].name, 'Payments');
  assert.equal(parsed.collectedGroups[1].sourceId, 'workspace:w2');
});

test('parseImport rejects unrelated json', () => {
  assert.equal(parseImport({ foo: 1 }), null);
  assert.equal(parseImport(null), null);
  assert.equal(parseImport('text'), null);
  assert.equal(parseImport({ version: 2, data: { snapshotsV2: [] } }), null);
});
