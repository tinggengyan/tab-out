(function initProjectService(globalScope) {
  'use strict';
  const { normalizeWebUrl } = typeof require === 'function' ? require('../shared/sanitize.js') : globalScope.TabOutCore;
  const { buildSession, sessionFingerprint } = typeof require === 'function' ? require('../domain/session.js') : globalScope.TabOutCore;
  const { projectFingerprint } = typeof require === 'function' ? require('../storage/workspace-repository.js') : globalScope.TabOutCore;

  function projectUpdateImpact(workspace, preview, updateMode = 'append') {
    const pages = input => {
      const result = new Map();
      for (const page of input || []) {
        const url = normalizeWebUrl(page.url);
        if (url && !result.has(url)) result.set(url, { url, title: page.title || url });
      }
      return result;
    };
    const old = pages(workspace?.entries || workspace?.session?.windows?.flatMap(window => window.tabs));
    const selected = new Set(preview?.tabIds || []);
    const next = pages(preview?.candidates ? preview.candidates.filter(tab => selected.has(tab.id) && tab.eligible !== false) : preview?.session?.windows?.flatMap(window => window.tabs));
    return {
      added: [...next].filter(([url]) => !old.has(url)).map(([, page]) => page),
      retained: [...old].filter(([url]) => updateMode !== 'replace' || next.has(url)).map(([, page]) => page),
      removed: updateMode === 'replace' ? [...old].filter(([url]) => !next.has(url)).map(([, page]) => page) : [],
    };
  }

  function refreshSessionStats(session) {
    session.stats = { windowCount: session.windows.length, tabCount: session.windows.reduce((count, window) => count + window.tabs.length, 0), groupCount: session.windows.reduce((count, window) => count + (window.groups || []).length, 0) };
    session.fingerprint = sessionFingerprint(session);
    return session;
  }

  function appendProjectSession(previous, captured) {
    const session = structuredClone(previous);
    const knownUrls = new Set(session.windows.flatMap(window => window.tabs.map(tab => normalizeWebUrl(tab.url))).filter(Boolean));
    const tabRefs = new Set(session.windows.flatMap(window => window.tabs.map(tab => tab.id)));
    const groupRefs = new Set(session.windows.flatMap(window => (window.groups || []).map(group => group.ref)));
    const windowIds = new Set(session.windows.map(window => window.sourceWindowId));
    let sequence = 0;
    const uniqueRef = (prefix, used) => {
      let ref;
      do { ref = `${prefix}:${++sequence}`; } while (used.has(ref));
      used.add(ref);
      return ref;
    };
    for (const source of captured.windows) {
      const window = structuredClone(source);
      window.tabs = window.tabs.filter(tab => {
        const url = normalizeWebUrl(tab.url);
        if (!url || knownUrls.has(url)) return false;
        knownUrls.add(url);
        return true;
      });
      if (!window.tabs.length) continue;
      const references = new Map(window.tabs.map(tab => [tab.id, uniqueRef('append-tab', tabRefs)]));
      const groups = new Map();
      window.groups = (window.groups || []).map(group => {
        const tabIds = group.tabIds.filter(id => references.has(id)).map(id => references.get(id));
        if (!tabIds.length) return null;
        const ref = uniqueRef('append-group', groupRefs);
        groups.set(group.ref, ref);
        return { ...group, ref, tabIds };
      }).filter(Boolean);
      window.tabs = window.tabs.map(tab => {
        const next = { ...tab, id: references.get(tab.id) };
        if (groups.has(tab.groupRef)) next.groupRef = groups.get(tab.groupRef);
        else delete next.groupRef;
        return next;
      });
      if (windowIds.has(window.sourceWindowId)) {
        let id = -1;
        while (windowIds.has(id)) id--;
        window.sourceWindowId = id;
      }
      windowIds.add(window.sourceWindowId);
      session.windows.push(window);
    }
    return refreshSessionStats(session);
  }

  function createProjectService({ chromeApi, workspaceRepository, sessionAdapter, operationService, getWorkspaceLimit = async () => Infinity, now = () => new Date().toISOString() }) {
    if (!chromeApi?.tabs || !workspaceRepository || !sessionAdapter || !operationService) throw new TypeError('Project service dependencies are required');
    const { createSavedContinuation } = typeof require === 'function' ? require('../ui/saved-library.js') : globalScope.TabOutCore;
    const continueProject = createSavedContinuation({ chromeApi, sessionAdapter });
    let busy = false;
    const fail = (code, message = code) => Object.assign(new Error(message), { code });
    const urlOf = tab => normalizeWebUrl(tab.pendingUrl || tab.url);
    const workspaceFingerprint = projectFingerprint;
    const sourceFingerprint = tabs => JSON.stringify(tabs.map(tab => ({ id: tab.id, windowId: tab.windowId, url: urlOf(tab), pinned: Boolean(tab.pinned) })).sort((a, b) => a.id - b.id));
    async function locked(action) {
      if (busy) throw fail('operation_busy');
      busy = true;
      try { return await action(); } finally { busy = false; }
    }
    async function readWindow(windowId) {
      if (!Number.isInteger(windowId)) throw fail('invalid_window');
      const window = chromeApi.windows?.get ? await chromeApi.windows.get(windowId) : (await chromeApi.windows.getAll({})).find(item => item.id === windowId);
      if (!window || window.incognito) throw fail('invalid_window');
      return (await chromeApi.tabs.query({ windowId })).filter(tab => tab.windowId === windowId && !tab.incognito);
    }
    async function previewSave({ windowId, tabIds, acrossWindows = false } = {}) {
      const tabs = acrossWindows ? (await chromeApi.tabs.query({})).filter(tab => !tab.incognito) : await readWindow(windowId);
      const wanted = new Set(tabIds === undefined ? tabs.filter(tab => urlOf(tab) && !tab.pinned).map(tab => tab.id) : tabIds);
      const candidates = tabs.map(tab => {
        const url = urlOf(tab);
        return { id: tab.id, windowId: tab.windowId, url: url || String(tab.pendingUrl || tab.url || ''), title: tab.title || url || '', pinned: Boolean(tab.pinned), eligible: Boolean(url), selected: Boolean(url) && wanted.has(tab.id), ...(!url ? { reason: 'unsupported' } : tab.pinned ? { reason: 'pinned_kept' } : {}) };
      });
      const selected = tabs.filter(tab => urlOf(tab) && wanted.has(tab.id));
      const selectedIds = selected.map(tab => tab.id);
      const session = await sessionAdapter.captureTabs(selectedIds);
      const workspaceVersions = Object.fromEntries((await workspaceRepository.list()).map(workspace => [workspace.id, workspaceFingerprint(workspace)]));
      return {
        kind: 'save', windowId, acrossWindows, candidates, tabIds: selectedIds,
        closeTabIds: selected.filter(tab => !tab.pinned).map(tab => tab.id), session,
        fingerprint: sourceFingerprint(selected), workspaceVersions,
        counts: { total: tabs.length, selected: selected.length, closable: selected.filter(tab => !tab.pinned).length, pinned: selected.filter(tab => tab.pinned).length, unsupported: candidates.filter(tab => !tab.eligible).length },
      };
    }
    async function validateSave(preview) {
      if (preview?.kind !== 'save' || !Array.isArray(preview.tabIds)) throw fail('invalid_preview');
      if (!preview.tabIds.length) throw fail('empty_selection');
      const tabs = preview.acrossWindows ? (await chromeApi.tabs.query({})).filter(tab => !tab.incognito) : await readWindow(preview.windowId);
      const ids = new Set(preview.tabIds);
      const selected = tabs.filter(tab => ids.has(tab.id));
      if (selected.length !== ids.size || sourceFingerprint(selected) !== preview.fingerprint) throw fail('preview_stale');
      return selected;
    }
    async function saveInternal({ preview, name, workspaceId, updateMode = 'append' }) {
      if (!['append', 'replace'].includes(updateMode)) throw fail('invalid_mode');
      await validateSave(preview);
      const cleanName = String(name || '').trim();
      if (!cleanName || cleanName.length > 256) throw fail('invalid_name');
      let existing;
      if (!workspaceId) {
        const limit = await getWorkspaceLimit();
        if ((await workspaceRepository.list()).length >= limit) throw fail('workspace_limit');
      } else {
        existing = await workspaceRepository.get(workspaceId);
        if (!existing || preview.workspaceVersions?.[workspaceId] !== workspaceFingerprint(existing)) throw fail('preview_stale');
      }
      let session = await sessionAdapter.captureTabs(preview.tabIds);
      if (!session.windows?.length || session.windows.flatMap(window => window.tabs).length !== preview.tabIds.length) throw fail('preview_stale');
      // Capture is asynchronous: reject navigation/closure that happened while
      // reading browser metadata before persisting or closing any source page.
      await validateSave(preview);
      if (existing && updateMode === 'append') session = appendProjectSession(sessionFor(existing), session);
      session.type = 'project';
      session.source = 'project-save';
      session.capturedAt = now();
      refreshSessionStats(session);
      return workspaceRepository.saveSession({ workspaceId, name: cleanName, session,
        ...(existing ? { expectedFingerprint: preview.workspaceVersions[workspaceId] } : {}) });
    }
    function sessionFor(workspace) {
      if (workspace.session?.windows) return structuredClone(workspace.session);
      return buildSession({
        id: `project:${workspace.id}`, type: 'project', source: 'legacy-workspace',
        windows: [{ tabs: (workspace.entries || []).map((entry, index) => ({ id: entry.id || `${workspace.id}:${index}`, url: entry.url, title: entry.title, pinned: Boolean(entry.pinned), index, active: index === 0, groupId: -1 })) }],
      });
    }
    function missingPlan(session, openTabs) {
      const openUrls = new Set(openTabs.filter(tab => !tab.incognito).map(urlOf).filter(Boolean));
      const planned = new Set();
      let total = 0;
      let existing = 0;
      let unsupported = 0;
      const windows = (session.windows || []).map(window => {
        const tabs = (window.tabs || []).filter(tab => {
          total++;
          const url = normalizeWebUrl(tab.url);
          if (!url || tab.restorable === false) { unsupported++; return false; }
          if (openUrls.has(url)) { existing++; return false; }
          if (planned.has(url)) return false;
          planned.add(url);
          return true;
        });
        const refs = new Set(tabs.map(tab => tab.id));
        const groups = (window.groups || []).map(group => ({ ...group, tabIds: (group.tabIds || []).filter(ref => refs.has(ref)) })).filter(group => group.tabIds.length);
        return { ...window, tabs, groups };
      }).filter(window => window.tabs.length);
      return { session: { ...session, windows }, counts: { total, missing: planned.size, existing, unsupported } };
    }
    async function previewResume({ workspaceId, mode = 'new-window', targetWindowId } = {}) {
      if (!['new-window', 'merge-current'].includes(mode)) throw fail('invalid_mode');
      if (mode === 'merge-current') await readWindow(targetWindowId);
      const workspace = await workspaceRepository.get(workspaceId);
      if (!workspace) throw fail('workspace_not_found');
      const session = sessionFor(workspace);
      const { counts } = missingPlan(session, await chromeApi.tabs.query({}));
      return { kind: 'resume', workspaceId, workspace, session, mode, targetWindowId, counts, fingerprint: workspaceFingerprint(workspace) };
    }
    async function validateResume(preview) {
      if (preview?.kind !== 'resume') throw fail('invalid_preview');
      const workspace = await workspaceRepository.get(preview.workspaceId);
      if (!workspace || workspaceFingerprint(workspace) !== preview.fingerprint) throw fail('preview_stale');
      if (preview.mode === 'merge-current') await readWindow(preview.targetWindowId);
      return workspace;
    }
    async function resumeInternal({ preview }) {
      const workspace = await validateResume(preview);
      const previous = preview.retryState;
      const plan = missingPlan(sessionFor(workspace), await chromeApi.tabs.query({}));
      // Every project uses the same failure-safe continuation engine, including
      // migrated collections and merge-current restoration.
      const restored = await continueProject({ id: `${workspace.id}:${preview.mode}:${preview.targetWindowId || ''}:${workspaceFingerprint(workspace)}`, session: sessionFor(workspace) }, preview);
      const failures = [...(restored.failures || [])];
      try { await workspaceRepository.touch(workspace.id); }
      catch (error) { failures.push({ code: 'project_usage_update_failed', message: error.message }); }
      const counts = { saved: 0, opened: (previous?.opened || 0) + restored.opened, reused: previous?.reused ?? plan.counts.existing, closed: 0, kept: 0, skipped: plan.counts.unsupported, failed: failures.length };
      const result = { status: failures.length ? counts.opened || counts.reused ? 'partial' : 'failed' : 'complete', workspace, counts, failures };
      if (failures.length) result.retryPreview = { ...preview, retryState: { opened: counts.opened, reused: counts.reused } };
      return result;
    }
    async function closeSource(preview, workspace, excludedUrls = new Set(), validateTarget) {
      const selected = await validateSave(preview);
      const closeIds = selected.filter(tab => !tab.pinned && !excludedUrls.has(urlOf(tab))).map(tab => tab.id);
      const counts = { saved: preview.tabIds.length, opened: 0, reused: 0, closed: 0, kept: preview.tabIds.length - closeIds.length, skipped: 0, failed: 0 };
      if (!closeIds.length) return { status: 'complete', workspace, counts, failures: [] };
      try {
        const operation = await operationService.close(closeIds, { source: 'project-park', workspaceId: workspace.id }, {
          beforeRemove: async () => {
            if (validateTarget) await validateTarget();
            await validateSave(preview);
          },
        });
        counts.closed = operation.result?.succeeded || 0;
        const failures = operation.result?.failed || [];
        counts.failed = failures.length;
        return { status: failures.length ? 'partial' : 'complete', workspace, counts, failures, operation };
      } catch (error) {
        const failures = [{ code: error.code || 'close_failed', message: error.message }];
        return { status: 'failed', workspace, counts: { ...counts, kept: preview.tabIds.length, failed: closeIds.length }, failures };
      }
    }
    async function removeSavedEntry({ workspaceId, url, expectedFingerprint }) {
      const existing = await workspaceRepository.get(workspaceId);
      if (!existing) throw fail('workspace_not_found');
      if (typeof expectedFingerprint !== 'string' || projectFingerprint(existing) !== expectedFingerprint) throw fail('preview_stale');
      const normalized = normalizeWebUrl(url);
      if (!normalized || !existing.entries.some(entry => normalizeWebUrl(entry.url) === normalized)) throw fail('entry_not_found');
      if (!existing.entries.some(entry => normalizeWebUrl(entry.url) !== normalized)) throw fail('empty_selection');
      const session = sessionFor(existing);
      session.windows = session.windows.map(window => {
        const tabs = window.tabs.filter(tab => normalizeWebUrl(tab.url) !== normalized);
        const refs = new Set(tabs.map(tab => tab.id));
        const groups = (window.groups || []).map(group => ({ ...group, tabIds: group.tabIds.filter(ref => refs.has(ref)) })).filter(group => group.tabIds.length);
        return { ...window, tabs, groups };
      }).filter(window => window.tabs.length);
      refreshSessionStats(session);
      return workspaceRepository.saveSession({ workspaceId, name: existing.name, session, expectedFingerprint });
    }
    return {
      previewSave, previewResume, projectFingerprint,
      removeSavedEntry: input => locked(() => removeSavedEntry(input)),
      save: input => locked(() => saveInternal(input)),
      park: input => locked(async () => { const workspace = await saveInternal(input); return closeSource(input.preview, workspace); }),
      resume: input => locked(() => resumeInternal(input)),
      switchProject: input => locked(async () => {
        if (input.sourceWorkspaceId && input.sourceWorkspaceId === input.targetPreview?.workspaceId) throw fail('same_workspace');
        await validateSave(input.sourcePreview);
        await validateResume(input.targetPreview);
        const workspace = await saveInternal({ preview: input.sourcePreview, name: input.sourceName, workspaceId: input.sourceWorkspaceId, updateMode: 'replace' });
        const target = await resumeInternal({ preview: input.targetPreview });
        if (target.status !== 'complete') return { ...target, sourceWorkspace: workspace, counts: { ...target.counts, saved: input.sourcePreview.tabIds.length, kept: input.sourcePreview.tabIds.length } };
        const targetUrls = new Set(sessionFor(target.workspace).windows.flatMap(window => window.tabs).map(tab => normalizeWebUrl(tab.url)).filter(Boolean));
        const closed = await closeSource(input.sourcePreview, workspace, targetUrls, () => validateResume(input.targetPreview));
        return { ...closed, workspace: target.workspace, sourceWorkspace: workspace, counts: { ...closed.counts, opened: target.counts.opened, reused: target.counts.reused, skipped: target.counts.skipped } };
      }),
    };
  }
  const api = { createProjectService, projectUpdateImpact };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
