(function initOperationService(globalScope) {
  'use strict';

  function filterCapturedSession(session, tabIds) {
    const refs = new Set(tabIds.flatMap(tabId => [String(tabId), `tab:${tabId}`]));
    const windows = (session.windows || []).map(window => {
      const tabs = (window.tabs || []).filter(tab => refs.has(String(tab.id)));
      const tabRefs = new Set(tabs.map(tab => String(tab.id)));
      const groups = (window.groups || []).map(group => ({ ...group, tabIds: group.tabIds.filter(ref => tabRefs.has(ref)) })).filter(group => group.tabIds.length);
      return { ...window, tabs, groups };
    }).filter(window => window.tabs.length);
    return {
      ...session,
      windows,
      stats: {
        windowCount: windows.length,
        tabCount: windows.reduce((sum, window) => sum + window.tabs.length, 0),
        groupCount: windows.reduce((sum, window) => sum + window.groups.length, 0),
      },
    };
  }

  function createOperationService({ captureTabs, removeTabs, restoreSession, repository, getExistingTabIds, now, id }) {
    if (!captureTabs || !removeTabs || !restoreSession || !repository) {
      throw new TypeError('Operation service dependencies are required');
    }
    const undoInFlight = new Map();
    return {
      async close(tabIds, metadata = {}, { beforeRemove } = {}) {
        if (!Array.isArray(tabIds) || tabIds.length === 0) {
          throw new TypeError('At least one tab id is required');
        }
        if (beforeRemove !== undefined && typeof beforeRemove !== 'function') throw new TypeError('beforeRemove must be a function');
        const operationId = id ? id() : globalScope.crypto.randomUUID();
        const createdAt = now ? now() : new Date().toISOString();
        const before = await captureTabs([...new Set(tabIds)]);
        const operation = {
          id: operationId,
          kind: 'close',
          createdAt,
          status: 'pending',
          before,
          targetRefs: [...new Set(tabIds)].map(tabId => String(tabId)),
          metadata,
        };
        await repository.put(operation);
        // Keep executable guards out of persisted metadata. Capture and writing
        // the pending record may yield long enough for tabs/projects to change.
        // A rejected guard means we attempted no removal, including when a tab
        // disappeared independently; do not infer successful closes from it.
        if (beforeRemove) {
          try { await beforeRemove(); }
          catch (error) {
            operation.status = 'partially_failed';
            operation.result = {
              succeeded: 0,
              failed: operation.targetRefs.map(tabId => ({ tabId, code: error.code || 'close_precondition_failed' })),
            };
            await repository.put(operation);
            throw error;
          }
        }
        try {
          await removeTabs([...new Set(tabIds)]);
          operation.status = 'complete';
          operation.result = { succeeded: operation.targetRefs.length, failed: [] };
          await repository.put(operation);
          return operation;
        } catch (error) {
          let remainingIds = operation.targetRefs.map(Number).filter(Number.isInteger);
          if (getExistingTabIds) {
            try { remainingIds = await getExistingTabIds(remainingIds); } catch { /* retain conservative all-failed result */ }
          }
          const remaining = new Set(remainingIds.map(String));
          const succeededIds = operation.targetRefs.filter(ref => !remaining.has(ref)).map(Number);
          operation.status = 'partially_failed';
          if (succeededIds.length) operation.before = filterCapturedSession(operation.before, succeededIds);
          operation.result = {
            succeeded: succeededIds.length,
            failed: operation.targetRefs.filter(ref => remaining.has(ref)).map(tabId => ({ tabId, code: 'tabs_remove_failed' })),
          };
          await repository.put(operation);
          if (succeededIds.length) return operation;
          throw error;
        }
      },

      undo(operationId) {
        if (undoInFlight.has(operationId)) return undoInFlight.get(operationId);
        const pending = (async () => {
          const operation = await repository.get(operationId);
          if (!operation || operation.kind !== 'close' || !['complete', 'partially_failed'].includes(operation.status) || !operation.result?.succeeded) {
            throw new Error('Operation cannot be undone');
          }
          const result = await restoreSession(operation.before, {
            mode: 'original', groupFailures: operation.undoGroupFailures || [],
            metadataFailures: operation.undoMetadataFailures || [],
            windowMappings: operation.undoWindowMappings || {}, groupMappings: operation.undoGroupMappings || {},
          });
          operation.undoWindowMappings = { ...operation.undoWindowMappings, ...result.windowMappings };
          operation.undoGroupMappings = { ...operation.undoGroupMappings, ...result.groupMappings };
          operation.undoGroupFailures = (result.failed || []).filter(failure => failure.code === 'group_restore_failed');
          operation.undoMetadataFailures = (result.failed || []).filter(failure => failure.code === 'tab_metadata_restore_failed');
          const failures = result.failed || [];
          if (failures.length) {
            const failedRefs = new Set(failures.map(failure => String(failure.tabId)));
            const failedIds = operation.before.windows.flatMap(window => window.tabs)
              .filter(tab => failedRefs.has(String(tab.id))).map(tab => String(tab.id).replace(/^tab:/, ''));
            operation.before = filterCapturedSession(operation.before, failedIds);
            operation.status = 'partially_failed';
          } else {
            operation.status = 'undone';
            operation.undoneAt = now ? now() : new Date().toISOString();
          }
          operation.undoResult = result;
          await repository.put(operation);
          return operation;
        })();
        const tracked = pending.finally(() => { undoInFlight.delete(operationId); });
        undoInFlight.set(operationId, tracked);
        return tracked;
      },
    };
  }

  const api = { createOperationService, filterCapturedSession };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
