'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../../extension/app.js'), 'utf8');
const start = app.indexOf('async function undoTrackedOperation(');
const end = app.indexOf('\nfunction trashItemTitle(', start);

async function runUndo(status, failures) {
  let groups = [{ id: 'collected' }];
  let deferred = [{ id: 'later' }];
  let toast;
  const context = vm.createContext({
    Date,
    lastUndoOperationId: 'closing',
    operationService: { undo: async () => ({ id: 'closing', status, kind: 'close', createdAt: new Date().toISOString(), metadata: { collectedGroupId: 'collected', deferredId: 'later' }, undoResult: { failed: failures, succeeded: 1 } }) },
    telemetry: { record: async () => {} },
    getTabGroups: async () => groups,
    saveTabGroups: async value => { groups = value; },
    chrome: { storage: { local: { get: async () => ({ deferred }), set: async update => { deferred = update.deferred; } } } },
    latestUndoableOperation: async () => ({ id: 'older' }),
    showToast: (message, options) => { toast = options; }, t: key => key,
    renderDashboard: async () => {}, renderHistory: async () => {},
    document: { getElementById: () => ({ style: { display: 'none' } }) },
  });
  vm.runInContext(app.slice(start, end), context);
  await context.undoTrackedOperation('closing');
  return { groups, deferred, toast, nextUndo: context.lastUndoOperationId };
}

test('partial Undo keeps saved source records and leaves the same operation available to retry', async () => {
  const result = await runUndo('partially_failed', [{ tabId: 'failed-page', code: 'create_failed' }]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.deferred.length, 1);
  assert.equal(result.nextUndo, 'closing');
  assert.equal(result.toast.undoOperationId, 'closing');
});

test('complete Undo retains saved project sources, cleans a temporary deferred action and offers previous operation', async () => {
  const result = await runUndo('undone', []);
  assert.equal(result.groups.length, 1);
  assert.equal(result.deferred.length, 0);
  assert.equal(result.nextUndo, 'older');
  assert.equal(result.toast.undoOperationId, 'older');
});
