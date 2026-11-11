'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortableBackup, mergePortableData, validatePortableBackup } = require('../../extension/src/services/backup-service.js');

test('portable backup includes user assets and settings but excludes entitlement and migration backups', () => {
  const backup = createPortableBackup({
    shortcuts: [{ id: 's', name: 'Docs', url: 'https://example.com' }],
    snapshotsV2: [{ id: 'snapshot' }],
    workspacesV2: [{ id: 'workspace' }],
    entitlementV1: { token: 'secret' },
    migrationBackupV1: { legacy: true },
  }, { now: '2026-08-10T00:00:00.000Z' });
  assert.equal(backup.version, 2);
  assert.deepEqual(Object.keys(backup.data).sort(), ['shortcuts', 'snapshotsV2', 'workspacesV2'].sort());
  assert.equal(backup.exportedAt, '2026-08-10T00:00:00.000Z');
});

test('portable backup round-trips validated search platforms', () => {
  const searchPlatformsV1 = [{
    id: 'docs', name: 'Docs', aliases: ['d'], domain: 'docs.example.com',
    searchUrlTemplate: 'https://docs.example.com/search?q={Query}',
  }];
  const backup = createPortableBackup({ searchPlatformsV1 });
  assert.deepEqual(backup.data.searchPlatformsV1, searchPlatformsV1);
  assert.deepEqual(validatePortableBackup(backup).data.searchPlatformsV1, searchPlatformsV1);
});

test('portable backup validation returns normalized search platform configuration', () => {
  const payload = createPortableBackup({ searchPlatformsV1: [{
    id: 'docs', name: ' Ｄｏｃｓ ', aliases: [' d ', 'Ｄ'], domain: 'DOCS.EXAMPLE.COM',
    searchUrlTemplate: ' https://docs.example.com/search?q={Query} ',
  }] });
  const result = validatePortableBackup(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.searchPlatformsV1[0], {
    id: 'docs', name: 'Docs', aliases: ['d'], domain: 'docs.example.com',
    searchUrlTemplate: 'https://docs.example.com/search?q={Query}',
  });
});

test('portable backup rejects invalid search platform configuration', () => {
  const payload = createPortableBackup({ searchPlatformsV1: [{
    id: 'bad', name: 'Bad', aliases: [], domain: 'example.com',
    searchUrlTemplate: 'javascript:alert({Query})',
  }] });
  const result = validatePortableBackup(payload);
  assert.equal(result.ok, false);
  assert.match(result.error, /searchUrlTemplate/);
});

test('portable backup validation rejects executable URLs and unknown keys', () => {
  assert.equal(validatePortableBackup({ version: 2, data: { shortcuts: [{ url: 'javascript:alert(1)' }] } }).ok, false);
  assert.equal(validatePortableBackup({ version: 2, data: { madeUp: [] } }).ok, false);
});

test('portable backup preserves explicitly unsupported browser pages without allowing executable URLs', () => {
  assert.equal(validatePortableBackup({ version: 2, data: { snapshotsV2: [{ windows: [{ tabs: [{ url: 'chrome://settings', restorable: false }] }] }] } }).ok, true);
  assert.equal(validatePortableBackup({ version: 2, data: { snapshotsV2: [{ windows: [{ tabs: [{ url: 'javascript:alert(1)', restorable: false }] }] }] } }).ok, false);
});

test('portable backup validation enforces size, nesting, and collection limits', () => {
  assert.equal(validatePortableBackup({ version: 2, data: { shortcuts: new Array(3).fill({}) } }, { maxItems: 2 }).ok, false);
  assert.equal(validatePortableBackup({ version: 2, data: { shortcuts: [{ name: 'x'.repeat(20) }] } }, { maxStringLength: 10 }).ok, false);
});

test('portable backup rejects malformed known collections before they reach UI repositories', () => {
  assert.equal(validatePortableBackup({ version: 2, data: { workspacesV2: [{ id: 'w', entries: 'not-an-array' }] } }).ok, false);
  assert.equal(validatePortableBackup({ version: 2, data: { snapshotsV2: [{ id: 's', windows: [{ tabs: null, groups: [] }] }] } }).ok, false);
  assert.equal(validatePortableBackup({ version: 2, data: { automaticSnapshotsEnabledV1: 'yes' } }).ok, false);
});

