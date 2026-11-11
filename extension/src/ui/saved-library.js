(function initSavedLibrary(globalScope) {
  'use strict';
  const core = typeof require === 'function' ? { ...require('../shared/sanitize.js'), ...require('../domain/session.js'), ...require('../services/restore-planner.js') } : globalScope.TabOutCore;
  function savedDefaultName(pages, fallback = 'Saved pages') {
    const first = (pages || []).find(page => String(page.title || '').trim() || core.normalizeWebUrl(page.url));
    if (!first) return fallback;
    let title = String(first.title || '').trim();
    if (!title || title === first.url) { try { title = new URL(first.url).hostname; } catch { title = fallback; } }
    return `${title.slice(0, 90)}${pages.length > 1 ? ` +${pages.length - 1}` : ''}`;
  }
  function legacySavedItems(groups = [], deferred = []) {
    return [
      ...groups.map(group => ({ id: group.id, kind: 'collected', name: group.name || savedDefaultName(group.tabs), entries: group.tabs || [], savedAt: group.savedAt, source: group })),
      ...deferred.filter(item => !item.dismissed).map(item => ({ id: item.id, kind: 'deferred', name: item.title || savedDefaultName([item]), entries: [item], archived: Boolean(item.completed), savedAt: item.savedAt, source: item })),
    ];
  }
  function createSavedContinuation({ chromeApi, sessionAdapter }) {
    const retries = new Map();
    const active = new Set();
    const missingGroup = error => /(?:no|invalid|unknown) (?:tab )?group(?: with)?(?: id)?|group.*(?:not found|does not exist|no longer exists)/i.test(String(error?.message || error || ''));
    async function validGroupId(id, targetWindowId) {
      if (!Number.isInteger(id)) return undefined;
      if (!chromeApi.tabGroups?.get) return id;
      try {
        const group = await chromeApi.tabGroups.get(id);
        if (!group || (Number.isInteger(targetWindowId) && Number.isInteger(group.windowId) && group.windowId !== targetWindowId)) return undefined;
        return id;
      } catch (error) {
        // An ordinary lookup failure is not evidence that an existing group vanished.
        return missingGroup(error) ? undefined : id;
      }
    }
    return async function continueSaved(group, options = {}) {
      if (active.has(group.id)) throw Object.assign(new Error('operation_busy'), { code: 'operation_busy' });
      active.add(group.id);
      try {
        const prior = retries.get(group.id) || {};
        const previous = { ...prior, groupMappings: { ...prior.groupMappings }, groupFailures: (prior.groupFailures || []).map(failure => ({ ...failure })) };
        const session = group.session?.windows ? structuredClone(group.session) : core.buildSession({ id: `saved:${group.id}`, type: 'collection', source: 'saved-continue', windows: [{ tabs: (group.tabs || []).map((tab, index) => ({ ...tab, id: `saved:${index}`, index, active: index === 0 })) }] });
        const open = (await chromeApi.tabs.query({})).filter(tab => !tab.incognito).map(tab => ({ ...tab, url: tab.pendingUrl || tab.url }));
        const liveBefore = new Set(open.map(tab => tab.id));
        previous.metadataFailures = (prior.metadataFailures || []).filter(failure => liveBefore.has(failure.targetTabId));
        const groupSources = new Map(session.windows.flatMap((window, index) => (window.groups || []).map(sourceGroup => [sourceGroup.ref, { window, key: window.sourceWindowId ?? `window:${index}`, group: sourceGroup }])));
        const invalidatedRefs = new Set();
        for (const [ref, id] of Object.entries(previous.groupMappings)) {
          const valid = await validGroupId(id, previous.windowMappings?.[groupSources.get(ref)?.key]);
          if (valid === undefined) { delete previous.groupMappings[ref]; invalidatedRefs.add(ref); }
        }
        for (const failure of previous.groupFailures) {
          const expectedWindow = previous.windowMappings?.[groupSources.get(failure.groupRef)?.key] ?? failure.targetWindowId;
          if (failure.existingGroupId !== undefined && await validGroupId(failure.existingGroupId, expectedWindow) === undefined) {
            delete failure.existingGroupId; invalidatedRefs.add(failure.groupRef);
          }
        }
        const planned = core.planRestore(session, open, { skipDuplicates: true });
        const seen = new Set();
        planned.windows = planned.windows.map(window => {
          const tabs = window.tabs.filter(tab => { const url = core.normalizeWebUrl(tab.url); if (!url || seen.has(url)) return false; seen.add(url); return true; });
          const refs = new Set(tabs.map(tab => tab.id));
          return { ...window, tabs, groups: (window.groups || []).map(group => ({ ...group, tabIds: (group.tabIds || []).filter(id => refs.has(id)) })).filter(group => group.tabIds.length) };
        }).filter(window => window.tabs.length);
        // Restore missing pages first. The adapter cannot merge old group failures with
        // a new group mapping created for those pages in the same call.
        const restored = await sessionAdapter.restoreSession(planned, { mode: options.mode === 'merge-current' ? 'merge' : 'new-window', targetWindowId: options.targetWindowId, windowMappings: previous.windowMappings, groupMappings: previous.groupMappings, metadataFailures: previous.metadataFailures || [] });
        const failures = [...(restored.failed || [])];
        const groupMappings = { ...previous.groupMappings, ...restored.groupMappings };
        const liveTabs = new Map((await chromeApi.tabs.query({})).filter(tab => !tab.incognito).map(tab => [tab.id, tab]));
        const ownedTabs = [...(previous.restoredTabs || []), ...(restored.restoredTabs || [])].filter(tab => liveTabs.has(tab.tabId));
        const retryRefs = new Set([
          ...previous.groupFailures.map(failure => failure.groupRef), ...invalidatedRefs,
          ...failures.filter(failure => failure.code === 'group_restore_failed' && missingGroup(failure.message)).map(failure => failure.groupRef),
        ]);
        if (retryRefs.size) {
          for (const groupRef of retryRefs) {
            const older = previous.groupFailures.filter(failure => failure.groupRef === groupRef);
            const current = failures.filter(failure => failure.code === 'group_restore_failed' && failure.groupRef === groupRef);
            const source = groupSources.get(groupRef);
            const sourceWindow = source?.window;
            const sourceGroup = source?.group;
            const memberRefs = new Set(sourceGroup?.tabIds || []);
            const memberUrls = new Set((sourceWindow?.tabs || []).filter(tab => memberRefs.has(tab.id)).map(tab => core.normalizeWebUrl(tab.url)));
            // These IDs are owned by this continuation. Pages that were already open
            // before it began are intentionally never added to the native group.
            const ownedIds = new Set([
              ...older.flatMap(failure => failure.targetTabIds || []),
              ...current.flatMap(failure => failure.targetTabIds || []),
              ...ownedTabs.filter(tab => memberRefs.has(tab.tabRef)).map(tab => tab.tabId),
            ]);
            const targetWindowId = restored.windowMappings?.[source?.key] ?? current[0]?.targetWindowId ?? older[0]?.targetWindowId;
            const tabIds = [...ownedIds].filter(id => {
              const tab = liveTabs.get(id);
              return tab && memberUrls.has(core.normalizeWebUrl(tab.pendingUrl || tab.url)) && (targetWindowId === undefined || tab.windowId === targetWindowId);
            });
            // Replace this source group's current failure with one consolidated result.
            for (let index = failures.length - 1; index >= 0; index--) {
              if (failures[index].code === 'group_restore_failed' && failures[index].groupRef === groupRef) failures.splice(index, 1);
            }
            if (!tabIds.length) continue;
            const properties = sourceGroup ? { title: sourceGroup.title || '', color: sourceGroup.color || 'grey', collapsed: Boolean(sourceGroup.collapsed) } : older[0]?.group || current[0]?.group;
            let existingGroupId = await validGroupId(groupMappings[groupRef] ?? current[0]?.existingGroupId ?? older[0]?.existingGroupId, targetWindowId);
            if (existingGroupId === undefined) delete groupMappings[groupRef];
            try {
              if (!chromeApi.tabs.group || !chromeApi.tabGroups?.update) throw new Error('Native tab groups are unavailable');
              // A group can vanish between get/group/update. Retry creation once only
              // for that explicit stale-ID error; ordinary failures remain partial.
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  existingGroupId = await chromeApi.tabs.group({ tabIds, ...(Number.isInteger(existingGroupId) ? { groupId: existingGroupId } : Number.isInteger(targetWindowId) ? { createProperties: { windowId: targetWindowId } } : {}) });
                  groupMappings[groupRef] = existingGroupId;
                  await chromeApi.tabGroups.update(existingGroupId, properties);
                  break;
                } catch (error) {
                  if (attempt === 0 && Number.isInteger(existingGroupId) && missingGroup(error)) {
                    delete groupMappings[groupRef]; existingGroupId = undefined;
                  } else throw error;
                }
              }
            } catch (error) {
              failures.push({ groupRef, code: 'group_restore_failed', targetTabIds: tabIds, targetWindowId, existingGroupId, group: properties, message: error?.message || String(error) });
            }
          }
        }
        if (failures.length) retries.set(group.id, { windowMappings: restored.windowMappings, groupMappings, restoredTabs: ownedTabs, groupFailures: failures.filter(item => item.code === 'group_restore_failed'), metadataFailures: failures.filter(item => item.code === 'tab_metadata_restore_failed') });
        else retries.delete(group.id);
        return { opened: restored.succeeded || 0, reused: planned.summary.duplicates, failed: failures.length, failures, status: failures.length ? 'partial' : 'complete' };
      } finally { active.delete(group.id); }
    };
  }
  const api = { savedDefaultName, legacySavedItems, createSavedContinuation };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
