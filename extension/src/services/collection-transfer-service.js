(function initCollectionTransferService(globalScope) {
  'use strict';

  function createCollectionTransferService({ workspaceRepository, getGroups, saveGroups }) {
    if (!workspaceRepository?.get || !workspaceRepository?.addEntries || !getGroups || !saveGroups) {
      throw new TypeError('Collection transfer dependencies are required');
    }

    async function workspaceToGroup(workspaceId, entryIds, groupId, options = {}) {
      const workspace = await workspaceRepository.get(workspaceId);
      const selected = new Set(entryIds || []);
      const entries = workspace?.entries?.filter(entry => selected.has(entry.id)) || [];
      if (!workspace || entries.length !== selected.size || !entries.length) throw new Error('Workspace entries not found');
      const groups = await getGroups();
      const group = groups.find(item => item.id === groupId);
      if (!group) throw new Error('Collected group not found');
      const urls = new Set(group.tabs.map(tab => tab.url));
      for (const entry of entries) {
        if (!urls.has(entry.url)) group.tabs.push({ url: entry.url, title: entry.title || entry.url });
        urls.add(entry.url);
      }
      delete group.session;
      await saveGroups(groups);
      if (!options.copy) await workspaceRepository.removeEntries(workspaceId, entries.map(entry => entry.id));
      return { moved: entries.length, group };
    }

    async function groupToWorkspace(groupId, tabIndexes, workspaceId, options = {}) {
      const groups = await getGroups();
      const group = groups.find(item => item.id === groupId);
      const indexes = [...new Set(tabIndexes || [])].filter(Number.isInteger).sort((a, b) => a - b);
      const tabs = indexes.map(index => group?.tabs?.[index]).filter(Boolean);
      if (!group || !tabs.length || tabs.length !== indexes.length) throw new Error('Collected tabs not found');
      await workspaceRepository.addEntries(workspaceId, tabs);
      if (!options.copy) {
        const removed = new Set(indexes);
        group.tabs = group.tabs.filter((_tab, index) => !removed.has(index));
        delete group.session;
        const retained = groups.filter(item => item.id !== groupId || item.tabs.length > 0);
        await saveGroups(retained);
      }
      return { moved: tabs.length };
    }

    return { workspaceToGroup, groupToWorkspace };
  }

  const api = { createCollectionTransferService };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
