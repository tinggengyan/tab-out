'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planRestore } = require('../../extension/src/services/restore-planner.js');

const session = {
  id: 's1',
  windows: [{ tabs: [
    { id: 'a', url: 'https://a.example/', restorable: true },
    { id: 'b', url: 'https://b.example/', restorable: true },
    { id: 'c', url: 'chrome://settings', restorable: false },
  ], groups: [] }],
};

test('planRestore reports restorable, duplicate and unsupported counts', () => {
  const plan = planRestore(session, [{ url: 'https://a.example/' }], { skipDuplicates: true });
  assert.deepEqual(plan.summary, {
    windows: 1,
    total: 3,
    toOpen: 1,
    duplicates: 1,
    unsupported: 1,
  });
  assert.deepEqual(plan.windows[0].tabs.map(tab => tab.id), ['b']);
});

test('planRestore preserves duplicates when requested', () => {
  const plan = planRestore(session, [{ url: 'https://a.example/' }], { skipDuplicates: false });
  assert.equal(plan.summary.toOpen, 2);
  assert.equal(plan.summary.duplicates, 0);
});

test('planRestore compares normalized URL fragments consistently', () => {
  const withFragment = { windows: [{ tabs: [{ id: 'x', url: 'https://a.example/page#one', restorable: true }], groups: [] }] };
  const plan = planRestore(withFragment, [{ url: 'https://a.example/page#two' }], {
    skipDuplicates: true,
    ignoreHash: true,
  });
  assert.equal(plan.summary.toOpen, 0);
  assert.equal(plan.summary.duplicates, 1);
});

test('planRestore removes empty groups and keeps only planned tab references', () => {
  const grouped = { windows: [{
    tabs: [
      { id: 'a', url: 'https://a.example/', restorable: true, groupRef: 'g1' },
      { id: 'b', url: 'https://b.example/', restorable: true, groupRef: 'g1' },
    ],
    groups: [{ ref: 'g1', title: 'Group', tabIds: ['a', 'b'] }],
  }] };
  const plan = planRestore(grouped, [{ url: 'https://a.example/' }], { skipDuplicates: true });
  assert.deepEqual(plan.windows[0].groups[0].tabIds, ['b']);
});
