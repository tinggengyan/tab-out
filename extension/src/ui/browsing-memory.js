(function initBrowsingMemoryUI(globalScope) {
  'use strict';

  const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
  const fail = code => Object.assign(new Error(code), { code });

  function memoryModelOrigin(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw fail('invalid_base_url'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('invalid_base_url');
    return `${url.origin}/*`;
  }

  function memorySettingsPayload(form, keyChanged = false) {
    const payload = {
      baseUrl: String(form.baseUrl || '').trim(), model: String(form.model || '').trim(),
      retentionDays: Number(form.retentionDays || 90),
      exclusions: Array.isArray(form.exclusions) ? form.exclusions : String(form.exclusions || '').split(/[\n,，]+/).map(item => item.trim()).filter(Boolean),
    };
    if (payload.baseUrl) memoryModelOrigin(payload.baseUrl);
    if (keyChanged) payload.apiKey = String(form.apiKey || '');
    return payload;
  }

  function memorySnippetParts(item) {
    const parts = Array.isArray(item.snippetParts) ? item.snippetParts : [];
    if (parts.length && parts.every(part => typeof part.text === 'string') && parts.map(part => part.text).join('') === item.snippet) return parts;
    return item.snippet ? [{ text: String(item.snippet), match: false }] : [];
  }
  function renderMemorySnippetHTML(item, escape) {
    return memorySnippetParts(item).map(part => part.match ? `<mark>${escape(part.text)}</mark>` : escape(part.text)).join('');
  }

  function createBrowsingMemoryController({ send, requestPermissions = async () => false, createRequestId }) {
    if (typeof send !== 'function') throw new TypeError('A browsing memory bridge is required');
    const state = {
      settings: { recording: false, retentionDays: 90, exclusions: [], baseUrl: '', model: '', apiKeyConfigured: false },
      stats: { total: 0, withContent: 0, metadataOnly: 0, bytes: 0 }, permissions: {},
      query: '', days: 30, useAI: false, includeContent: false,
      results: [], selected: new Set(), summary: null, mode: 'local', warnings: [], scanned: 0,
      searched: false, searching: false, busy: false, pendingImport: null, aiCandidates: 0,
    };
    let generation = 0;
    let summaryRevision = 0;
    let requestSequence = 0;
    let activeSearch = null;
    function cancelActiveSearch() {
      if (!activeSearch) return;
      const { requestId } = activeSearch;
      activeSearch = null;
      try { Promise.resolve(send('cancel', { requestId })).catch(() => {}); } catch { /* this request is locally invalidated even if the worker disconnected */ }
    }
    function invalidate() {
      cancelActiveSearch();
      generation++;
      state.results = []; state.selected.clear(); state.summary = null;
      state.warnings = []; state.searching = false; state.searched = false; state.aiCandidates = 0;
    }
    function selectedIds(contentOnly = false) {
      return state.results.filter(item => state.selected.has(item.id) && (!contentOnly || item.coverage === 'content')).map(item => item.id);
    }
    async function refresh() {
      const value = await send('status');
      if (value?.settings) state.settings = { ...state.settings, ...value.settings };
      if (value?.stats) state.stats = value.stats;
      if (value?.permissions) state.permissions = value.permissions;
      return value;
    }
    async function saveSettings(form, keyChanged = false) {
      const payload = memorySettingsPayload(form, keyChanged);
      // Keep this request before the first await: Chrome requires a direct user gesture.
      const permission = payload.baseUrl ? requestPermissions({ origins: [memoryModelOrigin(payload.baseUrl)] }) : Promise.resolve(true);
      if (!await permission) throw fail('permission_denied');
      const value = await send('saveSettings', payload);
      if (value?.settings || value?.baseUrl !== undefined) state.settings = { ...state.settings, ...(value.settings || value) };
      return value;
    }
    return {
      state, refresh, saveSettings, invalidate, selectedIds,
      async search(options = {}) {
        const query = String(options.query || '').trim();
        if (!query) throw fail('query_required');
        invalidate();
        const ticket = generation;
        const requestId = createRequestId ? createRequestId() : (globalScope.crypto?.randomUUID?.() || `memory-${Date.now()}-${++requestSequence}`);
        activeSearch = { requestId, ticket };
        Object.assign(state, { query, days: Number(options.days || 30), useAI: Boolean(options.useAI), includeContent: Boolean(options.includeContent), searching: true, searched: true });
        try {
          const value = await send('search', { query, days: state.days, limit: 30, useAI: state.useAI, includeContent: state.includeContent, requestId });
          if (ticket !== generation) return { stale: true };
          state.results = Array.isArray(value?.results) ? value.results : [];
          state.mode = value?.mode || 'local'; state.warnings = value?.warnings || []; state.scanned = value?.scanned || 0; state.aiCandidates = value?.aiCandidates || 0;
          return value;
        } catch (error) {
          if (ticket !== generation) return { stale: true };
          throw error;
        } finally {
          if (activeSearch?.ticket === ticket) activeSearch = null;
          if (ticket === generation) state.searching = false;
        }
      },
      setSelected(id, selected) {
        if (!state.results.some(item => item.id === id)) return;
        if (selected) state.selected.add(id); else state.selected.delete(id);
        state.summary = null; summaryRevision++;
      },
      selectAll() { state.results.forEach(item => state.selected.add(item.id)); state.summary = null; summaryRevision++; },
      setSearchMode(enabled) {
        const useAI = Boolean(enabled);
        if (!useAI && state.useAI && activeSearch) invalidate();
        state.useAI = useAI;
        if (!useAI) {
          state.includeContent = false; state.summary = null; summaryRevision++;
        }
      },
      setContentConsent(enabled) {
        if (!enabled && state.includeContent) {
          if (activeSearch) invalidate();
          else generation++;
        }
        state.includeContent = Boolean(enabled); state.summary = null; summaryRevision++;
      },
      async summarize() {
        if (!state.includeContent) throw fail('content_consent_required');
        const ids = selectedIds(true);
        if (!ids.length) throw fail('content_required');
        if (ids.length > 8) throw fail('too_many_summary_sources');
        const ticket = generation;
        const summaryTicket = summaryRevision;
        const value = await send('summarize', { query: state.query, ids, includeContent: true });
        if (ticket !== generation || summaryTicket !== summaryRevision || !state.includeContent) return { stale: true };
        state.summary = value;
        return value;
      },
      async runSelected(action, name) {
        const ids = selectedIds();
        if (!ids.length) throw fail('selection_required');
        return send(action, { ids, ...(name ? { name } : {}) });
      },
      async removeSelected() {
        const ids = selectedIds();
        if (!ids.length) throw fail('selection_required');
        invalidate();
        const value = await send('remove', { ids });
        await refresh();
        return value;
      },
      async clear() {
        invalidate();
        state.pendingImport = null; state.includeContent = false; summaryRevision++;
        const value = await send('clear');
        await refresh();
        return value;
      },
      async setRecording(enabled) {
        const permission = enabled ? requestPermissions({ permissions: ['scripting'], origins: ['http://*/*', 'https://*/*'] }) : Promise.resolve(true);
        if (!await permission) throw fail('permission_denied');
        const value = await send('setRecording', { enabled });
        await refresh();
        return value;
      },
      async importHistory() {
        const permission = requestPermissions({ permissions: ['history'] });
        if (!await permission) throw fail('permission_denied');
        const value = await send('importHistory', { days: 30 });
        await refresh();
        return value;
      },
      async testConnection(form, keyChanged) {
        await saveSettings(form, keyChanged);
        return send('testConnection');
      },
      async exportBackup() { return send('export'); },
      async previewImport(backup) {
        const value = await send('import', { backup, preview: true });
        state.pendingImport = { backup, preview: value };
        return value;
      },
      cancelImport() { state.pendingImport = null; },
      async confirmImport() {
        if (!state.pendingImport) throw fail('import_required');
        const { backup } = state.pendingImport;
        invalidate();
        const value = await send('import', { backup, preview: false });
        state.pendingImport = null;
        await refresh();
        return value;
      },
    };
  }

  function isVisibleMemoryControl(control) {
    // Native top-layer dialogs and fixed elements may have no offsetParent.
    return Boolean(control?.isConnected && !control.disabled && !control.closest('[hidden]') && control.getClientRects().length);
  }

  function focusVisibleMemoryControl(control) {
    if (!isVisibleMemoryControl(control)) return false;
    control.focus({ preventScroll: true });
    return true;
  }

  function handleMemoryConfirmationKeydown(event, { dialog, activeElement }) {
    event.stopPropagation();
    // Escape keeps its native dialog cancel event and existing close handler.
    if (event.key !== 'Tab' || event.isComposing || event.keyCode === 229) return;
    const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(isVisibleMemoryControl);
    const first = controls[0]; const last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (!controls.includes(activeElement) || (event.shiftKey ? activeElement === first : activeElement === last)) {
      event.preventDefault();
      focusVisibleMemoryControl(event.shiftKey ? last : first);
    }
  }

  function initBrowsingMemory() {
    const doc = globalScope.document;
    if (!doc?.getElementById('memoryWorkbench') || !globalScope.chrome?.runtime) return null;
    const node = id => doc.getElementById(id);
    const tr = (key, values) => typeof globalScope.t === 'function' ? globalScope.t(key, values) : key;
    const text = (id, key, values) => { node(id).textContent = tr(key, values); };
    const controller = createBrowsingMemoryController({
      async send(action, payload = {}) {
        const response = await globalScope.chrome.runtime.sendMessage({ type: 'browsing-memory', action, payload });
        if (!response?.ok) throw fail(response?.error?.code || 'unavailable');
        return response.data;
      },
      requestPermissions: spec => globalScope.chrome.permissions.request(spec),
    });
    const state = controller.state;
    let keyChanged = false;
    let confirmation = null;
    let returnFocus = null;

    const copy = {
      memoryEyebrow: 'memory.eyebrow', memoryHeading: 'memory.heading', memoryIntro: 'memory.intro',
      memorySearchBtn: 'memory.search', memoryLocalOption: 'memory.local', memoryAIOption: 'memory.ai',
      memoryDays7: 'memory.days7', memoryDays30: 'memory.days30', memoryDays90: 'memory.days90',
      memoryQueryLabel: 'memory.queryLabel', memoryTimeLabel: 'memory.timeLabel', memoryModeLabel: 'memory.modeLabel',
      memoryIncludeContentLabel: 'memory.includeContent', memoryPrivacyHint: 'memory.privacyHint',
      memorySettingsToggle: 'memory.settings', memoryRecordingTitle: 'memory.recordingTitle', memoryCaptureHint: 'memory.captureHint',
      memoryHistoryBtn: 'memory.importHistory', memoryHistoryHint: 'memory.historyHint',
      memoryModelTitle: 'memory.modelTitle', memoryBaseUrlLabel: 'memory.baseUrl', memoryModelLabel: 'memory.model',
      memoryApiKeyLabel: 'memory.apiKey', memorySaveSettingsBtn: 'memory.saveSettings', memoryTestBtn: 'memory.test',
      memoryRetentionLabel: 'memory.retention', memoryRetention30: 'memory.days30', memoryRetention90: 'memory.days90', memoryRetention180: 'memory.days180',
      memoryExclusionsLabel: 'memory.exclusions', memoryExclusionsHint: 'memory.exclusionsHint',
      memoryDataTitle: 'memory.dataTitle', memoryExportBtn: 'memory.export', memoryImportLabel: 'memory.import',
      memoryBackupHint: 'memory.backupHint', memoryClearBtn: 'memory.clear', memorySelectAllBtn: 'memory.selectAll',
      memoryOpenBtn: 'memory.open', memorySaveBtn: 'memory.save', memorySummaryBtn: 'memory.summarize', memoryDeleteBtn: 'memory.delete',
      memoryEmptyTitle: 'memory.emptyTitle', memoryEmptyText: 'memory.emptyText', memorySummaryTitle: 'memory.summaryTitle', memorySummaryHint: 'memory.summaryHint',
      memoryImportConfirmBtn: 'memory.confirmImport', memoryImportCancelBtn: 'memory.cancel', memoryConfirmNo: 'memory.cancel',
    };
    function localize() {
      Object.entries(copy).forEach(([id, key]) => text(id, key));
      node('memoryQuery').placeholder = tr('memory.queryPlaceholder');
      node('memoryBaseUrl').placeholder = 'https://your-model.example/v1';
      node('memoryModel').placeholder = tr('memory.modelPlaceholder');
      node('memoryApiKey').placeholder = tr('memory.keyPlaceholder');
      node('memoryResults').setAttribute('aria-label', tr('memory.resultsLabel'));
      node('memoryDays').setAttribute('aria-label', tr('memory.timeLabel'));
      node('memoryUseAI').setAttribute('aria-label', tr('memory.modeLabel'));
      text('memoryRefreshBtn', 'memory.refresh');
      if (state.pendingImport) {
        const { backup, preview } = state.pendingImport;
        text('memoryImportSummary', 'memory.importSummary', { n: preview?.total ?? preview?.count ?? preview?.records ?? backup?.records?.length ?? 0, added: preview?.added ?? '—', updated: preview?.updated ?? '—' });
      }
      if (confirmationCopy) {
        text('memoryConfirmTitle', confirmationCopy.kind === 'clear' ? 'memory.clearTitle' : 'memory.deleteTitle');
        text('memoryConfirmYes', confirmationCopy.kind === 'clear' ? 'memory.clear' : 'memory.delete');
        if (confirmationCopy.description) node('memoryConfirmDescription').textContent = globalScope.TabOutI18n.translateDescriptor(confirmationCopy.description);
      }
    }
    let statusCopy = null;
    let confirmationCopy = null;
    localize();

    function report(message, error = false) {
      statusCopy = globalScope.TabOutI18n?.describeTranslation(message);
      node('memoryStatus').textContent = message;
      node('memoryStatus').classList.toggle('memory-error', error);
    }
    function errorText(error) {
      const code = error?.code || 'generic';
      const key = `memory.error.${code}`;
      const value = tr(key);
      if (value === key && /^model_http_\d+$/.test(code)) return tr('memory.error.model_http', { status: code.slice(11) });
      return value === key ? tr('memory.error.generic') : value;
    }
    function element(tag, className, value) {
      const el = doc.createElement(tag);
      if (className) el.className = className;
      if (value !== undefined) el.textContent = value;
      return el;
    }
    function readableDate(value) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString(globalScope.TabOutI18n?.locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : tr('memory.unknownDate');
    }
    function safeURL(value) {
      try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
    }
    function syncMode() {
      const ai = node('memoryUseAI').value === 'ai';
      node('memoryContentConsent').hidden = !ai;
      node('memoryPrivacyHint').hidden = !ai;
      node('memorySummaryBtn').hidden = !ai;
    }
    function syncActions() {
      syncMode();
      const selected = controller.selectedIds();
      const busy = state.busy || state.searching;
      node('memorySearchBtn').disabled = busy;
      node('memoryQuery').setAttribute('aria-busy', String(state.searching));
      for (const id of ['memoryOpenBtn', 'memorySaveBtn', 'memoryDeleteBtn']) node(id).disabled = busy || !selected.length;
      node('memorySummaryBtn').disabled = busy || !state.includeContent || !controller.selectedIds(true).length;
      node('memorySelectAllBtn').disabled = busy || !state.results.length;
      text('memorySelection', 'memory.selected', { n: selected.length });
      const settingsBusy = state.busy;
      for (const id of ['memoryRecordingBtn', 'memoryHistoryBtn', 'memorySaveSettingsBtn', 'memoryTestBtn', 'memoryExportBtn', 'memoryClearBtn', 'memoryImportConfirmBtn']) node(id).disabled = settingsBusy;
      for (const id of ['memoryBaseUrl', 'memoryModel', 'memoryApiKey', 'memoryRetention', 'memoryExclusions', 'memoryImportFile']) node(id).disabled = settingsBusy;
      node('memoryWorkbench').setAttribute('aria-busy', String(busy));
    }
    function renderStatus(updateForm = false) {
      const stats = state.stats || {};
      text('memoryStats', 'memory.stats', { total: stats.total || 0, content: stats.withContent || 0, metadata: stats.metadataOnly || 0 });
      text('memoryCapacity', 'memory.capacity', { days: state.settings.retentionDays || 90, size: ((stats.bytes || 0) / 1024 / 1024).toFixed(1) });
      const active = Boolean(state.settings.recording && state.permissions.capture);
      text('memoryRecordingState', active ? 'memory.recordingOn' : state.settings.recording ? 'memory.recordingPermissionLost' : 'memory.recordingOff');
      node('memoryRecordingState').classList.toggle('memory-recording-on', active);
      text('memoryRecordingBtn', state.settings.recording ? 'memory.pauseRecording' : 'memory.enableRecording');
      text('memoryKeyState', state.settings.apiKeyConfigured ? 'memory.keyConfigured' : 'memory.keyNotConfigured');
      node('memoryImportPreview').hidden = !state.pendingImport;
      if (updateForm) {
        node('memoryBaseUrl').value = state.settings.baseUrl || '';
        node('memoryModel').value = state.settings.model || '';
        node('memoryRetention').value = String(state.settings.retentionDays || 90);
        node('memoryExclusions').value = (state.settings.exclusions || []).join('\n');
        node('memoryApiKey').value = ''; keyChanged = false;
      }
      syncActions();
    }
    function renderSummary() {
      const area = node('memorySummary');
      const list = node('memorySummaryList');
      list.replaceChildren();
      const summary = state.summary;
      area.hidden = !summary?.items?.length;
      if (area.hidden) return;
      const sources = new Map((summary.sources || []).map(source => [source.id, source]));
      for (const item of summary.items) {
        const validSources = (item.sourceIds || []).map(id => sources.get(id)).filter(source => source && safeURL(source.url));
        if (!validSources.length) continue;
        const row = element('li', 'memory-summary-item');
        row.append(element('p', '', item.text));
        if (item.quote) row.append(element('blockquote', '', item.quote));
        const links = element('div', 'memory-source-links');
        validSources.forEach(source => {
          const anchor = element('a', '', source.title || source.url); anchor.href = safeURL(source.url); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; links.append(anchor);
        });
        row.append(links); list.append(row);
      }
      area.hidden = list.children.length === 0;
    }
    function renderResults() {
      const list = node('memoryResults');
      list.replaceChildren();
      for (const item of state.results) {
        const url = safeURL(item.url);
        if (!url) continue;
        const row = element('article', 'memory-result'); row.dataset.memoryId = item.id;
        const checkLabel = element('label', 'memory-result-check');
        const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.memoryId = item.id; checkbox.checked = state.selected.has(item.id); checkbox.setAttribute('aria-label', tr('memory.selectResult', { title: item.title || url }));
        checkbox.addEventListener('change', () => { controller.setSelected(item.id, checkbox.checked); renderSummary(); syncActions(); });
        checkLabel.append(checkbox); row.append(checkLabel);
        const body = element('div', 'memory-result-body');
        const title = element('a', 'memory-result-title', item.title || url); title.href = url; title.target = '_blank'; title.rel = 'noopener noreferrer';
        title.addEventListener('click', event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          perform(async () => {
            const result = await globalScope.chrome.runtime.sendMessage({ type: 'browsing-memory', action: 'open', payload: { ids: [item.id] } });
            if (!result?.ok) throw fail(result?.error?.code || 'generic');
          });
        });
        body.append(title);
        const meta = element('div', 'memory-result-meta');
        meta.append(element('span', 'memory-domain', new URL(url).host), element('span', '', tr('memory.visited', { date: readableDate(item.visitedAt) })), element('span', `memory-badge ${item.coverage === 'content' ? 'memory-badge-content' : ''}`, tr(item.coverage === 'content' ? 'memory.content' : 'memory.metadata')));
        body.append(meta);
        if (item.snippet) {
          const snippet = element('p', 'memory-result-snippet');
          memorySnippetParts(item).forEach(part => snippet.append(element(part.match ? 'mark' : 'span', '', part.text)));
          body.append(snippet);
        }
        const fields = (item.matchedFields || []).filter(field => ['title', 'url', 'text'].includes(field));
        if (fields.length) body.append(element('p', 'memory-result-reason', tr('memory.matchedFields', { fields: fields.map(field => tr(`memory.field.${field}`)).join(' · ') })));
        else if (item.reason) body.append(element('p', 'memory-result-reason', tr('memory.matchReason', { reason: item.reason })));
        if (item.capturedAt && item.coverage === 'content') body.append(element('p', 'memory-captured-date', tr('memory.captured', { date: readableDate(item.capturedAt) })));
        if (item.truncated) body.append(element('p', 'memory-captured-date', tr('memory.truncated')));
        row.append(body); list.append(row);
      }
      node('memoryEmpty').hidden = state.results.length > 0 || state.searching;
      const hasRecords = state.stats.total > 0;
      text('memoryEmptyTitle', state.searched ? 'memory.noResults' : hasRecords ? 'memory.readyTitle' : 'memory.emptyTitle');
      text('memoryEmptyText', state.searched ? 'memory.noResultsHint' : hasRecords ? (state.settings.recording ? 'memory.readyText' : 'memory.pausedReadyText') : 'memory.emptyText', { n: state.stats.total || 0 });
      node('memoryResultsToolbar').hidden = !state.results.length;
      text('memoryResultCount', 'memory.resultCount', { n: state.results.length, scanned: state.scanned, mode: tr(`memory.mode.${state.mode}`) });
      node('memoryCoverageHint').hidden = !state.aiCandidates;
      text('memoryCoverageHint', 'memory.aiCoverage', { n: state.aiCandidates });
      const warnings = node('memoryWarnings'); warnings.replaceChildren(); warnings.hidden = !state.warnings.length;
      state.warnings.forEach(code => warnings.append(element('li', '', errorText({ code }))));
      renderSummary(); syncActions();
    }
    async function refresh(updateForm = false) { await controller.refresh(); renderStatus(updateForm); renderResults(); }
    function form() {
      return { baseUrl: node('memoryBaseUrl').value, model: node('memoryModel').value, apiKey: node('memoryApiKey').value, retentionDays: node('memoryRetention').value, exclusions: node('memoryExclusions').value };
    }
    async function perform(action, successKey) {
      if (state.busy) return;
      const trigger = doc.activeElement;
      // Invoke immediately so nested permissions.request retains this click's user gesture.
      let pending;
      try { pending = action(); } catch (error) { report(errorText(error), true); return; }
      state.busy = true; renderStatus(); renderResults();
      try {
        const value = await pending;
        if (value?.stale) report(tr('memory.selectionChanged'));
        else if (successKey) report(tr(successKey));
        renderStatus(); renderResults();
        return value;
      } catch (error) { report(errorText(error), true); renderStatus(); renderResults(); }
      finally {
        state.busy = false; syncActions();
        if (doc.activeElement === doc.body) focusVisibleMemoryControl(trigger);
      }
    }
    async function search() {
      if (state.busy) return;
      const request = controller.search({ query: node('memoryQuery').value, days: Number(node('memoryDays').value), useAI: node('memoryUseAI').value === 'ai', includeContent: node('memoryUseAI').value === 'ai' && node('memoryIncludeContent').checked });
      report(tr('memory.searching')); renderResults();
      try {
        const result = await request;
        if (result?.stale) return;
        renderResults();
        report(tr('memory.searchComplete', { n: state.results.length }));
      } catch (error) { report(errorText(error), true); renderResults(); }
    }
    function closeConfirmation() {
      node('memoryConfirmDialog').close(); confirmation = null; confirmationCopy = null;
      focusVisibleMemoryControl(returnFocus);
      returnFocus = null;
    }
    function confirm(kind, action, description) {
      returnFocus = doc.activeElement; confirmation = action;
      confirmationCopy = { kind, description: globalScope.TabOutI18n?.describeTranslation(description) };
      text('memoryConfirmTitle', kind === 'clear' ? 'memory.clearTitle' : 'memory.deleteTitle');
      node('memoryConfirmDescription').textContent = description;
      text('memoryConfirmYes', kind === 'clear' ? 'memory.clear' : 'memory.delete');
      node('memoryConfirmDialog').showModal(); focusVisibleMemoryControl(node('memoryConfirmNo'));
    }

    node('memorySearchForm').addEventListener('submit', event => { event.preventDefault(); search(); });
    node('memoryUseAI').addEventListener('change', () => {
      const wasSearching = state.searching;
      const useAI = node('memoryUseAI').value === 'ai';
      controller.setSearchMode(useAI);
      if (!useAI) node('memoryIncludeContent').checked = false;
      if (wasSearching && !state.searching) report(tr('memory.searchCancelled'));
      syncMode(); renderResults();
    });
    node('memoryIncludeContent').addEventListener('change', () => {
      const wasSearching = state.searching;
      controller.setContentConsent(node('memoryIncludeContent').checked);
      if (wasSearching && !state.searching) report(tr('memory.searchCancelled'));
      renderResults();
    });
    node('memorySelectAllBtn').addEventListener('click', () => { controller.selectAll(); renderResults(); });
    node('memoryOpenBtn').addEventListener('click', () => perform(async () => {
      const result = await controller.runSelected('open');
      const failed = Array.isArray(result?.failed) ? result.failed.length : Number(result?.failed || 0);
      report(tr('memory.opened', { opened: result?.opened || 0, reused: result?.reused || 0, failed }));
    }));
    node('memorySaveBtn').addEventListener('click', () => perform(async () => {
      await controller.runSelected('save', tr('memory.collectionName', { date: new Date().toLocaleDateString(globalScope.TabOutI18n?.locale) }));
      await globalScope.tabOutProjectWorkbench?.refresh();
    }, 'memory.savedCollection'));
    node('memorySummaryBtn').addEventListener('click', () => perform(() => controller.summarize(), 'memory.summaryComplete'));
    node('memoryDeleteBtn').addEventListener('click', () => confirm('remove', () => perform(() => controller.removeSelected(), 'memory.deleted'), tr('memory.deleteDescription', { n: controller.selectedIds().length })));
    node('memoryClearBtn').addEventListener('click', () => confirm('clear', () => perform(() => { const pending = controller.clear(); node('memoryIncludeContent').checked = false; node('memoryImportFile').value = ''; return pending; }, 'memory.cleared'), tr('memory.clearDescription')));
    node('memoryConfirmNo').addEventListener('click', closeConfirmation);
    node('memoryConfirmYes').addEventListener('click', () => { const action = confirmation; closeConfirmation(); action?.(); });
    node('memoryConfirmDialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
    node('memoryConfirmDialog').addEventListener('keydown', event => handleMemoryConfirmationKeydown(event, { dialog: node('memoryConfirmDialog'), activeElement: doc.activeElement }));
    node('memoryRecordingBtn').addEventListener('click', () => perform(() => controller.setRecording(!state.settings.recording), state.settings.recording ? 'memory.paused' : 'memory.enabled'));
    node('memoryHistoryBtn').addEventListener('click', () => perform(async () => { const result = await controller.importHistory(); report(tr(result?.limited ? 'memory.historyLimited' : 'memory.historyImported')); return result; }));
    node('memoryApiKey').addEventListener('input', () => { keyChanged = true; });
    node('memorySaveSettingsBtn').addEventListener('click', () => perform(async () => { await controller.saveSettings(form(), keyChanged); await refresh(true); }, 'memory.settingsSaved'));
    node('memoryTestBtn').addEventListener('click', () => perform(async () => { const result = await controller.testConnection(form(), keyChanged); await refresh(true); return result; }, 'memory.connected'));
    node('memoryExportBtn').addEventListener('click', () => perform(async () => {
      const backup = await controller.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = doc.createElement('a'); anchor.href = url; anchor.download = 'tab-out-browsing-memory.json'; doc.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'memory.exported'));
    node('memoryImportFile').addEventListener('change', () => perform(async () => {
      const file = node('memoryImportFile').files[0]; if (!file) return;
      controller.cancelImport(); node('memoryImportPreview').hidden = true;
      if (file.size > MAX_IMPORT_BYTES) throw fail('file_too_large');
      let backup; try { backup = JSON.parse(await file.text()); } catch { throw fail('invalid_backup'); }
      const preview = await controller.previewImport(backup);
      const count = Array.isArray(backup?.records) ? backup.records.length : 0;
      text('memoryImportSummary', 'memory.importSummary', { n: preview?.total ?? preview?.count ?? preview?.records ?? count, added: preview?.added ?? '—', updated: preview?.updated ?? '—' });
      node('memoryImportPreview').hidden = false;
      focusVisibleMemoryControl(node('memoryImportConfirmBtn'));
    }));
    node('memoryImportConfirmBtn').addEventListener('click', () => perform(async () => { await controller.confirmImport(); node('memoryImportPreview').hidden = true; node('memoryImportFile').value = ''; }, 'memory.imported'));
    node('memoryImportCancelBtn').addEventListener('click', () => { controller.cancelImport(); node('memoryImportPreview').hidden = true; node('memoryImportFile').value = ''; });
    node('memoryRefreshBtn').addEventListener('click', () => perform(() => refresh(), 'memory.refreshed'));
    text('memoryRefreshBtn', 'memory.refresh');

    globalScope.TabOutI18n?.onChange(() => {
      const descriptor = statusCopy;
      localize(); renderStatus(); renderResults();
      if (descriptor) report(globalScope.TabOutI18n.translateDescriptor(descriptor), node('memoryStatus').classList.contains('memory-error'));
    });
    const api = { controller, refresh, search, renderResults, renderStatus, localize };
    globalScope.tabOutBrowsingMemory = api;
    renderStatus(); renderResults();
    refresh(true).catch(error => report(errorText(error), true));
    return api;
  }

  const api = { memorySnippetParts, renderMemorySnippetHTML, createBrowsingMemoryController, memoryModelOrigin, memorySettingsPayload, focusVisibleMemoryControl, handleMemoryConfirmationKeydown, initBrowsingMemory };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
  if (globalScope.document) {
    const initialize = async () => { await globalScope.TabOutI18n?.ready; initBrowsingMemory(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