test('portable backup returns an isolated safe copy', () => {
  const payload = { version: 2, data: { workspacesV2: [{ id: 'w', entries: [{ url: 'https://example.com' }] }] } };
  const result = validatePortableBackup(payload);
  assert.equal(result.ok, true);
  result.data.workspacesV2[0].id = 'changed';
  assert.equal(payload.data.workspacesV2[0].id, 'w');
});

test('portable merge keeps local records and lets imported ids win conflicts', () => {
  const current = { workspacesV2: [{ id: 'local', name: 'Local' }, { id: 'same', name: 'Old' }], automaticSnapshotsEnabledV1: false };
  const incoming = { workspacesV2: [{ id: 'same', name: 'Imported' }, { id: 'new', name: 'New' }], automaticSnapshotsEnabledV1: true };
  const result = mergePortableData(current, incoming);
  assert.deepEqual(result.data.workspacesV2.map(item => item.name), ['Local', 'Imported', 'New']);
  assert.equal(result.data.automaticSnapshotsEnabledV1, true);
  assert.equal(result.conflicts, 1);
});

test('portable merge keeps local search platforms and omits conflicting imported commands', () => {
  const current = { searchPlatformsV1: [{
    id: 'local', name: 'Local Docs', aliases: ['docs'], domain: 'local.example',
    searchUrlTemplate: 'https://local.example/{Query}',
  }] };
  const incoming = { searchPlatformsV1: [
    { id: 'conflict', name: 'Imported', aliases: ['DOCS'], domain: 'imported.example', searchUrlTemplate: 'https://imported.example/{Query}' },
    { id: 'new', name: 'Search', aliases: ['s'], domain: 'search.example', searchUrlTemplate: 'https://search.example/{Query}' },
  ] };
  const result = mergePortableData(current, incoming);
  assert.deepEqual(result.data.searchPlatformsV1.map(item => item.id), ['local', 'new']);
  assert.equal(result.conflicts, 1);
  assert.deepEqual(validateSearchPlatformsForTest(result.data.searchPlatformsV1).map(item => item.id), ['local', 'new']);
});

function validateSearchPlatformsForTest(platforms) {
  return require('../../extension/src/services/platform-search-service.js').validateSearchPlatforms(platforms);
}

test('project backup preserves session layout and rejects malformed project sessions', () => {
  const session = { windows: [{ sourceWindowId: 7, tabs: [{ id: 'tab:1', url: 'https://project.example/', title: 'Project', index: 3, pinned: false }], groups: [{ ref: 'group:2', title: 'Research', color: 'green', tabIds: ['tab:1'] }] }] };
  const workspace = { id: 'project', name: 'Project', entries: [{ url: 'https://project.example/' }], session };
  const validated = validatePortableBackup(createPortableBackup({ workspacesV2: [workspace] }));
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.data.workspacesV2[0].session, session);
  assert.equal(validatePortableBackup(createPortableBackup({ workspacesV2: [{ ...workspace, session: { windows: 'bad' } }] })).ok, false);
});

test('every portable session container rejects malformed nested members before repositories can receive them', () => {
  const { invalidSessionFixtures } = require('../helpers/session-import-fixtures.js');
  for(const {name,session} of invalidSessionFixtures()) {
    for(const data of [
      {workspacesV2:[{id:'w',entries:[],session}]},
      {tabGroups:[{tabs:[{url:'https://good.example/'}],session}]},
      {sessionsV2:[session]}, {snapshotsV2:[session]},
    ]) assert.equal(validatePortableBackup({version:2,data}).ok,false,`${name}: ${Object.keys(data)[0]}`);
  }
});
test('session validation accepts safe unsupported pages and omitted optional metadata without rewriting captured state', () => {
  const {validSessionFixture}=require('../helpers/session-import-fixtures.js');
  const session=validSessionFixture();
  const result=validatePortableBackup({version:2,data:{workspacesV2:[{entries:[],session}]}});
  assert.equal(result.ok,true);assert.deepEqual(result.data.workspacesV2[0].session,session);
  for(const url of ['chrome://settings/','chrome-extension://example/index.html','edge://settings/','brave://settings/','about:blank','file:///tmp/example.txt']) {
    assert.equal(validatePortableBackup({version:2,data:{snapshotsV2:[{windows:[{tabs:[{url,restorable:false}]}]}]}}).ok,true,url);
  }
  assert.equal(validatePortableBackup({version:2,data:{workspacesV2:[{entries:[],session:{windows:[{tabs:[{url:'https://minimal.example/'}]}]}}]}}).ok,true);
});
