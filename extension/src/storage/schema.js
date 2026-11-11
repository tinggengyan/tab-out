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

  function stableAnonymousGroupId(group, index) {
    let first = 2166136261, second = 5381;
    const serialized = JSON.stringify(group);
    for (let offset = 0; offset < serialized.length; offset++) {
      const unit = serialized.charCodeAt(offset);
      first = Math.imul(first ^ unit, 16777619);
      second = Math.imul(second, 33) ^ unit;
    }
    // The position keeps identical anonymous records within one file distinct;
    // the content makes importing that same file again idempotent.
    return `anonymous:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${index}`;
  }

  function sanitizeTabGroup(item, index = 0) {
    if (!item || !Array.isArray(item.tabs)) return null;
    let session;
    if (item.session !== undefined) {
      const validate = typeof require === 'function'
        ? require('../services/backup-service.js').validatePortableBackup
        : globalScope.TabOutCore.validatePortableBackup;
      const result = validate({ version: 2, data: { workspacesV2: [{ entries: [], session: item.session }] } });
      if (!result.ok) throw new Error(`Invalid saved project session: ${result.error}`);
      session = result.data.workspacesV2[0].session;
    }
    const sanitizePage = tab => {
      const url = normalizeWebUrl(tab?.url);
      return url ? { url, title: safeString(tab.title, 1024), pinned: Boolean(tab.pinned) } : null;
    };
    let tabs = item.tabs.map(sanitizePage).filter(Boolean);
    if (!tabs.length && session) tabs = session.windows.flatMap(window => window.tabs).map(sanitizePage).filter(Boolean);
    if (tabs.length === 0) return null;
    const group = {
      savedAt: safeString(item.savedAt, 64) || new Date(0).toISOString(),
      tabs,
      ...(item.name ? { name: safeString(item.name, 256) } : {}),
      ...(session ? { session } : {}),
    };
    return { id: safeString(item.id, 128) || stableAnonymousGroupId(group, index), ...group };
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

    // Apply the same resource bounds as portable backups before traversing or
    // cloning nested session metadata. Unsafe URLs are still filtered by each
    // collection sanitizer, preserving the established legacy import behavior.
    let inspectedItems = 0;
    function inspect(value, depth = 0) {
      if (depth > (options.maxDepth || 12)) throw new Error('Import nesting is too deep');
      if (typeof value === 'string' && value.length > (options.maxStringLength || 65536)) throw new Error('Import string is too long');
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        inspectedItems += value.length;
        if (inspectedItems > (options.maxItems || DEFAULT_MAX_ITEMS)) throw new Error('Import contains too many items');
      }
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe import key');
        inspect(child, depth + 1);
      }
    }
    try { for (const key of keys) inspect(payload[key]); }
    catch (error) { return { ok: false, error: error.message }; }

    let skipped = 0;
    const clean = (items, sanitizer) => validList(items).map((item, index) => {
      const result = sanitizer(item, index);
      if (!result) skipped += 1;
      return result;
    }).filter(Boolean);
    let data;
    try {
      data = {
        shortcuts: clean(payload.shortcuts, sanitizeShortcut),
        deferred: clean(payload.deferred, sanitizeDeferred),
        tabGroups: clean(payload.tabGroups, sanitizeTabGroup),
      };
    } catch (error) { return { ok: false, error: error.message }; }
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
    // A rejected legacy payload must never turn an on-device upgrade into an
    // empty saved library. The migration caller retains its original keys.
    if (!validated.ok) throw new Error(`Cannot migrate saved data: ${validated.error}`);
    const data = validated.data;
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
