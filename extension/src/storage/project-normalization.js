(function initProjectNormalization(globalScope) {
  'use strict';
  const core = typeof require === 'function'
    ? { ...require('../shared/sanitize.js'), ...require('../domain/session.js') }
    : globalScope.TabOutCore;
  const queues = new WeakMap();

  // Web Locks coordinate dashboards and the extension service worker. The queue
  // fallback is also shared by repository instances in non-browser unit tests.
  function withProjectStorageLock(storage, action) {
    if (globalScope.navigator?.locks?.request) return globalScope.navigator.locks.request('tab-out-project-storage-v1', action);
    const previous = queues.get(storage) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(storage, next.catch(() => {}));
    return next;
  }
  async function readProjectStorage(storage, keys) {
    return Object.assign({}, ...await Promise.all(keys.map(key => storage.get(key))));
  }
  function fingerprint(value) {
    let hash = 2166136261;
    const serialized = JSON.stringify(value);
    for (let offset = 0; offset < serialized.length; offset++) hash = Math.imul(hash ^ serialized.charCodeAt(offset), 16777619);
    return (hash >>> 0).toString(16);
  }
  function projectDefaultName(pages, fallback = 'Saved pages') {
    const first = (pages || []).find(page => String(page.title || '').trim() || core.normalizeWebUrl(page.url));
    if (!first) return fallback;
    let title = String(first.title || '').trim();
    if (!title || title === first.url) { try { title = new URL(first.url).hostname; } catch { title = fallback; } }
    return `${title.slice(0, 90)}${pages.length > 1 ? ` +${pages.length - 1}` : ''}`;
  }
  function normalizeProjectState(input, options = {}) {
    const state = structuredClone(input || {});
    const groups = Array.isArray(state.tabGroups) ? state.tabGroups : [];
    if (!groups.length) return { data: state, changed: false };
    const projects = Array.isArray(state.workspacesV2) ? state.workspacesV2 : [];
    const ids = new Set(projects.map(project => project.id));
    for (const [groupIndex, group] of groups.entries()) {
      if (!group || !Array.isArray(group.tabs)) throw new Error('Invalid saved project');
      if (group.tabs.some(tab => !tab || typeof tab !== 'object' || Array.isArray(tab))) throw new Error('Invalid saved project page');
      if (group.session !== undefined && !core.isValidSessionShape(group.session)) throw new Error('Invalid saved project session');
      const sourceId = String(group.id || `anonymous:${fingerprint(group)}:${groupIndex}`);
      // A legacy import must not overwrite a project the user has since edited.
      if (projects.some(project => project.legacyGroupId === sourceId)) continue;
      const baseId = `legacy-group:${encodeURIComponent(sourceId)}`;
      let id = baseId;
      for (let suffix = 2; ids.has(id); suffix++) id = `${baseId}:${suffix}`;
      ids.add(id);
      const timestamp = group.savedAt || options.now || new Date().toISOString();
      const session = group.session?.windows ? structuredClone(group.session) : core.buildSession({
        id: `project:${id}`, type: 'project', source: 'legacy-collection', capturedAt: timestamp,
        windows: [{ tabs: group.tabs.map((tab, index) => ({ ...tab, id: `${id}:tab:${index}`, index, active: index === 0 })) }],
      });
      if (!core.isValidSessionShape(session)) throw new Error('Invalid saved project session');
      const entryPages = group.tabs.some(tab => core.normalizeWebUrl(tab.url)) ? group.tabs : session.windows.flatMap(window => window.tabs || []);
      projects.push({
        id, legacyGroupId: sourceId, name: String(group.name || projectDefaultName(group.tabs)).slice(0, 256),
        description: '', color: '#c8713a', icon: '', pinned: false, order: projects.length,
        createdAt: timestamp, updatedAt: timestamp, sessionSavedAt: timestamp, session,
        entries: entryPages.map((tab, index) => ({ ...tab, id: `${id}:entry:${index}`, url: core.normalizeWebUrl(tab.url),
          title: String(tab.title || tab.url || '').slice(0, 1024), pinned: Boolean(tab.pinned), order: index, addedAt: timestamp })).filter(tab => tab.url),
      });
    }
    state.workspacesV2 = projects;
    state.tabGroups = [];
    const previous = state.projectMigrationBackupV1;
    const backupGroups = Array.isArray(previous?.tabGroups) ? previous.tabGroups : [];
    const seen = new Set(backupGroups.map(group => JSON.stringify(group)));
    state.projectMigrationBackupV1 = {
      ...previous, migratedAt: previous?.migratedAt || options.now || new Date().toISOString(),
      workspacesV2: previous?.workspacesV2 || structuredClone(input.workspacesV2 || []),
      tabGroups: [...backupGroups, ...groups.filter(group => !seen.has(JSON.stringify(group)))],
    };
    return { data: state, changed: true };
  }
  const api = { withProjectStorageLock, readProjectStorage, normalizeProjectState, projectDefaultName };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
