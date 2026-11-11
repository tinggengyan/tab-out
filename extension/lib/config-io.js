/* ================================================================
   Tab Out — export / import file formats

   Export writes version 3: { shortcuts, deferred, collectedGroups }.
   Import also understands:
     v1   — the original fork: top-level shortcuts, deferred, tabGroups
     v2   — the archived v2.3 backup: { version: 2, data: { … } },
            whose workspacesV2 projects become stash records
   ================================================================ */
(function initConfigIo(globalScope) {
  'use strict';

  const { recordFromWorkspace, recordFromTabGroup } = typeof require === 'function'
    ? require('./collected-store.js')
    : globalScope.TabOutLib;

  function buildExport({ shortcuts = [], deferred = [], collectedGroups = [] }, exportedAt = new Date().toISOString()) {
    return { version: 3, exportedAt, shortcuts, deferred, collectedGroups };
  }

  function isRecord(item) {
    return item && typeof item.id === 'string' && Array.isArray(item.tabs);
  }

  function parseImport(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const source = payload.version === 2 && payload.data && typeof payload.data === 'object' ? payload.data : payload;

    const result = {};
    if (Array.isArray(source.shortcuts)) result.shortcuts = source.shortcuts;
    if (Array.isArray(source.deferred))  result.deferred  = source.deferred;

    const hasGroups = ['collectedGroups', 'workspacesV2', 'tabGroups'].some(key => Array.isArray(source[key]));
    if (hasGroups) {
      result.collectedGroups = [
        ...(Array.isArray(source.collectedGroups) ? source.collectedGroups.filter(isRecord) : []),
        ...(Array.isArray(source.workspacesV2) ? source.workspacesV2.map(ws => recordFromWorkspace(ws)) : []),
        ...(Array.isArray(source.tabGroups) ? source.tabGroups.map(group => recordFromTabGroup(group)) : []),
      ].filter(Boolean);
    }

    return Object.keys(result).length ? result : null;
  }

  const api = { buildExport, parseImport };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
