(function initChromeSessionAdapter(globalScope) {
  'use strict';
  const buildSession = typeof require === 'function'
    ? require('../domain/session.js').buildSession
    : globalScope.TabOutCore.buildSession;

  function createChromeSessionAdapter(chromeApi, options = {}) {
    if (!chromeApi?.windows || !chromeApi?.tabs) throw new TypeError('Chrome windows and tabs APIs are required');

    async function readGroups(groupIds) {
      if (!chromeApi.tabGroups?.get) return [];
      const groups = [];
      for (const groupId of groupIds) {
        try { groups.push(await chromeApi.tabGroups.get(groupId)); } catch { /* group disappeared */ }
      }
      return groups;
    }

    async function buildFromWindows(windows, type, metadata = {}) {
      const groupIds = [...new Set(windows.flatMap(window => window.tabs)
        .map(tab => tab.groupId)
        .filter(groupId => Number.isInteger(groupId) && groupId >= 0))];
      const groups = await readGroups(groupIds);
      const session = buildSession({
        windows,
        groups,
        type: type || options.type || 'undo',
        source: metadata.source,
        note: metadata.note,
        deviceId: options.deviceId || 'local',
        capturedAt: options.now ? options.now() : new Date().toISOString(),
        id: options.id ? options.id() : undefined,
      });
      for (const window of session.windows) {
        for (const tab of window.tabs) {
          if (tab.restorable) tab.url = new URL(tab.url).href;
        }
      }
      return session;
    }

    async function captureTabs(tabIds) {
      const wanted = new Set(tabIds);
      const allWindows = await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windows = allWindows.filter(window => !window.incognito).map(window => ({
        ...window,
        tabs: (window.tabs || []).filter(tab => wanted.has(tab.id)),
      })).filter(window => window.tabs.length > 0);
      return buildFromWindows(windows, options.type || 'undo');
    }

    async function captureAll(type = 'automatic', metadata = {}) {
      const windows = (await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] }))
        .filter(window => !window.incognito && (window.tabs || []).length > 0);
      return buildFromWindows(windows, type, metadata);
    }

    async function restoreSession(session, restoreOptions = {}) {
      const result = { succeeded: 0, failed: [] };
      for (const sourceWindow of session.windows || []) {
        let targetWindowId;
        const restoredByRef = new Map();
        const orderedTabs = [...(sourceWindow.tabs || [])].sort((a, b) => a.index - b.index);
        if (restoreOptions.mode === 'new-window') {
          const firstRestorable = orderedTabs.find(tab => tab.restorable);
          try {
            const createdWindow = await chromeApi.windows.create({
              focused: false,
              ...(firstRestorable ? { url: firstRestorable.url } : {}),
            });
            targetWindowId = createdWindow.id;
            const createdTab = createdWindow.tabs?.[0];
            if (firstRestorable && createdTab) {
              restoredByRef.set(firstRestorable.id, createdTab.id);
              await chromeApi.tabs.update(createdTab.id, { pinned: Boolean(firstRestorable.pinned) });
              result.succeeded += 1;
            }
          } catch { targetWindowId = undefined; }
        }
        for (const tab of orderedTabs) {
          if (!tab.restorable) {
            result.failed.push({ tabId: tab.id, url: tab.url, code: 'unsupported_url' });
            continue;
          }
          if (restoredByRef.has(tab.id)) continue;
          try {
            const created = await chromeApi.tabs.create({
              url: tab.url,
              active: false,
              ...(targetWindowId !== undefined ? { windowId: targetWindowId } : {}),
            });
            restoredByRef.set(tab.id, created.id);
            await chromeApi.tabs.update(created.id, { pinned: Boolean(tab.pinned) });
            result.succeeded += 1;
          } catch (error) {
            result.failed.push({ tabId: tab.id, url: tab.url, code: 'create_failed', message: error?.message || String(error) });
          }
        }
        for (const group of sourceWindow.groups || []) {
          const tabIds = group.tabIds.map(ref => restoredByRef.get(ref)).filter(Number.isInteger);
          if (tabIds.length === 0 || !chromeApi.tabs.group) continue;
          try {
            const groupId = await chromeApi.tabs.group({ tabIds, ...(targetWindowId !== undefined ? { createProperties: { windowId: targetWindowId } } : {}) });
            if (chromeApi.tabGroups?.update) {
              await chromeApi.tabGroups.update(groupId, {
                title: group.title || '',
                color: group.color || 'grey',
                collapsed: Boolean(group.collapsed),
              });
            }
          } catch (error) {
            result.failed.push({
              groupRef: group.ref,
              code: 'group_restore_failed',
              targetTabIds: tabIds,
              group: { title: group.title || '', color: group.color || 'grey', collapsed: Boolean(group.collapsed) },
              message: error?.message || String(error),
            });
          }
        }
        const active = orderedTabs.find(tab => tab.active && restoredByRef.has(tab.id));
        if (active) await chromeApi.tabs.update(restoredByRef.get(active.id), { active: true });
      }
      return result;
    }

    async function retryGroupFailures(failures = []) {
      const result = { succeeded: 0, failed: [] };
      for (const failure of failures) {
        const tabIds = (failure.targetTabIds || []).filter(Number.isInteger);
        if (!tabIds.length || !chromeApi.tabs.group) { result.failed.push(failure); continue; }
        try {
          const groupId = await chromeApi.tabs.group({ tabIds });
          if (chromeApi.tabGroups?.update) await chromeApi.tabGroups.update(groupId, failure.group || {});
          result.succeeded += 1;
        } catch (error) {
          result.failed.push({ ...failure, message: error?.message || String(error) });
        }
      }
      return result;
    }

    return { captureTabs, captureAll, restoreSession, retryGroupFailures };
  }
  const api = { createChromeSessionAdapter };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
