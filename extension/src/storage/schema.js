(function initSchema(globalScope) {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 2;
  const DEFAULT_MAX_ITEMS = 10000;
  const normalizeWebUrl = typeof require === 'function'
    ? require('../shared/sanitize.js').normalizeWebUrl
    : globalScope.TabOutCore.normalizeWebUrl;

  function safeString(value, maxLength = 2048) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  function validList(value) {
    return Array.isArray(value) ? value : [];
  }

  function sanitizeShortcut(item) {
    const url = normalizeWebUrl(item?.url);
    if (!url) return null;
    return {
      id: safeString(item.id, 128) || cryptoId(),
      name: safeString(item.name, 256),
      url,
    };
  }

  function sanitizeDeferred(item) {
    const url = normalizeWebUrl(item?.url);
    if (!url) return null;
    return {
      id: safeString(item.id, 128) || cryptoId(),
      url,
      title: safeString(item.title, 1024),
      savedAt: safeString(item.savedAt, 64) || new Date(0).toISOString(),
      completed: Boolean(item.completed),
      dismissed: Boolean(item.dismissed),
      ...(item.completedAt ? { completedAt: safeString(item.completedAt, 64) } : {}),
    };
  }

  function sanitizeTabGroup(item) {
    if (!item || !Array.isArray(item.tabs)) return null;
    const tabs = item.tabs.map(tab => {
      const url = normalizeWebUrl(tab?.url);
      return url ? { url, title: safeString(tab.title, 1024) } : null;
    }).filter(Boolean);
    if (tabs.length === 0) return null;
    return {
      id: safeString(item.id, 128) || cryptoId(),
      savedAt: safeString(item.savedAt, 64) || new Date(0).toISOString(),
      tabs,
    };
  }

  function cryptoId() {
    if (globalScope.crypto?.randomUUID) return globalScope.crypto.randomUUID();
    return `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function validateImportPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'Import must be an object' };
    }
    const keys = ['shortcuts', 'deferred', 'tabGroups'];
    if (!keys.some(key => Array.isArray(payload[key]))) {
      return { ok: false, error: 'No supported data collections found' };
    }
    const limit = options.maxItemsPerCollection || DEFAULT_MAX_ITEMS;
    for (const key of keys) {
      if (Array.isArray(payload[key]) && payload[key].length > limit) {
        return { ok: false, error: `Too many items in ${key}` };
      }
    }

    let skipped = 0;
    const clean = (items, sanitizer) => validList(items).map(item => {
      const result = sanitizer(item);
      if (!result) skipped += 1;
      return result;
    }).filter(Boolean);
    const data = {
      shortcuts: clean(payload.shortcuts, sanitizeShortcut),
      deferred: clean(payload.deferred, sanitizeDeferred),
      tabGroups: clean(payload.tabGroups, sanitizeTabGroup),
    };
    return {
      ok: true,
      data,
      report: {
        imported: data.shortcuts.length + data.deferred.length + data.tabGroups.length,
        skipped,
      },
    };
  }

  function migrateLegacyState(legacy, options = {}) {
    const validated = validateImportPayload({
      shortcuts: validList(legacy?.shortcuts),
      deferred: validList(legacy?.deferred),
      tabGroups: validList(legacy?.tabGroups),
    });
    const data = validated.ok ? validated.data : { shortcuts: [], deferred: [], tabGroups: [] };
    const sessions = data.tabGroups.map(group => ({
      id: group.id,
      type: 'collected',
      capturedAt: group.savedAt,
      deviceId: options.deviceId || 'local',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      windows: [{
        focused: false,
        incognito: false,
        tabs: group.tabs.map((tab, index) => ({
          id: `${group.id}:tab:${index}`,
          url: tab.url,
          title: tab.title,
          index,
          active: false,
          pinned: false,
          restorable: true,
          capturedAt: group.savedAt,
        })),
        groups: [],
      }],
      stats: { windowCount: 1, tabCount: group.tabs.length, groupCount: 0 },
    }));
    return {
      meta: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        deviceId: options.deviceId || 'local',
      },
      shortcuts: data.shortcuts,
      deferred: data.deferred,
      sessions,
    };
  }

  const api = { CURRENT_SCHEMA_VERSION, migrateLegacyState, validateImportPayload };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
