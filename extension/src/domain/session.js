(function initSession(globalScope) {
  'use strict';

  function isRestorableUrl(url) {
    try {
      const protocol = new URL(url).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  function stableId(prefix, value) {
    return `${prefix}:${String(value)}`;
  }

  function isValidSessionShape(session) {
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const reference = value => (typeof value === 'string' && value.length > 0) || Number.isInteger(value);
    const optional = (value, key, check) => value[key] === undefined || check(value[key]);
    const text = value => typeof value === 'string';
    const boolean = value => typeof value === 'boolean';
    const validTab = tab => record(tab) && typeof tab.url === 'string' && tab.url.length > 0
      && ((/^https?:\/\//i.test(tab.url) && isRestorableUrl(tab.url))
        || (tab.restorable === false && /^(chrome|chrome-extension|edge|brave|about|file):/i.test(tab.url)))
      && optional(tab, 'id', reference) && optional(tab, 'groupRef', reference)
      && optional(tab, 'title', text) && optional(tab, 'favIconUrl', text)
      && optional(tab, 'index', value => Number.isInteger(value) && value >= 0)
      && ['pinned', 'active', 'restorable'].every(key => optional(tab, key, boolean));
    const validGroup = group => record(group) && Array.isArray(group.tabIds)
      && group.tabIds.every(reference) && optional(group, 'ref', reference)
      && optional(group, 'title', text) && optional(group, 'color', text) && optional(group, 'collapsed', boolean);
    return record(session) && Array.isArray(session.windows) && session.windows.every(window =>
      record(window) && Array.isArray(window.tabs) && window.tabs.every(validTab)
      && (window.groups === undefined || (Array.isArray(window.groups) && window.groups.every(validGroup)))
      && optional(window, 'sourceWindowId', Number.isInteger) && optional(window, 'state', text)
      && ['focused', 'incognito'].every(key => optional(window, key, boolean)));
  }

  function buildSession({ windows = [], groups = [], type = 'automatic', source, note = '', deviceId = 'local', capturedAt = new Date().toISOString(), id }) {
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const mappedWindows = windows.map(window => {
      const windowGroupIds = [...new Set((window.tabs || [])
        .map(tab => tab.groupId)
        .filter(groupId => Number.isInteger(groupId) && groupId >= 0))];
      const mappedGroups = windowGroupIds.map(groupId => groupsById.get(groupId)).filter(Boolean).map(group => ({
        ref: stableId('group', group.id),
        title: group.title || '',
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed),
        tabIds: (window.tabs || []).filter(tab => tab.groupId === group.id).map(tab => stableId('tab', tab.id)),
      }));
      return {
        sourceWindowId: window.id,
        focused: Boolean(window.focused),
        incognito: Boolean(window.incognito),
        state: window.state || 'normal',
        tabs: (window.tabs || []).map(tab => ({
          id: stableId('tab', tab.id),
          url: tab.url || '',
          title: tab.title || '',
          index: Number.isInteger(tab.index) ? tab.index : 0,
          active: Boolean(tab.active),
          pinned: Boolean(tab.pinned),
          ...(Number.isInteger(tab.groupId) && tab.groupId >= 0 ? { groupRef: stableId('group', tab.groupId) } : {}),
          ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
          restorable: isRestorableUrl(tab.url),
          capturedAt,
        })),
        groups: mappedGroups,
      };
    });
    const session = {
      id: id || (globalScope.crypto?.randomUUID ? globalScope.crypto.randomUUID() : `session-${Date.now()}`),
      type,
      source: String(source || type).slice(0, 64),
      note: String(note || '').slice(0, 500),
      capturedAt,
      deviceId,
      windows: mappedWindows,
      stats: {
        windowCount: mappedWindows.length,
        tabCount: mappedWindows.reduce((sum, window) => sum + window.tabs.length, 0),
        groupCount: mappedWindows.reduce((sum, window) => sum + window.groups.length, 0),
      },
      schemaVersion: 2,
    };
    session.fingerprint = sessionFingerprint(session);
    return session;
  }

  function sessionFingerprint(session) {
    const stable = (session.windows || []).map(window => ({
      focused: window.focused,
      state: window.state,
      tabs: (window.tabs || []).map(tab => ({
        url: tab.url,
        title: tab.title,
        index: tab.index,
        active: tab.active,
        pinned: tab.pinned,
        groupRef: tab.groupRef,
      })),
      groups: (window.groups || []).map(group => ({
        ref: group.ref,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      })),
    }));
    const source = JSON.stringify(stable);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  const api = { buildSession, sessionFingerprint, isValidSessionShape };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
