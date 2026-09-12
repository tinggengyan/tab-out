'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSession, sessionFingerprint } = require('../../extension/src/domain/session.js');

test('buildSession preserves windows, order, pinned state and native groups', () => {
  const session = buildSession({
    windows: [{
      id: 7,
      focused: true,
      state: 'maximized',
      tabs: [
        { id: 10, url: 'https://a.example', title: 'A', index: 0, active: true, pinned: true, groupId: 4 },
        { id: 11, url: 'chrome://settings', title: 'Settings', index: 1, active: false, pinned: false, groupId: -1 },
      ],
    }],
    groups: [{ id: 4, title: 'Project', color: 'blue', collapsed: true }],
    type: 'manual',
    source: 'manual-history',
    note: 'Before quarterly planning',
    deviceId: 'device-1',
    capturedAt: '2026-08-10T00:00:00.000Z',
  });

  assert.equal(session.windows.length, 1);
  assert.equal(session.windows[0].tabs[0].pinned, true);
  assert.equal(session.windows[0].tabs[0].groupRef, 'group:4');
  assert.equal(session.windows[0].groups[0].title, 'Project');
  assert.equal(session.windows[0].tabs[1].restorable, false);
  assert.deepEqual(session.stats, { windowCount: 1, tabCount: 2, groupCount: 1 });
  assert.equal(session.source, 'manual-history');
  assert.equal(session.note, 'Before quarterly planning');
});

test('buildSession bounds user notes and defaults source to the capture type', () => {
  const session = buildSession({ type: 'automatic', note: 'x'.repeat(600) });
  assert.equal(session.source, 'automatic');
  assert.equal(session.note.length, 500);
});

test('sessionFingerprint ignores capture time and transient browser ids', () => {
  const input = {
    windows: [{ id: 1, focused: true, tabs: [{ id: 8, url: 'https://a.example', title: 'A', index: 0, groupId: -1 }] }],
    groups: [],
    type: 'automatic',
    deviceId: 'device-1',
  };
  const first = buildSession({ ...input, capturedAt: '2026-08-10T00:00:00.000Z' });
  const second = buildSession({
    ...input,
    capturedAt: '2026-08-10T01:00:00.000Z',
    windows: [{ id: 99, focused: true, tabs: [{ id: 101, url: 'https://a.example', title: 'A', index: 0, groupId: -1 }] }],
  });
  assert.equal(sessionFingerprint(first), sessionFingerprint(second));
});
