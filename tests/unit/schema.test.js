'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_SCHEMA_VERSION,
  migrateLegacyState,
  validateImportPayload,
} = require('../../extension/src/storage/schema.js');

test('migrateLegacyState converts legacy tab groups without dropping tabs', () => {
  const legacy = {
    deferred: [{ id: 'd1', url: 'https://read.example', title: 'Read', completed: false }],
    shortcuts: [{ id: 's1', name: 'Example', url: 'https://example.com' }],
    tabGroups: [{
      id: 'g1',
      savedAt: '2026-08-01T00:00:00.000Z',
      tabs: [{ url: 'https://a.example', title: 'A' }],
    }],
  };

  const migrated = migrateLegacyState(legacy, { deviceId: 'device-1' });

  assert.equal(migrated.meta.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.deferred.length, 1);
  assert.equal(migrated.shortcuts.length, 1);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.sessions[0].type, 'collected');
  assert.equal(migrated.sessions[0].windows[0].tabs[0].url, 'https://a.example/');
  assert.equal(migrated.sessions[0].windows[0].tabs[0].restorable, true);
});

test('migrateLegacyState does not mutate its input', () => {
  const legacy = { deferred: [], shortcuts: [], tabGroups: [] };
  const before = JSON.stringify(legacy);
  migrateLegacyState(legacy, { deviceId: 'device-1' });
  assert.equal(JSON.stringify(legacy), before);
});

test('validateImportPayload rejects payloads without supported collections', () => {
  const result = validateImportPayload({ version: 1, unknown: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /supported data/i);
});

test('validateImportPayload filters invalid and dangerous entries with a report', () => {
  const result = validateImportPayload({
    version: 1,
    shortcuts: [
      { id: 'good', name: 'Good', url: 'https://example.com' },
      { id: 'bad', name: '<script>', url: 'javascript:alert(1)' },
    ],
    deferred: [{ id: 'd1', title: 'Read', url: 'https://read.example' }],
    tabGroups: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.shortcuts.length, 1);
  assert.equal(result.data.deferred.length, 1);
  assert.equal(result.report.skipped, 1);
});

test('validateImportPayload enforces collection limits', () => {
  const shortcuts = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    name: `Shortcut ${index}`,
    url: `https://example.com/${index}`,
  }));
  const result = validateImportPayload({ version: 1, shortcuts }, { maxItemsPerCollection: 3 });
  assert.equal(result.ok, false);
  assert.match(result.error, /too many/i);
});
