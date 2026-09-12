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
    return {
      async close(tabIds, metadata = {}) {
        if (!Array.isArray(tabIds) || tabIds.length === 0) {
          throw new TypeError('At least one tab id is required');
        }
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

      async undo(operationId) {
        const operation = await repository.get(operationId);
        if (!operation || operation.kind !== 'close' || !['complete', 'partially_failed'].includes(operation.status) || !operation.result?.succeeded) {
          throw new Error('Operation cannot be undone');
        }
        const result = await restoreSession(operation.before, { mode: 'merge' });
        operation.status = 'undone';
        operation.undoneAt = now ? now() : new Date().toISOString();
        operation.undoResult = result;
        await repository.put(operation);
        return operation;
      },
    };
  }

  const api = { createOperationService, filterCapturedSession };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
