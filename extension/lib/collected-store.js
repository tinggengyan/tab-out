/* ================================================================
   Tab Out — stash records ("已收纳")

   A stash record is a group of pages that were saved and closed in one
   click. Restoring it reopens the pages and removes the record (OneTab
   style). Records live under their own key, collectedGroupsV3, so the
   archived v2.3 build (which empties `tabGroups`) can never touch them.

   migrateLegacy() runs once on startup and copies the owner's v2.3
   projects (workspacesV2) and any leftover `tabGroups` into stash
   records. It never writes or deletes those old keys.
   ================================================================ */
(function initCollectedStore(globalScope) {
  'use strict';

  const KEY = 'collectedGroupsV3';
  const MIGRATION_FLAG = 'soulMigrationV1';

  const defaultNow = () => new Date().toISOString();
  const defaultId = () => globalScope.crypto.randomUUID();

  function toPages(list) {
    return (Array.isArray(list) ? list : [])
      .filter(item => item && typeof item.url === 'string' && item.url)
      .map(item => ({ url: item.url, title: typeof item.title === 'string' && item.title ? item.title : item.url }));
  }

  function withName(record, name) {
    if (typeof name === 'string' && name.trim()) record.name = name.trim();
    return record;
  }

  function recordFromWorkspace(workspace, { now = defaultNow, id = defaultId } = {}) {
    const tabs = toPages(workspace?.entries);
    if (!workspace || tabs.length === 0) return null;
    return withName({
      id: id(),
      savedAt: workspace.sessionSavedAt || workspace.updatedAt || workspace.createdAt || now(),
      sourceId: 'workspace:' + workspace.id,
      tabs,
    }, workspace.name);
  }

  function recordFromTabGroup(group, { now = defaultNow, id = defaultId } = {}) {
    const tabs = toPages(group?.tabs);
    if (!group || tabs.length === 0) return null;
    return withName({
      id: id(),
      savedAt: group.savedAt || now(),
      sourceId: 'tabGroup:' + group.id,
      tabs,
    }, group.name);
  }

  // Appends records not already present (same id or same sourceId); returns how many were added.
  function mergeBySource(existing, incoming) {
    const ids = new Set(existing.map(record => record.id));
    const sources = new Set(existing.map(record => record.sourceId).filter(Boolean));
    const added = [];
    for (const record of incoming) {
      if (!record || ids.has(record.id) || (record.sourceId && sources.has(record.sourceId))) continue;
      ids.add(record.id);
      if (record.sourceId) sources.add(record.sourceId);
      added.push(record);
    }
    return { records: [...existing, ...added], added: added.length };
  }

  function byNewest(a, b) {
    return String(b.savedAt).localeCompare(String(a.savedAt));
  }

  function createCollectedStore(storageArea, { now = defaultNow, id = defaultId } = {}) {
    async function read() {
      const { [KEY]: records } = await storageArea.get(KEY);
      return Array.isArray(records) ? records : [];
    }
    async function write(records) {
      await storageArea.set({ [KEY]: records });
    }

    return {
      async list() {
        return (await read()).slice().sort(byNewest);
      },
      async add({ name, tabs }) {
        const record = withName({ id: id(), savedAt: now(), tabs: toPages(tabs) }, name);
        await write([record, ...(await read())]);
        return record;
      },
      async remove(recordId) {
        const records = await read();
        const record = records.find(item => item.id === recordId) || null;
        if (record) await write(records.filter(item => item !== record));
        return record;
      },
      async takeAll(recordId) {
        return this.remove(recordId);
      },
      async takeTab(recordId, index) {
        const records = await read();
        const record = records.find(item => item.id === recordId);
        if (!record || !record.tabs[index]) return null;
        const [page] = record.tabs.splice(index, 1);
        await write(record.tabs.length ? records : records.filter(item => item !== record));
        return page;
      },
      async merge(incoming) {
        const { records, added } = mergeBySource(await read(), incoming);
        if (added) await write(records);
        return added;
      },
    };
  }

  async function migrateLegacy(storageArea, { now = defaultNow, id = defaultId } = {}) {
    const state = await storageArea.get([MIGRATION_FLAG, KEY, 'workspacesV2', 'tabGroups']);
    if (state[MIGRATION_FLAG]) return { migrated: 0 };

    const incoming = [
      ...(Array.isArray(state.workspacesV2) ? state.workspacesV2 : []).map(ws => recordFromWorkspace(ws, { now, id })),
      ...(Array.isArray(state.tabGroups) ? state.tabGroups : []).map(group => recordFromTabGroup(group, { now, id })),
    ].filter(Boolean);
    const existing = Array.isArray(state[KEY]) ? state[KEY] : [];
    const { records, added } = mergeBySource(existing, incoming);

    await storageArea.set({ [KEY]: records, [MIGRATION_FLAG]: { migratedAt: now(), count: added } });
    return { migrated: added };
  }

  function collectableTabs(tabs) {
    return tabs.filter(tab => !tab.pinned);
  }

  function restoreTargets(record, openUrls) {
    return record.tabs.filter(page => !openUrls.has(page.url));
  }

  const api = {
    COLLECTED_KEY: KEY, createCollectedStore, migrateLegacy,
    recordFromWorkspace, recordFromTabGroup, collectableTabs, restoreTargets,
  };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
