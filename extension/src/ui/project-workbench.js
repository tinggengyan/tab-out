(function initProjectWorkbench(globalScope) {
  'use strict';

  const normalizeUrl = typeof require === 'function'
    ? require('../shared/sanitize.js').normalizeWebUrl
    : globalScope.TabOutCore.normalizeWebUrl;

  const savedLibrary = typeof require === 'function' ? require('./saved-library.js') : globalScope.TabOutCore;

  function projectError(code) { return Object.assign(new Error(code), { code }); }
  function filterProjectCandidates(candidates, query) {
    const needle = String(query || '').normalize('NFKC').trim().toLowerCase();
    return (candidates || []).filter(tab => !needle || `${tab.title || ''} ${tab.url || ''}`.normalize('NFKC').toLowerCase().includes(needle));
  }
  function selectWorkspaceTabIds(candidates, workspace) {
    const urls = new Set((workspace?.entries || []).map(entry => normalizeUrl(entry.url)).filter(Boolean));
    return (candidates || []).filter(tab => tab.eligible && urls.has(normalizeUrl(tab.url))).map(tab => tab.id);
  }
  function selectFilteredProjectTabIds(candidates, selectedIds, query) {
    const matching = filterProjectCandidates(candidates, query).filter(tab => tab.eligible).map(tab => tab.id);
    return [...new Set([...(selectedIds || []), ...matching])];
  }
  function projectFailureMessageKey(code) {
    const known = ['create_failed', 'window_create_failed', 'group_restore_failed', 'tab_metadata_restore_failed', 'close_failed', 'tabs_remove_failed', 'project_usage_update_failed', 'unsupported_url'];
    return `project.failure.${known.includes(code) ? code : 'unknown'}`;
  }
  function projectSelectionImpact({ mode, preview, targetPreview }) {
    const selected = preview?.counts?.selected || 0;
    if (mode !== 'switch') return { selected, closable: preview?.counts?.closable || 0, sharedTabIds: [] };
    const windows = targetPreview?.session?.windows || targetPreview?.workspace?.session?.windows;
    const targetPages = Array.isArray(windows) ? windows.flatMap(window => window.tabs || []) : targetPreview?.workspace?.entries || [];
    const targetUrls = new Set(targetPages.map(tab => normalizeUrl(tab.url)).filter(Boolean));
    const sharedTabIds = (preview?.candidates || []).filter(tab => tab.eligible && targetUrls.has(normalizeUrl(tab.url))).map(tab => tab.id);
    const sharedIds = new Set(sharedTabIds);
    const selectedIds = new Set(preview?.tabIds || []);
    const closableIds = preview?.closeTabIds || (preview?.candidates || []).filter(tab => tab.eligible && !tab.pinned && selectedIds.has(tab.id)).map(tab => tab.id);
    return { selected, closable: closableIds.filter(id => !sharedIds.has(id)).length, sharedTabIds };
  }
  function focusVisibleProjectAction(controls) {
    const target = controls.find(control => control && !control.hidden && !control.disabled && control.isConnected !== false && control.offsetParent !== null && (!control.getClientRects || control.getClientRects().length > 0) && !control.closest?.('[hidden]') && (!control.closest?.('details:not([open])') || control.tagName === 'SUMMARY') );
    target?.focus({ preventScroll: true });
    return target;
  }
  function restoreProjectFocus({ previous, projectId, action, buttons, fallback, fallbacks = [] }) {
    const replacements = (buttons || []).filter(button => button.dataset.projectId === projectId && button.dataset.projectAction === action);
    return focusVisibleProjectAction([previous, ...replacements, fallback, ...fallbacks]);
  }
  function captureOpenProjectMenus(list) {
    return new Set([...list.querySelectorAll('.project-card-menu[open]')].map(menu => menu.closest('[data-project-id]')?.dataset.projectId).filter(Boolean));
  }
  function restoreOpenProjectMenus(list, openIds) {
    for (const menu of list.querySelectorAll('.project-card-menu')) {
      menu.open = openIds.has(menu.closest('[data-project-id]')?.dataset.projectId);
    }
  }
  function captureProjectMenuFocus(list, activeElement) {
    if (!activeElement || !list.contains?.(activeElement)) return null;
    const menu = activeElement.closest?.('.project-card-menu');
    if (!menu?.open) return null;
    const projectId = menu.closest('[data-project-id]')?.dataset.projectId;
    if (!projectId) return null;
    return { projectId, action: activeElement.closest?.('[data-project-action]')?.dataset.projectAction || null };
  }
  function restoreProjectMenuFocus(list, previous) {
    if (!previous) return;
    const menu = [...list.querySelectorAll('.project-card-menu')].find(item => item.closest('[data-project-id]')?.dataset.projectId === previous.projectId);
    if (!menu?.open) return;
    const summary = menu.querySelector(':scope > summary');
    const action = previous.action ? [...menu.querySelectorAll('[data-project-action]')].find(button => button.dataset.projectAction === previous.action) : summary;
    focusVisibleProjectAction([action, summary]);
  }
  function projectWindowNumbers(tabs, sourceWindowId) {
    // Match the tab dashboard's ascending, one-based window labels. Chrome's
    // internal IDs stay in controller state and never become display numbers.
    const ids = new Set((tabs || []).filter(tab => !tab.incognito && !/^(chrome|chrome-extension|about|edge|brave):/i.test(tab.pendingUrl || tab.url || '')).map(tab => tab.windowId).filter(Number.isInteger));
    if (Number.isInteger(sourceWindowId)) ids.add(sourceWindowId);
    return new Map([...ids].sort((a, b) => a - b).map((id, index) => [id, index + 1]));
  }
  function projectWindowScope(state, windowId, translate) {
    return windowId === state.currentWindowId ? translate('project.scopeCurrent')
      : translate('project.scopeWindow', { n: state.windowNumbers?.get(windowId) || 1 });
  }

  function createProjectWorkbenchController({ chromeApi, service, workspaceRepository }) {
    let state = { step: 'closed', busy: false };
    let selectionGeneration = 0;
    let restoreGeneration = 0;
    let pendingSelection = Promise.resolve();
    async function begin(mode, { workspaceId, tabIds = [], windowId, acrossWindows = false, updateMode = 'append' } = {}) {
      if (state.busy) throw projectError('operation_busy');
      const currentWindow = await chromeApi.windows.getCurrent();
      const window = windowId === undefined ? currentWindow : { id: windowId };
      const workspaces = await workspaceRepository.list();
      const next = { mode, updateMode, windowId: window.id, acrossWindows, explicitWindow: windowId !== undefined, workspaces, sourceWorkspaceId: '', name: '', step: 'preview', busy: false, previewBusy: false, result: null, stale: false };
      if (mode !== 'resume') {
        next.preview = await service.previewSave({ windowId: window.id, tabIds, acrossWindows });
        // Freeze the target version represented by the workspace content shown to the user.
        next.workspaceVersions = service.projectFingerprint ? Object.fromEntries(workspaces.map(workspace => [workspace.id, service.projectFingerprint(workspace)])) : next.preview.workspaceVersions;
        if (next.workspaceVersions) next.preview.workspaceVersions = next.workspaceVersions;
      }
      next.currentWindowId = currentWindow.id;
      next.windowNumbers = projectWindowNumbers(chromeApi.tabs?.query ? await chromeApi.tabs.query({}) : next.preview?.candidates, window.id);
      if (mode === 'resume' || mode === 'switch') next.targetPreview = await service.previewResume({ workspaceId, mode: 'new-window' });
      selectionGeneration++;
      state = next;
      if (workspaceId && !['resume', 'switch'].includes(mode)) await setSource(workspaceId);
      return state;
    }
    async function setSelection(tabIds) {
      if (state.busy) throw projectError('operation_busy');
      const current = state;
      const generation = ++selectionGeneration;
      current.previewBusy = true;
      pendingSelection = service.previewSave({ windowId: current.windowId, acrossWindows: current.acrossWindows, tabIds: [...new Set(tabIds)] });
      try {
        const preview = await pendingSelection;
        if (state === current && generation === selectionGeneration) {
          if (current.workspaceVersions) preview.workspaceVersions = current.workspaceVersions;
          current.preview = preview; current.stale = false;
        }
      } finally {
        if (state === current && generation === selectionGeneration) current.previewBusy = false;
      }
      return state;
    }
    async function setSource(workspaceId) {
      if (workspaceId && workspaceId === state.targetPreview?.workspaceId) throw projectError('same_workspace');
      const workspace = state.workspaces.find(item => item.id === workspaceId);
      if (workspaceId && !workspace) throw projectError('preview_stale');
      state.sourceWorkspaceId = workspaceId || '';
      state.name = workspace?.name || '';
      const sourceCandidates = state.updateMode === 'replace' && state.acrossWindows ? state.preview?.candidates.filter(tab => tab.windowId === state.currentWindowId) : state.preview?.candidates;
      return setSelection(state.mode === 'switch' || state.updateMode === 'replace' ? (workspace ? selectWorkspaceTabIds(sourceCandidates, workspace) : []) : state.preview?.tabIds || []);
    }
    async function setRestoreMode(mode) {
      if (state.busy) throw projectError('operation_busy');
      const current = state;
      const generation = ++restoreGeneration;
      current.previewBusy = true;
      try {
        const preview = await service.previewResume({
          workspaceId: current.targetPreview.workspaceId,
          mode,
          ...(mode === 'merge-current' ? { targetWindowId: current.windowId } : {}),
        });
        if (state === current && generation === restoreGeneration) {
          current.targetPreview = preview;
          current.stale = false;
        }
      } catch (error) {
        if (state === current && generation === restoreGeneration) throw error;
      } finally {
        if (state === current && generation === restoreGeneration) current.previewBusy = false;
      }
      return state;
    }
    async function execute(action) {
      if (state.busy || state.previewBusy) throw projectError('operation_busy');
      if (state.stale) throw projectError('preview_stale');
      state.busy = true;
      try {
        await pendingSelection;
        const method = action || (state.mode === 'resume' ? 'resume' : state.mode === 'switch' ? 'switch' : state.mode === 'park' ? 'park' : 'save');
        let result;
        if (method === 'resume') result = await service.resume({ preview: state.targetPreview });
        else if (method === 'switch') {
          result = await service.switchProject({ sourcePreview: state.preview, sourceName: state.name.trim() || savedLibrary.savedDefaultName(state.preview?.candidates.filter(tab => state.preview.tabIds.includes(tab.id))), sourceWorkspaceId: state.sourceWorkspaceId || undefined, targetPreview: state.targetPreview });
        } else {
          const input = { preview: state.preview, name: state.name.trim() || savedLibrary.savedDefaultName(state.preview?.candidates.filter(tab => state.preview.tabIds.includes(tab.id))), workspaceId: state.sourceWorkspaceId || undefined, updateMode: state.updateMode };
          if (method === 'park') result = await service.park(input);
          else {
            const workspace = await service.save(input);
            result = { status: 'complete', workspace, counts: { saved: state.preview.counts.selected, opened: 0, reused: 0, closed: 0, kept: 0, skipped: 0, failed: 0 }, failures: [] };
          }
        }
        state.result = result;
        state.step = 'result';
        return result;
      } catch (error) {
        if (error.code === 'preview_stale') state.stale = true;
        throw error;
      } finally { state.busy = false; }
    }
    async function retry() {
      if (state.busy) throw projectError('operation_busy');
      if (!state.result?.retryPreview) throw projectError('preview_stale');
      state.busy = true;
      try {
        state.result = await service.resume({ preview: state.result.retryPreview });
        state.step = 'result';
        return state.result;
      } finally { state.busy = false; }
    }
    return {
      get state() { return state; }, begin, setSelection, setSource, setRestoreMode, execute, retry,
      setName(value) { state.name = String(value || '').slice(0, 256); },
      close() { if (!state.busy) { selectionGeneration++; state = { step: 'closed', busy: false }; } },
      async refreshPreview() {
        const previous = state;
        await begin(previous.mode, { workspaceId: previous.targetPreview?.workspaceId, tabIds: previous.preview?.tabIds || [], windowId: previous.windowId, acrossWindows: previous.acrossWindows, updateMode: previous.updateMode });
        state.name = previous.name;
        state.sourceWorkspaceId = previous.sourceWorkspaceId;
        if (previous.targetPreview?.mode === 'merge-current') await setRestoreMode('merge-current');
        return state;
      },
    };
  }

  function createProjectWorkbench({ chromeApi, service, workspaceRepository, document: doc = globalScope.document, translate, onOperation, onRefresh, exportBackup, undoOperation, onDelete, getSavedResult = () => null }) {
    const t = translate;
    const escape = globalScope.TabOutCore.escapeHtml;
    const controller = createProjectWorkbenchController({ chromeApi, service, workspaceRepository });
    const node = id => doc.getElementById(id);
    const overlay = node('projectDialogOverlay');
    const root = node('projectWorkbench');
    if (!root || !overlay) throw new Error('Project workbench markup is missing');
    let refreshGeneration = 0;
    let returnFocus;
    let returnProjectId;
    let returnAction;
    let returnMenuSummary;
    let returnContext;
    let detailId = null;
    let detailWorkspace = null;
    let detailBusy = false;
    let detailStatusKey = null;
    function setDetailStatus(key) { detailStatusKey = key; node('projectDetailStatus').textContent = key ? t(key) : ''; }
    let refreshTimer;
    let busyOpening = false;
    let undoing = false;
    let lastError;
    let mainStatusCopy = null;
    function setMainStatus(key) {
      mainStatusCopy = { key };
      node('projectMainStatus').textContent = t(key);
    }

    function localize() {
      const labels = {
        projectEyebrow: 'project.eyebrow', projectHeading: 'project.heading', projectIntro: 'project.intro',
        projectSaveBtn: 'project.createFromTabs', projectListTitle: 'project.yourProjects',
        projectEmptyTitle: 'project.emptyTitle', projectEmptyText: 'project.emptyText', projectBackupTitle: 'project.backupTitle',
        projectBackupText: 'project.backupText', projectBackupBtn: 'project.exportBackup', projectSourceLabel: 'project.saveTo',
        projectNameLabel: 'project.name', projectSelectAllBtn: 'project.selectAll', projectClearBtn: 'project.clearSelection',
        projectSelectionHint: 'project.selectionHint', projectRestoreLabel: 'project.restoreMode', projectCancelBtn: 'project.cancel',
        projectSaveOnlyBtn: 'project.saveOnly', projectRefreshPreviewBtn: 'project.refreshPreview', projectRetryBtn: 'project.retry',
        projectViewBtn: 'savedFlow.viewSaved', projectUndoBtn: 'project.undoPark', projectDoneBtn: 'project.done', projectTargetLabel: 'project.target',
      };
      for (const [id, key] of Object.entries(labels)) node(id).textContent = t(key);
      node('projectDialogCloseBtn').setAttribute('aria-label', t('project.close'));
      node('projectDialogCloseBtn').textContent = t('project.close');
      node('projectTabFilter').placeholder = t('project.filterPlaceholder');
      node('projectTabFilter').setAttribute('aria-label', t('project.filterPlaceholder'));
      if (detailStatusKey) setDetailStatus(detailStatusKey);
      node('projectDetailBackBtn').textContent = t('savedFlow.back');
      node('projectDetailAddBtn').textContent = t('savedFlow.addPages');
      node('projectDetailReplaceBtn').textContent = t('savedFlow.replace');
      node('projectDetailMore').textContent = t('savedFlow.more');
      node('projectNameInput').placeholder = t('project.namePlaceholder');
      node('projectRestoreMode').options[0].textContent = t('project.newWindow');
      node('projectRestoreMode').options[1].textContent = t('project.currentWindow');
    }
    function shortDate(value) {
      try { return new Intl.DateTimeFormat(doc.documentElement.lang || undefined, { month: 'short', day: 'numeric' }).format(new Date(value)); } catch { return ''; }
    }
    async function refresh() {
      const generation = ++refreshGeneration;
      localize();
      const [workspaces, tabs, currentWindow, backup, legacy] = await Promise.all([
        workspaceRepository.list(), chromeApi.tabs.query({}), chromeApi.windows.getCurrent(), chromeApi.storage.local.get('projectBackupStateV1'), chromeApi.storage.local.get(['tabGroups', 'deferred']),
      ]);
      if (generation !== refreshGeneration) return;
      const urls = new Set(tabs.map(tab => normalizeUrl(tab.pendingUrl || tab.url)).filter(Boolean));
      const current = tabs.filter(tab => tab.windowId === currentWindow.id && normalizeUrl(tab.pendingUrl || tab.url));
      node('projectWindowSummary').textContent = t('project.currentWindowCount', { n: current.length });
      const legacyItems = savedLibrary.legacySavedItems([], legacy.deferred);
      const laterItems = legacyItems.filter(item => item.kind === 'deferred');
      const activeLaterItems = laterItems.filter(item => !item.archived);
      const archivedItems = legacyItems.filter(item => item.archived);
      node('projectListCount').textContent = t('project.projectCount', { n: workspaces.length });
      node('projectEmpty').hidden = workspaces.length > 0;
      // Capture immediately before replacement: the user may have opened a menu while reads were pending.
      const openProjectMenus = captureOpenProjectMenus(node('projectList'));
      const projectMenuFocus = captureProjectMenuFocus(node('projectList'), doc.activeElement);
      node('projectList').innerHTML = [...workspaces].sort((a, b) => Date.parse(b.sessionSavedAt || b.updatedAt || b.createdAt || 0) - Date.parse(a.sessionSavedAt || a.updatedAt || a.createdAt || 0)).map(workspace => {
        const entries = workspace.entries || [];
        const existing = entries.filter(entry => urls.has(normalizeUrl(entry.url))).length;
        const missing = Math.max(0, entries.length - existing);
        const time = workspace.sessionSavedAt || workspace.updatedAt || workspace.createdAt;
        const previewTitles = entries.slice(0, 3).map(entry => entry.title || entry.url).join(' · ');
        return `<article class="project-card" data-project-id="${escape(workspace.id)}">
          <div class="project-card-heading"><h3><button class="project-title-button" data-project-action="detail" data-project-id="${escape(workspace.id)}">${escape(workspace.name)}</button></h3><span class="project-card-count">${escape(t('project.pageCount', { n: entries.length }))}</span></div>
          <p class="project-card-preview">${escape(previewTitles || t('project.noPages'))}</p>
          <div class="project-card-status"><span>${escape(t('savedFlow.savedCount', { n: entries.length }))}</span><span>${escape(t('project.openCount', { n: existing }))}</span></div>
          <div class="project-card-footer"><span>${escape(time ? t('project.updatedDate', { date: shortDate(time) }) : '')}</span><div class="project-card-actions"><details class="project-card-menu"><summary>${escape(t('savedFlow.more'))}</summary><button type="button" class="project-button project-button-quiet" data-project-action="update" data-project-id="${escape(workspace.id)}">${escape(t('savedFlow.addPages'))}</button><button type="button" class="project-button project-button-quiet" data-project-action="replace" data-project-id="${escape(workspace.id)}">${escape(t('savedFlow.replace'))}</button><button type="button" class="project-button project-button-quiet" data-project-action="rename" data-project-id="${escape(workspace.id)}">${escape(t('project.rename'))}</button><button type="button" class="project-button project-button-quiet" data-project-action="delete" data-project-id="${escape(workspace.id)}">${escape(t('project.delete'))}</button><button type="button" class="project-button project-button-quiet" data-project-action="switch" data-project-id="${escape(workspace.id)}">${escape(t('savedFlow.advancedSwitch'))}</button></details><button type="button" class="project-button project-button-primary" data-project-action="resume" data-project-id="${escape(workspace.id)}">${escape(t(missing ? 'savedFlow.openMissing' : 'savedFlow.allOpen', { n: missing }))}</button></div></div>
        </article>`;
      }).join('');
      restoreOpenProjectMenus(node('projectList'), openProjectMenus);
      restoreProjectMenuFocus(node('projectList'), projectMenuFocus);
      function legacyCard(item) {
        const result = getSavedResult(item.id);
        const existing = item.entries.filter(entry => urls.has(normalizeUrl(entry.url))).length;
        return `<article class="project-card" data-saved-kind="${item.kind}" data-saved-id="${escape(item.id)}"><div class="project-card-heading"><h3>${escape(item.name)}</h3><span class="project-card-count">${escape(t('project.pageCount', { n: item.entries.length }))}</span></div><p class="project-card-preview">${escape(item.entries.slice(0, 3).map(entry => entry.title || entry.url).join(' · '))}</p><div class="project-card-status"><span>${escape(t(item.kind === 'collected' ? 'saved.kindCollected' : 'saved.kindDeferred'))}</span><span>${escape(t('project.openCount', { n: existing }))}</span></div><div class="project-card-footer"><span>${escape(shortDate(item.savedAt))}</span><button class="project-button project-button-primary" data-saved-action="continue" data-saved-id="${escape(item.id)}" data-saved-kind="${item.kind}">${escape(t(result?.failed ? 'project.retry' : 'saved.continue'))}</button></div><p class="saved-continue-status" role="status" aria-live="polite">${result ? escape(t('saved.continueResult', result)) : ''}</p></article>`;
      }
      node('savedLaterTitle').textContent = t('saved.later', { n: laterItems.length });
      node('savedLaterList').innerHTML = activeLaterItems.map(legacyCard).join('');
      node('savedArchiveList').innerHTML = archivedItems.map(legacyCard).join('');
      node('savedArchive').hidden = !archivedItems.length;
      node('savedArchiveTitle').textContent = t('saved.archive', { n: archivedItems.length });
      node('projectAdvancedBtn').textContent = t('saved.advanced');
      const requestedAt = backup.projectBackupStateV1?.requestedAt;
      node('projectBackupStatus').textContent = requestedAt ? t('project.backupRequested', { date: shortDate(requestedAt) }) : t('project.backupNotRequested');
      if (detailId) await renderDetail();
    }
    function detailVisibility() {
      const active = Boolean(detailId);
      node('projectDetail').hidden = !active;
      node('projectList').hidden = active;
      root.classList?.toggle('has-detail', active);
    }
    async function renderDetail() {
      const id = detailId;
      const workspace = await workspaceRepository.get(id);
      if (detailId !== id) return;
      if (!workspace) { detailId = null; detailVisibility(); return; }
      detailWorkspace = workspace;
      const tabs = await chromeApi.tabs.query({});
      if (detailId !== id) return;
      const opened = new Set(tabs.map(tab => normalizeUrl(tab.pendingUrl || tab.url)).filter(Boolean));
      const entries = workspace.entries || [];
      const missing = entries.filter(entry => !opened.has(normalizeUrl(entry.url))).length;
      node('projectDetailTitle').textContent = workspace.name;
      node('projectDetailSummary').textContent = t('savedFlow.detailSummary', { n: entries.length, opened: entries.length - missing });
      node('projectDetailResumeBtn').textContent = t(missing ? 'savedFlow.openMissing' : 'savedFlow.allOpen', { n: missing });
      node('projectDetailEntries').innerHTML = entries.map(entry => `<article class="project-detail-row"><div><button class="project-entry-link" data-detail-action="open" data-entry-url="${escape(entry.url)}">${escape(entry.title || entry.url)}</button><p>${escape(entry.url)}</p><span>${escape(t(opened.has(normalizeUrl(entry.url)) ? 'savedFlow.isOpen' : 'savedFlow.isSaved'))}</span></div><div><button class="project-button" data-detail-action="open" data-entry-url="${escape(entry.url)}">${escape(t('savedFlow.openPage'))}</button><button class="project-button project-button-quiet" data-detail-action="remove" data-entry-url="${escape(entry.url)}">${escape(t('savedFlow.remove'))}</button></div></article>`).join('');
      detailVisibility();
    }
    async function openDetail(id) {
      detailId = id;
      setDetailStatus(null);
      await renderDetail();
      node('projectDetailBackBtn').focus({ preventScroll: true });
    }
    function renderUpdateImpact() {
      const state = controller.state;
      const target = state.workspaces?.find(item => item.id === state.sourceWorkspaceId);
      const box = node('projectUpdateImpact');
      box.hidden = !target || state.mode === 'switch' || !state.preview;
      if (box.hidden) return;
      const impact = globalScope.TabOutCore.projectUpdateImpact(target, state.preview, state.updateMode);
      box.dataset.mode = state.updateMode;
      const impactKeys = { added: 'savedFlow.added', retained: 'savedFlow.retained', removed: 'savedFlow.removedItems' };
      box.innerHTML = `<h3>${escape(t(state.updateMode === 'replace' ? 'savedFlow.replaceWarning' : 'savedFlow.appendHint'))}</h3>` + ['added','retained','removed'].map(kind => `<details ${state.updateMode === 'replace' ? 'open' : ''} data-impact-kind="${kind}"><summary>${escape(t(impactKeys[kind], { n: impact[kind].length }))}</summary><ul>${impact[kind].map(entry => `<li>${escape(entry.title || entry.url)}<small>${escape(entry.url)}</small></li>`).join('')}</ul></details>`).join('');
    }
    function showError(error) {
      lastError = error;
      const code = error?.code || 'unknown';
      const known = ['empty_selection', 'preview_stale', 'workspace_limit', 'operation_busy', 'invalid_name', 'same_workspace', 'invalid_window', 'group_metadata_unavailable'];
      node('projectDialogError').textContent = t(`project.error.${known.includes(code) ? code : 'unknown'}`);
      node('projectDialogError').hidden = false;
      node('projectRefreshPreviewBtn').hidden = code !== 'preview_stale';
    }
    function clearError() { lastError = null; node('projectDialogError').hidden = true; node('projectRefreshPreviewBtn').hidden = true; }
    function syncButtons() {
      const state = controller.state;
      const busy = state.busy || state.previewBusy || undoing;
      overlay.setAttribute('aria-busy', String(busy));
      overlay.querySelectorAll('button, input, select').forEach(control => { control.disabled = Boolean(busy); });
      const empty = !state.preview?.tabIds?.length;
      node('projectSaveOnlyBtn').disabled = Boolean(busy || empty || state.stale);
      node('projectExecuteBtn').disabled = Boolean(busy || state.stale || (state.mode !== 'resume' && empty));
      if (state.updateMode === 'replace') node('projectSourceSelect').disabled = true;
      node('projectBusy').hidden = !busy;
      node('projectBusy').textContent = t(state.previewBusy ? 'project.updatingPreview' : 'project.working');
      node('projectCandidates').querySelectorAll('input[data-tab-id]').forEach(input => {
        const candidate = state.preview?.candidates.find(tab => String(tab.id) === input.dataset.tabId);
        if (!candidate?.eligible) input.disabled = true;
      });
    }
    function renderCandidates() {
      const state = controller.state;
      const selected = new Set(state.preview?.tabIds || []);
      const impact = projectSelectionImpact(state);
      const shared = new Set(impact.sharedTabIds);
      const candidates = filterProjectCandidates(state.preview?.candidates, node('projectTabFilter').value);
      node('projectSelectAllBtn').textContent = t(node('projectTabFilter').value.trim() ? 'project.selectFiltered' : 'project.selectAll');
      node('projectCandidates').innerHTML = candidates.map(tab => {
        let host = tab.url || '';
        try { host = new URL(tab.url).host; } catch { /* keep readable unsupported location */ }
        const keptReason = shared.has(tab.id) ? (tab.pinned ? 'project.pinnedSharedKept' : 'project.sharedKept') : tab.pinned ? 'project.pinnedKept' : null;
        return `<label class="project-tab-row${tab.eligible ? '' : ' project-tab-unavailable'}"><input type="checkbox" data-tab-id="${escape(tab.id)}" ${selected.has(tab.id) ? 'checked' : ''} ${tab.eligible ? '' : 'disabled'}><span class="project-tab-copy"><span class="project-tab-title">${escape(tab.title || tab.url || t('project.untitledPage'))}</span><span class="project-tab-url">${escape(host)}${state.acrossWindows ? ' · ' + escape(projectWindowScope(state, tab.windowId, t)) : ''}</span></span>${keptReason ? `<span class="project-tab-note">${escape(t(keptReason))}</span>` : ''}${!tab.eligible ? `<span class="project-tab-note">${escape(t('project.unsupported'))}</span>` : ''}</label>`;
      }).join('') || `<p class="project-no-matches">${escape(t('project.noMatches'))}</p>`;
      renderSelectionSummary();
      syncButtons();
    }
    function renderSelectionSummary() {
      const impact = projectSelectionImpact(controller.state);
      node('projectScope').textContent = controller.state.acrossWindows ? t('project.scopeSelected') : projectWindowScope(controller.state, controller.state.windowId, t);
      node('projectSelectionSummary').textContent = t('project.selectionSummary', { selected: impact.selected, closed: impact.closable, pinned: controller.state.preview?.counts?.pinned || 0 });
      renderUpdateImpact();
    }
    function renderTarget() {
      const preview = controller.state.targetPreview;
      if (!preview) return;
      node('projectTargetName').textContent = preview.workspace?.name || '';
      node('projectTargetSummary').textContent = t('project.targetSummary', { missing: preview.counts.missing, existing: preview.counts.existing, unsupported: preview.counts.unsupported || 0 });
      node('projectRestoreMode').value = preview.mode || 'new-window';
    }
    function renderPreview() {
      const state = controller.state;
      clearError();
      node('projectPreview').hidden = false;
      node('projectResult').hidden = true;
      const selecting = state.mode !== 'resume';
      node('projectSourceFields').hidden = !selecting;
      node('projectSelectionSection').hidden = !selecting;
      node('projectTarget').hidden = !state.targetPreview;
      node('projectSaveOnlyBtn').hidden = !['save', 'park'].includes(state.mode);
      node('projectDialogTitle').textContent = t(state.updateMode === 'replace' && state.mode !== 'switch' ? 'savedFlow.replace' : `project.dialog.${state.mode}`);
      node('projectDialogDescription').textContent = t(state.mode === 'switch' ? 'project.switchDescription' : state.mode === 'resume' ? 'project.resumeDescription' : 'project.saveDescription');
      node('projectExecuteBtn').textContent = t(state.mode === 'switch' ? 'project.saveAndSwitch' : state.mode === 'resume' ? 'project.openMissing' : 'project.saveAndPark');
      node('projectExecuteBtn').classList.toggle('project-button-warm', selecting);
      node('projectSaveOnlyBtn').classList.toggle('project-button-primary', state.mode === 'save');
      node('projectSourceSelect').innerHTML = `<option value="">${escape(t('project.newProject'))}</option>` + state.workspaces.filter(workspace => workspace.id !== state.targetPreview?.workspaceId).map(workspace => `<option value="${escape(workspace.id)}">${escape(workspace.name)}</option>`).join('');
      node('projectSourceSelect').value = state.sourceWorkspaceId || '';
      node('projectSourceSelect').disabled = state.updateMode === 'replace';
      node('projectNameInput').value = state.name || '';
      renderTarget();
      renderCandidates();
    }
    function renderResult() {
      const result = controller.state.result;
      if (!result) return;
      clearError();
      node('projectPreview').hidden = true;
      node('projectResult').hidden = false;
      const status = ['complete', 'partial', 'failed'].includes(result.status) ? result.status : 'failed';
      node('projectViewBtn').hidden = !result.workspace;
      node('projectResult').dataset.status = status;
      node('projectDialogTitle').textContent = t(`project.result.${status}`);
      node('projectDialogDescription').textContent = result.workspace?.name || '';
      const counts = result.counts || {};
      node('projectResultSummary').textContent = t('project.resultSummary', { saved: counts.saved || 0, opened: counts.opened || 0, reused: counts.reused || 0, closed: counts.closed || 0, kept: counts.kept || 0, failed: counts.failed || result.failures?.length || 0 });
      node('projectResultSafety').textContent = controller.state.mode === 'switch' && status !== 'complete' && !counts.closed ? t('project.sourceKept') : t('project.resultSafety');
      node('projectResultFailures').innerHTML = (result.failures || []).map(failure => `<li><span>${escape(failure.title || failure.url || failure.group?.title || t('project.untitledPage'))}</span><small>${escape(t(projectFailureMessageKey(failure.code)))}</small></li>`).join('');
      node('projectResultFailures').hidden = !result.failures?.length;
      node('projectRetryBtn').hidden = !result.retryPreview;
      node('projectUndoBtn').hidden = !result.operation || result.operation.status === 'undone' || (!counts.closed && !result.undoAttempt);
      syncButtons();
    }
    async function begin(mode, workspaceId, options = {}) {
      if (busyOpening || controller.state.busy) return;
      busyOpening = true;
      returnFocus = doc.activeElement;
      const content = node('dashboardContent');
      returnContext = { view: globalScope.tabOutDashboardNavigation?.currentView || 'projects', x: content?.scrollLeft || 0, y: content?.scrollTop || 0 };
      returnMenuSummary = returnFocus?.closest?.('details')?.querySelector('summary');
      returnFocus?.closest?.('details')?.removeAttribute('open');
      const projectButton = returnFocus?.closest?.('[data-project-action][data-project-id]');
      returnProjectId = projectButton?.dataset.projectId;
      returnAction = projectButton?.dataset.projectAction;
      try {
        const selectedIds = [...doc.querySelectorAll('#openTabsMissions .selected-for-workspace')].map(chip => Number(chip.dataset.tabId)).filter(Number.isInteger);
        await controller.begin(mode, { workspaceId, tabIds: options.tabIds ?? selectedIds, windowId: options.windowId, acrossWindows: options.acrossWindows, updateMode: options.updateMode });
        // Ignore a slow preview if the user deliberately navigated away while it loaded.
        if (globalScope.tabOutDashboardNavigation?.currentView && globalScope.tabOutDashboardNavigation.currentView !== returnContext.view) { controller.close(); return; }
        node('projectTabFilter').value = '';
        renderPreview();
        node('projectCandidates').scrollTop = 0;
        overlay.querySelector('.project-dialog').scrollTop = 0;
        overlay.style.display = 'flex';
        queueMicrotask(() => focusVisibleProjectAction([mode === 'resume' ? node('projectExecuteBtn') : node('projectNameInput')]));
      } catch (error) {
        const known = ['workspace_limit', 'invalid_window', 'group_metadata_unavailable'];
        setMainStatus(`project.error.${known.includes(error.code) ? error.code : 'unknown'}`);
      } finally { busyOpening = false; }
    }
    function close() {
      if (controller.state.busy || undoing) return;
      controller.close();
      overlay.style.display = 'none';
      if (returnContext) {
        if (globalScope.tabOutDashboardNavigation?.currentView !== returnContext.view) globalScope.tabOutDashboardNavigation?.show(returnContext.view);
        node('dashboardContent')?.scrollTo?.({ left: returnContext.x, top: returnContext.y, behavior: 'instant' });
      }
      const replacementSummary = [...node('projectList').querySelectorAll('[data-project-id]')].find(card => card.dataset.projectId === returnProjectId)?.querySelector('summary');
      const previousFocus = focusVisibleProjectAction([returnFocus, returnMenuSummary, replacementSummary]);
      restoreProjectFocus({ previous: previousFocus, projectId: returnProjectId, action: returnAction,
        buttons: [...node('projectList').querySelectorAll('[data-project-action][data-project-id]')], fallback: returnContext?.view === 'tabs' ? node('tabsSelectionSaveBtn') : detailId ? node('projectDetailBackBtn') : node('projectSaveBtn'),
        fallbacks: returnContext?.view === 'tabs' ? [node('dashboardNavTabs'), node('dashboardContent')] : [] });
    }
    function focusResult() {
      if (overlay.style.display === 'none' || controller.state.step !== 'result' || controller.state.busy || undoing) return;
      focusVisibleProjectAction([node('projectRetryBtn'), node('projectUndoBtn'), node('projectViewBtn'), node('projectDoneBtn')]);
    }
    async function afterResult(result) {
      if (result.operation && result.counts?.closed > 0) onOperation?.(result.operation);
      renderResult();
      await onRefresh?.();
      await refresh();
    }
    async function execute(action) {
      const promise = controller.execute(action);
      syncButtons();
      try { await afterResult(await promise); }
      catch (error) { showError(error); }
      finally { syncButtons(); focusResult(); }
    }
    async function updateSelection(ids, redraw = false) {
      clearError();
      const promise = controller.setSelection(ids);
      syncButtons();
      try { await promise; if (redraw) renderCandidates(); else renderSelectionSummary(); }
      catch (error) { showError(error); }
      finally { syncButtons(); }
    }

    node('projectSaveBtn').addEventListener('click', () => begin('save'));
    node('projectList').addEventListener('click', event => {
      const button = event.target.closest('[data-project-action]');
      if (!button) return;
      const id = button.dataset.projectId;
      button.closest('details')?.removeAttribute('open');
      if (button.dataset.projectAction === 'detail') { openDetail(id); return; }
      if (button.dataset.projectAction === 'rename') {
        workspaceRepository.get(id).then(async workspace => {
          if (!workspace) return;
          const name = globalScope.prompt(t('project.renamePrompt'), workspace.name);
          if (name === null) return;
          await workspaceRepository.update(id, { name: name.trim() || workspace.name });
          await refresh();
        }).catch(() => setMainStatus('project.error.unknown'));
      } else if (button.dataset.projectAction === 'delete') {
        onDelete?.(id).then(refresh).catch(() => setMainStatus('project.error.unknown'));
      } else if (['update', 'replace'].includes(button.dataset.projectAction)) begin('save', id, { tabIds: [], acrossWindows: true, updateMode: button.dataset.projectAction === 'replace' ? 'replace' : 'append' });
      else begin(button.dataset.projectAction, id);
    });
    node('projectDetailBackBtn').addEventListener('click', () => {
      const previous = detailId; detailId = null; detailVisibility();
      [...node('projectList').querySelectorAll('[data-project-action="detail"]')].find(button => button.dataset.projectId === previous)?.focus({ preventScroll: true });
    });
    node('projectDetailAddBtn').addEventListener('click', () => begin('save', detailId, { tabIds: [], acrossWindows: true, updateMode: 'append' }));
    node('projectDetailReplaceBtn').addEventListener('click', () => begin('save', detailId, { tabIds: [], acrossWindows: true, updateMode: 'replace' }));
    node('projectDetailResumeBtn').addEventListener('click', () => begin('resume', detailId));
    node('projectDetailEntries').addEventListener('click', async event => {
      const button = event.target.closest('[data-detail-action]');
      if (!button || detailBusy || !detailWorkspace) return;
      const url = normalizeUrl(button.dataset.entryUrl);
      if (!url) return;
      detailBusy = true; button.disabled = true;
      setDetailStatus(null);
      try {
        if (button.dataset.detailAction === 'remove') {
          if (detailWorkspace.entries.length <= 1) { setDetailStatus('savedFlow.lastPage'); return; }
          if (!globalScope.confirm(t('savedFlow.removeConfirm'))) return;
          await service.removeSavedEntry({ workspaceId: detailId, url, expectedFingerprint: service.projectFingerprint(detailWorkspace) });
          setDetailStatus('savedFlow.removed');
          await refresh();
        } else {
          const existing = (await chromeApi.tabs.query({})).find(tab => !tab.incognito && normalizeUrl(tab.pendingUrl || tab.url) === url);
          if (existing) { await chromeApi.tabs.update(existing.id, { active: true }); await chromeApi.windows.update(existing.windowId, { focused: true }); }
          else await chromeApi.tabs.create({ url, active: true });
          await renderDetail();
        }
      } catch (error) { setDetailStatus(error.code === 'empty_selection' ? 'savedFlow.lastPage' : error.code === 'preview_stale' ? 'project.error.preview_stale' : 'project.error.unknown'); }
      finally { detailBusy = false; if (button.isConnected) button.disabled = false; }
    });
    node('projectSourceSelect').addEventListener('change', async () => {
      clearError();
      const promise = controller.setSource(node('projectSourceSelect').value);
      syncButtons();
      try { await promise; node('projectNameInput').value = controller.state.name; renderCandidates(); }
      catch (error) { showError(error); }
      finally { syncButtons(); }
    });
    node('projectNameInput').addEventListener('input', () => { controller.setName(node('projectNameInput').value); syncButtons(); });
    node('projectTabFilter').addEventListener('input', renderCandidates);
    node('projectCandidates').addEventListener('change', event => {
      const input = event.target.closest('input[data-tab-id]');
      if (!input) return;
      const ids = new Set(controller.state.preview.tabIds);
      const id = Number(input.dataset.tabId);
      if (input.checked) ids.add(id); else ids.delete(id);
      updateSelection([...ids]);
    });
    node('projectSelectAllBtn').addEventListener('click', () => updateSelection(selectFilteredProjectTabIds(controller.state.preview.candidates, controller.state.preview.tabIds, node('projectTabFilter').value), true));
    node('projectClearBtn').addEventListener('click', () => updateSelection([], true));
    node('projectRestoreMode').addEventListener('change', async () => {
      clearError();
      const promise = controller.setRestoreMode(node('projectRestoreMode').value);
      syncButtons();
      try { await promise; renderTarget(); if (controller.state.mode === 'switch') renderCandidates(); }
      catch (error) { renderTarget(); if (controller.state.mode === 'switch') renderCandidates(); showError(error); }
      finally { syncButtons(); }
    });
    node('projectSaveOnlyBtn').addEventListener('click', () => execute('save'));
    node('projectExecuteBtn').addEventListener('click', () => execute(['save', 'park'].includes(controller.state.mode) ? 'park' : undefined));
    node('projectCancelBtn').addEventListener('click', close);
    node('projectDialogCloseBtn').addEventListener('click', close);
    node('projectDoneBtn').addEventListener('click', close);
    node('projectViewBtn').addEventListener('click', async () => {
      const id = controller.state.result?.workspace?.id;
      close(); globalScope.tabOutDashboardNavigation?.show('projects'); await refresh();
      await openDetail(id);

    });
    node('projectRefreshPreviewBtn').addEventListener('click', async () => {
      try { await controller.refreshPreview(); renderPreview(); }
      catch (error) { showError(error); }
    });
    node('projectRetryBtn').addEventListener('click', async () => {
      const promise = controller.retry(); syncButtons();
      try { await afterResult(await promise); } catch (error) { showError(error); }
      finally { syncButtons(); focusResult(); }
    });
    node('projectUndoBtn').addEventListener('click', async () => {
      const operationId = controller.state.result?.operation?.id;
      if (!operationId || undoing) return;
      undoing = true; syncButtons();
      try {
        const operation = await undoOperation(operationId);
        const failures = operation.undoResult?.failed || [];
        controller.state.result = { status: failures.length ? 'partial' : 'complete', workspace: controller.state.result.workspace, operation, undoAttempt: true,
          counts: { opened: operation.undoResult?.succeeded || 0, failed: failures.length }, failures };
        renderResult(); await refresh();
      } catch (error) { showError(error); }
      finally { undoing = false; syncButtons(); focusResult(); }
    });
    node('projectBackupBtn').addEventListener('click', async () => {
      node('projectBackupBtn').disabled = true;
      try { await exportBackup(); await refresh(); }
      catch { setMainStatus('project.backupFailed'); }
      finally { node('projectBackupBtn').disabled = false; }
    });
    overlay.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const controls = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')].filter(control => control.offsetParent !== null);
      if (!controls.length) { event.preventDefault(); return; }
      if (event.shiftKey && doc.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && doc.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }, true);
    node('projectNameInput').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && !node('projectSaveOnlyBtn').disabled && !node('projectSaveOnlyBtn').hidden) { event.preventDefault(); execute('save'); }
    });
    chromeApi.storage.onChanged.addListener(changes => {
      if (!changes.workspacesV2 && !changes.projectBackupStateV1 && !changes.tabGroups && !changes.deferred) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refresh().catch(() => {}), 100);
    });
    globalScope.TabOutI18n?.onChange(async () => {
      if (mainStatusCopy) node('projectMainStatus').textContent = t(mainStatusCopy.key);
      await refresh();
      if (overlay.style.display !== 'none') {
        const error = lastError;
        const candidateScroll = node('projectCandidates').scrollTop;
        const dialogScroll = overlay.querySelector('.project-dialog').scrollTop;
        if (controller.state.result) renderResult();
        else if (controller.state.preview || controller.state.targetPreview) renderPreview();
        if (error) showError(error);
        node('projectCandidates').scrollTop = candidateScroll;
        overlay.querySelector('.project-dialog').scrollTop = dialogScroll;
      }
    });
    localize();
    return { refresh, begin, controller };
  }

  const api = { captureProjectMenuFocus, restoreProjectMenuFocus, captureOpenProjectMenus, restoreOpenProjectMenus, createProjectWorkbench, createProjectWorkbenchController, filterProjectCandidates, selectWorkspaceTabIds, selectFilteredProjectTabIds, projectFailureMessageKey, projectSelectionImpact, focusVisibleProjectAction, restoreProjectFocus, projectWindowNumbers, projectWindowScope };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
