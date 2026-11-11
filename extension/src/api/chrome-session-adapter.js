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
      if (groups.length !== groupIds.length) {
        throw Object.assign(new Error('Native tab group metadata could not be captured'), { code: 'group_metadata_unavailable' });
      }
      const session = buildSession({
        windows: windows.map(window => ({ ...window, tabs: (window.tabs || []).map(tab => ({ ...tab, url: tab.pendingUrl || tab.url })) })),
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
      const result = { succeeded: 0, failed: [], restoredTabs: [], createdWindows: [], windowMappings: { ...restoreOptions.windowMappings }, groupMappings: { ...restoreOptions.groupMappings } };
      const mode = restoreOptions.mode || 'merge';
      for (const [windowIndex, sourceWindow] of (session.windows || []).entries()) {
        const sourceWindowKey = sourceWindow.sourceWindowId ?? `window:${windowIndex}`;
        let targetWindowId = restoreOptions.targetWindowId;
        const restoredByRef = new Map();
        const orderedTabs = [...(sourceWindow.tabs || [])].sort((a, b) => a.index - b.index);
        const restorable = orderedTabs.filter(tab => tab.restorable);
        for (const tab of orderedTabs.filter(tab => !tab.restorable)) {
          result.failed.push({ tabId: tab.id, url: tab.url, code: 'unsupported_url' });
        }
        if (!restorable.length) continue;
        let mappedWindow = false;
        if (Number.isInteger(result.windowMappings[sourceWindowKey])) {
          try {
            const id = result.windowMappings[sourceWindowKey];
            const existing = chromeApi.windows.get ? await chromeApi.windows.get(id) : (await chromeApi.windows.getAll({})).find(window => window.id === id);
            if (existing && !existing.incognito) { targetWindowId = existing.id; mappedWindow = true; }
          } catch { /* a retry target window was closed */ }
        }
        if (mode === 'original' && !mappedWindow) {
          try {
            const existing = chromeApi.windows.get
              ? await chromeApi.windows.get(sourceWindow.sourceWindowId)
              : (await chromeApi.windows.getAll({})).find(window => window.id === sourceWindow.sourceWindowId);
            targetWindowId = existing && !existing.incognito ? existing.id : undefined;
          } catch { targetWindowId = undefined; }
        }
        const needsWindow = !mappedWindow && (mode === 'new-window' || (mode === 'original' && targetWindowId === undefined));
        if (needsWindow) {
          try {
            const createdWindow = await chromeApi.windows.create({ focused: false, url: restorable[0].url });
            if (!Number.isInteger(createdWindow?.id)) throw new Error('Window was not created');
            targetWindowId = createdWindow.id;
            result.createdWindows.push(targetWindowId);
            const createdTab = createdWindow.tabs?.[0];
            if (createdTab) {
              restoredByRef.set(restorable[0].id, createdTab.id);
              result.restoredTabs.push({ tabRef: restorable[0].id, tabId: createdTab.id, windowId: targetWindowId });
              result.succeeded++;
            }
          } catch (error) {
            for (const tab of restorable) result.failed.push({ tabId: tab.id, url: tab.url, code: 'window_create_failed', message: error?.message || String(error) });
            continue;
          }
        }
        if (Number.isInteger(targetWindowId)) result.windowMappings[sourceWindowKey] = targetWindowId;
        for (const tab of restorable) {
          let createdId = restoredByRef.get(tab.id);
          if (createdId === undefined) {
            try {
              const props = { url: tab.url, active: false, ...(targetWindowId !== undefined ? { windowId: targetWindowId } : {}) };
              if (mode === 'original' && !needsWindow && Number.isInteger(tab.index)) {
                const existing = chromeApi.tabs.query ? await chromeApi.tabs.query({ windowId: targetWindowId }) : null;
                props.index = Math.max(0, existing ? Math.min(tab.index, existing.length) : tab.index);
              }
              const created = await chromeApi.tabs.create(props);
              createdId = created.id;
              restoredByRef.set(tab.id, createdId);
              result.restoredTabs.push({ tabRef: tab.id, tabId: createdId, windowId: created.windowId ?? targetWindowId });
              result.succeeded++;
            } catch (error) {
              result.failed.push({ tabId: tab.id, url: tab.url, code: 'create_failed', message: error?.message || String(error) });
              continue;
            }
          }
          try { await chromeApi.tabs.update(createdId, { pinned: Boolean(tab.pinned) }); }
          catch (error) { result.failed.push({ code: 'tab_metadata_restore_failed', targetTabId: createdId, properties: { pinned: Boolean(tab.pinned) }, message: error?.message || String(error) }); }
        }
        for (const group of sourceWindow.groups || []) {
          const tabIds = (group.tabIds || []).map(ref => restoredByRef.get(ref)).filter(Number.isInteger);
          if (!tabIds.length) continue;
          const properties = { title: group.title || '', color: group.color || 'grey', collapsed: Boolean(group.collapsed) };
          let existingGroupId = result.groupMappings[group.ref];
          if (existingGroupId === undefined && mode === 'original' && !needsWindow && chromeApi.tabGroups?.get) {
            try {
              const sourceId = Number(String(group.ref).replace(/^group:/, ''));
              const existing = await chromeApi.tabGroups.get(sourceId);
              if (existing.windowId === targetWindowId) existingGroupId = sourceId;
            } catch { /* recreate an original group that no longer exists */ }
          }
          try {
            if (!chromeApi.tabs.group || !chromeApi.tabGroups?.update) throw new Error('Native tab groups are unavailable');
            const groupId = await chromeApi.tabs.group({ tabIds, ...(existingGroupId !== undefined ? { groupId: existingGroupId } : targetWindowId !== undefined ? { createProperties: { windowId: targetWindowId } } : {}) });
            existingGroupId = groupId;
            result.groupMappings[group.ref] = groupId;
            await chromeApi.tabGroups.update(groupId, properties);
          } catch (error) {
            result.failed.push({ groupRef: group.ref, code: 'group_restore_failed', targetTabIds: tabIds, targetWindowId, existingGroupId, group: properties, message: error?.message || String(error) });
          }
        }
        const active = restorable.find(tab => tab.active && restoredByRef.has(tab.id));
        if (active) {
          const targetTabId = restoredByRef.get(active.id);
          try { await chromeApi.tabs.update(targetTabId, { active: true }); }
          catch (error) { result.failed.push({ code: 'tab_metadata_restore_failed', targetTabId, properties: { active: true }, message: error?.message || String(error) }); }
        }
      }
      if (restoreOptions.groupFailures?.length) {
        const retried = await retryGroupFailures(restoreOptions.groupFailures);
        result.failed.push(...retried.failed);
      }
      for (const failure of restoreOptions.metadataFailures || []) {
        try { await chromeApi.tabs.update(failure.targetTabId, failure.properties); }
        catch (error) { result.failed.push({ ...failure, message: error?.message || String(error) }); }
      }
      return result;
    }

    async function retryGroupFailures(failures = []) {
      const result = { succeeded: 0, failed: [] };
      for (const failure of failures) {
        const tabIds = (failure.targetTabIds || []).filter(Number.isInteger);
        if (!tabIds.length || !chromeApi.tabs.group) { result.failed.push(failure); continue; }
        try {
          if (!chromeApi.tabGroups?.update) throw new Error('Native tab groups are unavailable');
          const groupId = await chromeApi.tabs.group({ tabIds, ...(Number.isInteger(failure.existingGroupId) ? { groupId: failure.existingGroupId } : Number.isInteger(failure.targetWindowId) ? { createProperties: { windowId: failure.targetWindowId } } : {}) });
          await chromeApi.tabGroups.update(groupId, failure.group || {});
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
