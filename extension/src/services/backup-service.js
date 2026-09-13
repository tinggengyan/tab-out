(function initBackupService(globalScope) {
  'use strict';

  const PORTABLE_KEYS = Object.freeze([
    'storageMeta', 'shortcuts', 'searchPlatformsV1', 'deferred', 'tabGroups', 'sessionsV2', 'snapshotsV2', 'workspacesV2',
    'workspaceRulesV2', 'workspaceRuleExclusionsV2', 'workspaceSuggestionsV2', 'workspaceTemplatesV2',
    'operationsV2', 'restoreJobsV2', 'trashV2', 'cleanupWhitelistV2', 'onboardingV1',
    'automaticSnapshotsEnabledV1', 'workspaceAutomationEnabledV1', 'telemetryOptInV1',
    'openTabsViewModeV1',
    'telemetryEventsV1', 'localErrorsV1',
  ]);
  const WEB_URL = /^https?:\/\//i;
  const validateSearchPlatforms = typeof require === 'function'
    ? require('./platform-search-service.js').validateSearchPlatforms
    : globalScope.TabOutCore.validateSearchPlatforms;

  function createPortableBackup(state, options = {}) {
    const data = {};
    for (const key of PORTABLE_KEYS) {
      if (state[key] !== undefined) data[key] = structuredClone(state[key]);
    }
    return { version: 2, exportedAt: options.now || new Date().toISOString(), data };
  }

  function validatePortableBackup(payload, options = {}) {
    const maxItems = options.maxItems || 10000;
    const maxStringLength = options.maxStringLength || 65536;
    const maxDepth = options.maxDepth || 12;
    if (!payload || payload.version !== 2 || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      return { ok: false, error: 'Unsupported backup format' };
    }
    const keys = Object.keys(payload.data);
    if (!keys.length || keys.some(key => !PORTABLE_KEYS.includes(key))) return { ok: false, error: 'Unknown backup collection' };
    const arrayKeys = new Set(['shortcuts', 'searchPlatformsV1', 'deferred', 'tabGroups', 'sessionsV2', 'snapshotsV2', 'workspacesV2', 'workspaceRulesV2', 'workspaceRuleExclusionsV2', 'workspaceSuggestionsV2', 'workspaceTemplatesV2', 'operationsV2', 'restoreJobsV2', 'trashV2', 'cleanupWhitelistV2', 'telemetryEventsV1', 'localErrorsV1']);
    const booleanKeys = new Set(['onboardingV1', 'automaticSnapshotsEnabledV1', 'workspaceAutomationEnabledV1', 'telemetryOptInV1']);
    if (keys.some(key => arrayKeys.has(key) && !Array.isArray(payload.data[key]))) return { ok: false, error: 'Invalid backup collection type' };
    if (keys.some(key => booleanKeys.has(key) && typeof payload.data[key] !== 'boolean')) return { ok: false, error: 'Invalid backup setting type' };
    if (payload.data.openTabsViewModeV1 !== undefined && !['domain', 'window'].includes(payload.data.openTabsViewModeV1)) return { ok: false, error: 'Invalid view setting' };
    const workspacesValid = (payload.data.workspacesV2 || []).every(item => item && typeof item === 'object' && Array.isArray(item.entries));
    const sessionsValid = [...(payload.data.sessionsV2 || []), ...(payload.data.snapshotsV2 || [])].every(session =>
      session && typeof session === 'object' && Array.isArray(session.windows) && session.windows.every(window =>
        Array.isArray(window.tabs) && (window.groups === undefined || Array.isArray(window.groups))
      )
    );
    const groupsValid = (payload.data.tabGroups || []).every(group => group && Array.isArray(group.tabs));
    if (!workspacesValid || !sessionsValid || !groupsValid) return { ok: false, error: 'Malformed backup entity' };
    let items = 0;
    function inspect(value, depth, field, parent) {
      if (depth > maxDepth) throw new Error('Backup nesting is too deep');
      if (typeof value === 'string') {
        if (value.length > maxStringLength) throw new Error('Backup string is too long');
        if (field === 'url' && value && !WEB_URL.test(value)) {
          const safeUnsupported = parent?.restorable === false && /^(chrome|chrome-extension|edge|brave|about|file):/i.test(value);
          if (!safeUnsupported) throw new Error('Unsafe URL');
        }
        return;
      }
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
      if (Array.isArray(value)) {
        items += value.length;
        if (items > maxItems) throw new Error('Backup contains too many items');
        value.forEach(item => inspect(item, depth + 1, undefined, value));
        return;
      }
      if (typeof value !== 'object') throw new Error('Unsupported backup value');
      for (const [key, child] of Object.entries(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Unsafe backup key');
        inspect(child, depth + 1, key, value);
      }
    }
    try {
      const safeData = structuredClone(payload.data);
      if (payload.data.searchPlatformsV1 !== undefined) safeData.searchPlatformsV1 = validateSearchPlatforms(payload.data.searchPlatformsV1);
      inspect(payload.data, 0);
      return { ok: true, data: safeData, report: { collections: keys.length, items } };
    } catch (error) { return { ok: false, error: error.message }; }
  }

  function mergePortableData(current, incoming) {
    const data = {};
    let conflicts = 0;
    for (const key of Object.keys(incoming || {})) {
      const next = incoming[key];
      const existing = current?.[key];
      if (key === 'searchPlatformsV1') {
        const localPlatforms = validateSearchPlatforms(Array.isArray(existing) ? existing : []);
        const importedPlatforms = validateSearchPlatforms(Array.isArray(next) ? next : []);
        const ids = new Set(localPlatforms.map(item => item.id));
        const commands = new Set(localPlatforms.flatMap(item => [item.name, ...item.aliases].map(value => value.normalize('NFKC').trim().toLowerCase())));
        const merged = [...localPlatforms];
        for (const platform of importedPlatforms) {
          const platformCommands = [platform.name, ...platform.aliases].map(value => value.normalize('NFKC').trim().toLowerCase());
          if (ids.has(platform.id) || platformCommands.some(command => commands.has(command))) { conflicts += 1; continue; }
          merged.push(platform);
          ids.add(platform.id);
          platformCommands.forEach(command => commands.add(command));
        }
        data[key] = validateSearchPlatforms(merged);
        continue;
      }
      if (!Array.isArray(next) || !Array.isArray(existing)) { data[key] = structuredClone(next); continue; }
      const identity = item => {
        if (item && typeof item === 'object') return item.id || item.entityId || item.url || JSON.stringify(item);
        return JSON.stringify(item);
      };
      const importedKeys = new Set(next.map(identity));
      conflicts += existing.filter(item => importedKeys.has(identity(item))).length;
      data[key] = structuredClone([...existing.filter(item => !importedKeys.has(identity(item))), ...next]);
    }
    return { data, conflicts };
  }

  const api = { PORTABLE_KEYS, createPortableBackup, mergePortableData, validatePortableBackup };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
