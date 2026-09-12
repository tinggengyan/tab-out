(function initWorkspaceRepository(globalScope) {
  'use strict';
  const normalizeWebUrl = typeof require === 'function'
    ? require('../shared/sanitize.js').normalizeWebUrl
    : globalScope.TabOutCore.normalizeWebUrl;

  function createWorkspaceRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'workspacesV2';
    const createId = options.id || (() => globalScope.crypto.randomUUID());
    const now = options.now || (() => new Date().toISOString());

    async function list() {
      const stored = await storageArea.get(key);
      const workspaces = Array.isArray(stored[key]) ? stored[key] : [];
      return workspaces.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
    }
    async function write(workspaces) { await storageArea.set({ [key]: workspaces }); }
    function normalizeEntries(entries, existing = []) {
      const seen = new Set(existing.map(entry => entry.url));
      return (entries || []).map(entry => {
        const url = normalizeWebUrl(entry?.url);
        if (!url || seen.has(url)) return null;
        seen.add(url);
        return {
          id: entry.id || createId(), url,
          title: String(entry.title || url).slice(0, 1024),
          order: existing.length + seen.size - 1,
          pinned: Boolean(entry.pinned),
          ...(entry.group ? { group: String(entry.group).slice(0, 256) } : {}),
          addedAt: entry.addedAt || now(),
        };
      }).filter(Boolean);
    }

    return {
      list,
      async get(id) { return (await list()).find(workspace => workspace.id === id) || null; },
      async create(input = {}) {
        const workspaces = await list();
        const timestamp = now();
        const workspace = {
          id: createId(),
          name: String(input.name || 'Untitled workspace').slice(0, 256),
          description: String(input.description || '').slice(0, 1024),
          color: input.color || '#c8713a',
          icon: input.icon || '',
          pinned: Boolean(input.pinned),
          order: workspaces.length,
          createdAt: timestamp,
          updatedAt: timestamp,
          entries: normalizeEntries(input.entries),
        };
        await write([...workspaces, workspace]);
        return workspace;
      },
      async update(id, patch) {
        const workspaces = await list();
        const index = workspaces.findIndex(workspace => workspace.id === id);
        if (index < 0) throw new Error('Workspace not found');
        const allowed = ['name', 'description', 'color', 'icon', 'pinned', 'order'];
        const next = { ...workspaces[index] };
        for (const field of allowed) if (Object.hasOwn(patch, field)) next[field] = patch[field];
        next.updatedAt = now();
        workspaces[index] = next;
        await write(workspaces);
        return next;
      },
      async addEntries(id, entries) {
        const workspaces = await list();
        const workspace = workspaces.find(item => item.id === id);
        if (!workspace) throw new Error('Workspace not found');
        workspace.entries.push(...normalizeEntries(entries, workspace.entries));
        workspace.entries.forEach((entry, index) => { entry.order = index; });
        workspace.updatedAt = now();
        await write(workspaces);
        return workspace;
      },
      async moveEntry(id, entryId, targetIndex) {
        const workspaces = await list();
        const workspace = workspaces.find(item => item.id === id);
        if (!workspace) throw new Error('Workspace not found');
        const sourceIndex = workspace.entries.findIndex(entry => entry.id === entryId);
        if (sourceIndex < 0) throw new Error('Workspace entry not found');
        const [entry] = workspace.entries.splice(sourceIndex, 1);
        const bounded = Math.max(0, Math.min(targetIndex, workspace.entries.length));
        workspace.entries.splice(bounded, 0, entry);
        workspace.entries.forEach((item, index) => { item.order = index; });
        workspace.updatedAt = now();
        await write(workspaces);
        return workspace;
      },
      async transferEntry(sourceId, targetId, entryId, transferOptions = {}) {
        if (sourceId === targetId) return this.moveEntry(sourceId, entryId, transferOptions.targetIndex ?? 0);
        const workspaces = await list();
        const source = workspaces.find(item => item.id === sourceId);
        const target = workspaces.find(item => item.id === targetId);
        if (!source || !target) throw new Error('Workspace not found');
        const entryIndex = source.entries.findIndex(entry => entry.id === entryId);
        if (entryIndex < 0) throw new Error('Workspace entry not found');
        const entry = source.entries[entryIndex];
        if (!target.entries.some(item => item.url === entry.url)) {
          const copy = { ...entry, id: createId(), addedAt: now() };
          const targetIndex = Math.max(0, Math.min(transferOptions.targetIndex ?? target.entries.length, target.entries.length));
          target.entries.splice(targetIndex, 0, copy);
        }
        if (!transferOptions.copy) source.entries.splice(entryIndex, 1);
        source.entries.forEach((item, index) => { item.order = index; });
        target.entries.forEach((item, index) => { item.order = index; });
        source.updatedAt = now();
        target.updatedAt = now();
        await write(workspaces);
        return { source, target };
      },
      async transferEntries(sourceId, targetId, entryIds, transferOptions = {}) {
        if (sourceId === targetId) return { source: await this.get(sourceId), target: await this.get(targetId) };
        const workspaces = await list();
        const source = workspaces.find(item => item.id === sourceId);
        const target = workspaces.find(item => item.id === targetId);
        if (!source || !target) throw new Error('Workspace not found');
        const selected = new Set(entryIds || []);
        const entries = source.entries.filter(entry => selected.has(entry.id));
        if (entries.length !== selected.size) throw new Error('Workspace entry not found');
        const targetUrls = new Set(target.entries.map(entry => entry.url));
        for (const entry of entries) {
          if (!targetUrls.has(entry.url)) {
            target.entries.push({ ...entry, id: createId(), addedAt: now() });
            targetUrls.add(entry.url);
          }
        }
        if (!transferOptions.copy) source.entries = source.entries.filter(entry => !selected.has(entry.id));
        source.entries.forEach((entry, index) => { entry.order = index; });
        target.entries.forEach((entry, index) => { entry.order = index; });
        source.updatedAt = now();
        target.updatedAt = now();
        await write(workspaces);
        return { source, target };
      },
      async removeEntries(id, entryIds) {
        const workspaces = await list();
        const workspace = workspaces.find(item => item.id === id);
        if (!workspace) throw new Error('Workspace not found');
        const selected = new Set(entryIds || []);
        workspace.entries = workspace.entries.filter(entry => !selected.has(entry.id));
        workspace.entries.forEach((entry, index) => { entry.order = index; });
        workspace.updatedAt = now();
        await write(workspaces);
        return workspace;
      },
      async move(id, targetIndex) {
        const workspaces = await list();
        const sourceIndex = workspaces.findIndex(workspace => workspace.id === id);
        if (sourceIndex < 0) throw new Error('Workspace not found');
        const [workspace] = workspaces.splice(sourceIndex, 1);
        const bounded = Math.max(0, Math.min(targetIndex, workspaces.length));
        workspaces.splice(bounded, 0, workspace);
        workspaces.forEach((item, index) => { item.order = index; });
        await write(workspaces);
        return workspace;
      },
      async restore(input = {}) {
        const workspaces = await list();
        const timestamp = now();
        const workspace = {
          id: input.id && !workspaces.some(item => item.id === input.id) ? input.id : createId(),
          name: String(input.name || 'Restored workspace').slice(0, 256),
          description: String(input.description || '').slice(0, 1024),
          color: input.color || '#c8713a', icon: String(input.icon || '').slice(0, 64),
          pinned: Boolean(input.pinned), order: workspaces.length,
          createdAt: input.createdAt || timestamp, updatedAt: timestamp,
          entries: normalizeEntries(input.entries),
        };
        await write([...workspaces, workspace]);
        return workspace;
      },
      async remove(id) {
        const workspaces = await list();
        const removed = workspaces.find(workspace => workspace.id === id);
        if (!removed) throw new Error('Workspace not found');
        const remaining = workspaces.filter(workspace => workspace.id !== id);
        remaining.forEach((workspace, index) => { workspace.order = index; });
        await write(remaining);
        return removed;
      },
    };
  }
  const api = { createWorkspaceRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
