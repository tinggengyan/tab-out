(function initRestorePlanner(globalScope) {
  'use strict';
  function comparableUrl(value, ignoreHash) {
    try {
      const parsed = new URL(value);
      if (ignoreHash) parsed.hash = '';
      return parsed.href;
    } catch {
      return String(value || '');
    }
  }

  function planRestore(session, openTabs = [], options = {}) {
    const skipDuplicates = options.skipDuplicates !== false;
    const openUrls = new Set(openTabs.map(tab => comparableUrl(tab.url, options.ignoreHash)));
    let total = 0;
    let duplicates = 0;
    let unsupported = 0;
    let toOpen = 0;
    const windows = (session?.windows || []).map(window => {
      const tabs = (window.tabs || []).filter(tab => {
        total += 1;
        if (!tab.restorable) { unsupported += 1; return false; }
        if (skipDuplicates && openUrls.has(comparableUrl(tab.url, options.ignoreHash))) {
          duplicates += 1;
          return false;
        }
        toOpen += 1;
        return true;
      });
      const retainedIds = new Set(tabs.map(tab => tab.id));
      const groups = (window.groups || []).map(group => ({
        ...group,
        tabIds: (group.tabIds || []).filter(id => retainedIds.has(id)),
      })).filter(group => group.tabIds.length > 0);
      return { ...window, tabs, groups };
    }).filter(window => window.tabs.length > 0);
    return {
      ...session,
      windows,
      summary: { windows: session?.windows?.length || 0, total, toOpen, duplicates, unsupported },
    };
  }
  const api = { planRestore };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
