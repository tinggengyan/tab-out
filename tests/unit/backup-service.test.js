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
