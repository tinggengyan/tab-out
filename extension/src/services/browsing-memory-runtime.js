(function initBrowsingMemoryRuntime(scope) {
  'use strict';
  const SETTINGS = 'browsingMemorySettingsV1';
  const SECRET = 'browsingMemorySecretV1';
  const DELETED = 'browsingMemoryDeletedV1';
  const SCRIPT_ID = 'tab-out-browsing-memory';
  const MATCHES = ['http://*/*', 'https://*/*'];
  const defaults = { recording: false, retentionDays: 90, exclusions: [], baseUrl: '', model: '' };
  const fail = code => Object.assign(new Error(code), { code });
  function safeMemoryURL(value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }
  function excludedMemoryURL(value, hosts) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return hosts.some(item => host === item || host.endsWith('.' + item));
    } catch { return true; }
  }
  function memoryModelOrigin(baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('invalid_base_url');
      return url.origin + '/*';
    } catch { throw fail('invalid_base_url'); }
  }
  function createBrowsingMemoryRuntime({ chromeApi, repository, modelClient, searchService, now = () => Date.now() }) {
    const core = scope.TabOutCore;
    const area = chromeApi.storage.local;
    let queue = Promise.resolve();
    let lastError = null;
    let captureGeneration = 0;
    const activeSearches = new Map();
    function cancelSearches(requestId) {
      for (const [id, controller] of activeSearches) {
        if (!requestId || requestId === id) { controller.abort(); activeSearches.delete(id); }
      }
      return { cancelled: true };
    }
    const serial = action => {
      const result = queue.then(action);
      queue = result.catch(() => {});
      return result;
    };
    async function settings() {
      const stored = await area.get(SETTINGS);
      return { ...defaults, ...(stored[SETTINGS] || {}) };
    }
    async function publicSettings() {
      const [value, secret] = await Promise.all([settings(), area.get(SECRET)]);
      return { ...value, apiKeyConfigured: Boolean(secret[SECRET]?.apiKey) };
    }
    async function contains(permission) {
      try { return await chromeApi.permissions.contains(permission); } catch { return false; }
    }
    async function modelConfig() {
      const value = await settings();
      if (!value.baseUrl || !value.model) throw fail('model_not_configured');
      if (!await contains({ origins: [memoryModelOrigin(value.baseUrl)] })) throw fail('model_permission_required');
      const secret = (await area.get(SECRET))[SECRET];
      return { baseUrl: value.baseUrl, model: value.model, apiKey: secret?.origin === new URL(value.baseUrl).origin ? secret.apiKey : '' };
    }
    async function stopLoadedScripts() {
      const tabs = await chromeApi.tabs.query({});
      await Promise.all(tabs.filter(tab => safeMemoryURL(tab.url)).map(tab => chromeApi.tabs.sendMessage(tab.id, { type: 'browsing-memory-stop' }).catch(() => {})));
    }
    async function refreshCapture({ inject = false } = {}) {
      captureGeneration++;
      const value = await settings();
      const allowed = value.recording && await contains({ permissions: ['scripting'], origins: MATCHES });
      if (chromeApi.scripting) {
        await chromeApi.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
        if (allowed) {
          await chromeApi.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: MATCHES,
            js: ['src/content/browsing-memory-content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
          if (inject) {
            const tabs = await chromeApi.tabs.query({});
            await Promise.all(tabs.filter(tab => !tab.incognito && safeMemoryURL(tab.url) && !excludedMemoryURL(tab.url, value.exclusions))
              .map(tab => chromeApi.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/browsing-memory-content.js'] }).catch(() => {})));
          }
        }
      }
      if (!allowed) {
        await stopLoadedScripts();
        if (value.recording) await area.set({ [SETTINGS]: { ...value, recording: false } });
      }
      return Boolean(allowed);
    }
    async function saveSettings(payload) {
      const current = await settings();
      const next = { ...current };
      if (payload.retentionDays !== undefined) {
        if (![30, 90, 180, 365].includes(Number(payload.retentionDays))) throw fail('invalid_retention');
        next.retentionDays = Number(payload.retentionDays);
      }
      if (payload.exclusions !== undefined) {
        if (!Array.isArray(payload.exclusions) || payload.exclusions.length > 200) throw fail('invalid_exclusions');
        next.exclusions = [...new Set(payload.exclusions.map(host => String(host).trim().toLowerCase()).filter(Boolean))];
        if (next.exclusions.some(host => !/^[a-z0-9\u0080-\uffff.-]+$/i.test(host) || host.length > 253)) throw fail('invalid_exclusions');
      }
      if (payload.baseUrl !== undefined) {
        next.baseUrl = String(payload.baseUrl).trim();
        if (next.baseUrl) memoryModelOrigin(next.baseUrl);
      }
      if (payload.model !== undefined) next.model = String(payload.model).trim().slice(0, 256);
      if (payload.apiKey !== undefined && (typeof payload.apiKey !== 'string' || payload.apiKey.length > 8192)) throw fail('invalid_api_key');
      const oldOrigin = current.baseUrl ? new URL(current.baseUrl).origin : '';
      const newOrigin = next.baseUrl ? new URL(next.baseUrl).origin : '';
      const update = { [SETTINGS]: next };
      if (payload.apiKey !== undefined) update[SECRET] = { origin: newOrigin, apiKey: payload.apiKey.trim() };
      else if (oldOrigin !== newOrigin) update[SECRET] = { origin: newOrigin, apiKey: '' };
      await area.set(update);
      await repository.prune({ retentionDays: next.retentionDays, maxRecords: 5000, maxBytes: 32 * 1024 * 1024 });
      // Exclusions prevent future capture; existing records remain until explicitly removed.
      await refreshCapture();
      return publicSettings();
    }
    async function capture(payload, sender) {
      return serial(async () => {
        const generation = captureGeneration;
        const value = await settings();
        if (!value.recording) return { recording: false };
        if (!sender.tab || sender.frameId !== 0 || sender.tab.incognito) throw fail('capture_not_allowed');
        if (!await contains({ permissions: ['scripting'], origins: MATCHES })) return { recording: false };
        let tab;
        try { tab = await chromeApi.tabs.get(sender.tab.id); } catch { throw fail('capture_not_allowed'); }
        const url = safeMemoryURL(payload.url);
        if (tab.incognito || !url || url !== safeMemoryURL(tab.url) || excludedMemoryURL(url, value.exclusions)) return { recording: true, skipped: true };
        const deleted = (await area.get(DELETED))[DELETED] || [];
        const tombstone = deleted.find(item => item.url === url);
        if (tombstone && (!Number.isFinite(payload.documentStartedAt) || payload.documentStartedAt <= tombstone.at)) return { recording: true, skipped: true };
        const text = typeof payload.text === 'string' ? payload.text.slice(0, 30000) : '';
        if (generation !== captureGeneration || !await contains({ permissions: ['scripting'], origins: MATCHES })) return { recording: false };
        if (generation !== captureGeneration) return { recording: false };
        const document = await repository.upsert({ url, title: String(payload.title || '').slice(0, 1024), text,
          visitedAt: now(), capturedAt: text ? now() : null, source: 'capture',
          truncated: Boolean(payload.truncated) || (typeof payload.text === 'string' && payload.text.length > 30000) });
        await repository.prune({ retentionDays: value.retentionDays, maxRecords: 5000, maxBytes: 32 * 1024 * 1024 });
        lastError = null;
        return { recording: true, id: document.id, captured: Boolean(text), truncated: Boolean(payload.truncated) };
      });
    }
    function validateBackup(backup) {
      if (!backup || backup.format !== 'tab-out-memory' || backup.version !== 1 || !Array.isArray(backup.records) || backup.records.length > 5000) throw fail('invalid_import');
      if (new TextEncoder().encode(JSON.stringify(backup)).byteLength > 40 * 1024 * 1024) throw fail('import_too_large');
      if (Object.keys(backup).some(key => !['format', 'version', 'exportedAt', 'records'].includes(key))) throw fail('invalid_import');
      for (const record of backup.records) {
        if (!record || !safeMemoryURL(record.url) || typeof record.title !== 'string' || typeof record.text !== 'string'
          || record.text.length > 60000 || record.title.length > 1024 || !Number.isFinite(record.visitedAt)
          || record.visitedAt < 0 || record.visitedAt > now() + 300000
          || (record.capturedAt !== null && (!Number.isFinite(record.capturedAt) || record.capturedAt < 0 || record.capturedAt > now() + 300000))
          || (record.truncated !== undefined && typeof record.truncated !== 'boolean')
          || Object.keys(record).some(key => !['id', 'url', 'title', 'text', 'visitedAt', 'capturedAt', 'source', 'truncated'].includes(key))) throw fail('invalid_import');
      }
      return backup.records;
    }
    async function freshDocuments(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw fail('invalid_selection');
      const wanted = [...new Set(ids)];
      const documents = await repository.getMany(wanted);
      if (documents.length !== wanted.length || documents.some(item => !safeMemoryURL(item.url))) throw fail('stale_result');
      return documents;
    }
    async function action(name, payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('invalid_request');
      if (name === 'status') return { settings: await publicSettings(), stats: await repository.stats(), permissions: {
        capture: await contains({ permissions: ['scripting'], origins: MATCHES }), history: await contains({ permissions: ['history'] }),
      }, lastError };
      if (name === 'getSettings') return publicSettings();
      if (name === 'saveSettings') return serial(() => saveSettings(payload));
      if (name === 'testConnection') return modelClient.test({ config: await modelConfig() });
      if (name === 'cancel') {
        if (typeof payload.requestId !== 'string' || payload.requestId.length > 128) throw fail('invalid_request');
        return cancelSearches(payload.requestId);
      }
      if (name === 'setRecording') return serial(async () => {
        if (typeof payload.enabled !== 'boolean') throw fail('invalid_request');
        if (payload.enabled && !await contains({ permissions: ['scripting'], origins: MATCHES })) throw fail('capture_permission_required');
        const value = await settings();
        await area.set({ [SETTINGS]: { ...value, recording: payload.enabled } });
        try { await refreshCapture({ inject: payload.enabled }); }
        catch { await area.set({ [SETTINGS]: { ...value, recording: false } }); throw fail('capture_registration_failed'); }
        return publicSettings();
      });
      if (name === 'importHistory') return serial(async () => {
        if (!await contains({ permissions: ['history'] }) || !chromeApi.history) throw fail('history_permission_required');
        const days = Number(payload.days || 30);
        if (![7, 30, 90, 180, 365].includes(days)) throw fail('invalid_days');
        const records = await chromeApi.history.search({ text: '', startTime: now() - days * 86400000, endTime: now(), maxResults: 5000 });
        const value = await settings();
        const documents = records.filter(item => safeMemoryURL(item.url) && !excludedMemoryURL(item.url, value.exclusions))
          .map(item => ({ url: safeMemoryURL(item.url), title: item.title || item.url, text: '', visitedAt: item.lastVisitTime || now(), capturedAt: null, source: 'history' }));
        const result = await repository.importRecords(documents);
        await repository.prune({ retentionDays: value.retentionDays, maxRecords: 5000, maxBytes: 32 * 1024 * 1024 });
        return { ...result, limited: records.length >= 5000, metadataOnly: true };
      });
      if (name === 'search') {
        if (String(payload.query || '').length > 2000) throw fail('query_too_long');
        if (![7, 30, 90, 180, 365].includes(Number(payload.days || 30))) throw fail('invalid_days');
        const id = typeof payload.requestId === 'string' ? payload.requestId.slice(0, 128) : scope.crypto.randomUUID();
        const controller = new AbortController();
        activeSearches.get(id)?.abort();
        activeSearches.set(id, controller);
        try {
          let config;
          let configError;
          if (payload.useAI) { try { config = await modelConfig(); } catch (error) { configError = error.code || 'model_not_configured'; } }
          if (controller.signal.aborted) throw fail('model_cancelled');
          const result = await searchService.search({ query: String(payload.query || ''), days: Number(payload.days || 30), limit: 30,
            useAI: Boolean(payload.useAI && config), includeContent: payload.includeContent === true, config, signal: controller.signal });
          if (controller.signal.aborted) throw fail('model_cancelled');
          if (configError) result.warnings = [...(result.warnings || []), configError];
          return result;
        } finally { if (activeSearches.get(id) === controller) activeSearches.delete(id); }
      }
      if (name === 'summarize') return searchService.summarize({ query: String(payload.query || ''), ids: payload.ids,
        includeContent: payload.includeContent === true, config: await modelConfig() });
      if (name === 'remove') return serial(async () => {
        cancelSearches();
        const documents = await freshDocuments(payload.ids);
        const previous = (await area.get(DELETED))[DELETED] || [];
        const urls = new Set(documents.map(item => item.url));
        await area.set({ [DELETED]: [...documents.map(item => ({ url: item.url, at: now() })), ...previous.filter(item => !urls.has(item.url))].slice(0, 5000) });
        await repository.remove(documents.map(item => item.id));
        return { removed: documents.length };
      });
      if (name === 'clear') return serial(async () => {
        cancelSearches();
        const value = await settings();
        await area.set({ [SETTINGS]: { ...value, recording: false }, [DELETED]: [] });
        await refreshCapture();
        await repository.clear();
        return { cleared: true, recording: false };
      });
      if (name === 'export') return { format: 'tab-out-memory', version: 1, exportedAt: new Date(now()).toISOString(), records: await repository.list({ limit: 5000 }) };
      if (name === 'import') {
        const records = validateBackup(payload.backup);
        if (payload.preview !== false) return { count: records.length, withContent: records.filter(item => item.text).length };
        return serial(async () => {
          const result = await repository.importRecords(records);
          const value = await settings();
          await repository.prune({ retentionDays: value.retentionDays, maxRecords: 5000, maxBytes: 32 * 1024 * 1024 });
          return result;
        });
      }
      if (name === 'open') return serial(async () => {
        const documents = await freshDocuments(payload.ids);
        const tabs = (await chromeApi.tabs.query({})).filter(tab => !tab.incognito);
        const seen = new Map(tabs.map(tab => [safeMemoryURL(tab.pendingUrl || tab.url), tab]));
        const result = { opened: 0, reused: 0, failed: 0 };
        for (const document of documents) {
          try {
            const existing = seen.get(safeMemoryURL(document.url));
            if (existing) {
              if (documents.length === 1) { await chromeApi.windows.update(existing.windowId, { focused: true }); await chromeApi.tabs.update(existing.id, { active: true }); }
              result.reused++;
            } else {
              const created = await chromeApi.tabs.create({ url: document.url, active: documents.length === 1 });
              seen.set(safeMemoryURL(document.url), created); result.opened++;
            }
          } catch { result.failed++; }
        }
        return result;
      });
      if (name === 'save') return serial(async () => {
        const documents = await freshDocuments(payload.ids);
        const workspaces = core.createWorkspaceRepository(area);
        const entitlement = core.createEntitlementService({ storage: area, publicKeyJwk: scope.TAB_OUT_PUBLIC_KEY_JWK });
        if ((await workspaces.list()).length >= await entitlement.limit('workspaces.limit')) throw fail('workspace_limit');
        return workspaces.create({ name: String(payload.name || `Memory ${new Date(now()).toISOString().slice(0, 10)}`).slice(0, 256),
          entries: documents.map(item => ({ title: item.title, url: item.url })) });
      });
      throw fail('unknown_action');
    }
    async function handleMessage(message, sender) {
      try {
        if (sender.id !== chromeApi.runtime.id) throw fail('unauthorized');
        if (message.type === 'browsing-memory-capture') return { ok: true, data: await capture(message.payload || {}, sender) };
        if (!sender.url?.startsWith(chromeApi.runtime.getURL('')) || (sender.tab?.incognito)) throw fail('unauthorized');
        return { ok: true, data: await action(message.action, message.payload) };
      } catch (error) {
        const code = typeof error.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(error.code) ? error.code : 'memory_failed';
        lastError = code;
        return { ok: false, error: { code, message: code } };
      }
    }
    async function init() {
      await area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
      await refreshCapture();
      const value = await settings();
      await repository.prune({ retentionDays: value.retentionDays, maxRecords: 5000, maxBytes: 32 * 1024 * 1024 });
    }
    return { handleMessage, action, capture, refreshCapture, init };
  }
  function installBrowsingMemory(chromeApi) {
    const core = scope.TabOutCore;
    const repository = core.createBrowsingMemoryRepository({ indexedDB: scope.indexedDB });
    const modelClient = core.createOpenAICompatibleClient({});
    const searchService = core.createBrowsingMemorySearchService({ repository, modelClient });
    const runtime = createBrowsingMemoryRuntime({ chromeApi, repository, modelClient, searchService });
    const ready = runtime.init().catch(() => {});
    chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
      if (!['browsing-memory', 'browsing-memory-capture'].includes(message?.type)) return undefined;
      ready.then(() => runtime.handleMessage(message, sender)).then(respond);
      return true;
    });
    chromeApi.permissions.onRemoved.addListener(() => runtime.refreshCapture().catch(() => {}));
    let historyListenerInstalled = false;
    function installHistoryListener() {
      if (historyListenerInstalled || !chromeApi.history?.onVisitRemoved) return;
      historyListenerInstalled = true;
      chromeApi.history.onVisitRemoved.addListener(event => {
      // Clear only the matching memory on explicit browser-history deletion.
      runtime.action(event.allHistory ? 'clear' : 'status').then(async () => {
        if (!event.allHistory && event.urls?.length) {
          const urls = new Set(event.urls.map(safeMemoryURL));
          const documents = (await repository.list({ limit: 5000 })).filter(item => urls.has(safeMemoryURL(item.url)));
          if (documents.length) await runtime.action('remove', { ids: documents.map(item => item.id) });
        }
      }).catch(() => {});
      });
    }
    installHistoryListener();
    chromeApi.permissions.onAdded.addListener(() => installHistoryListener());
    return runtime;
  }
  const api = { safeMemoryURL, excludedMemoryURL, memoryModelOrigin, createBrowsingMemoryRuntime, installBrowsingMemory };
  scope.TabOutCore = Object.assign(scope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
