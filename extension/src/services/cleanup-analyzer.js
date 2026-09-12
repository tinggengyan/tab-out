(function initCleanupAnalyzer(globalScope) {
  'use strict';
  function analyzeCleanup(tabs = [], options = {}) {
    const now = options.now ?? Date.now();
    const staleBefore = now - (options.staleDays ?? 14) * 86400000;
    const whitelist = new Set((options.whitelist || []).map(value => String(value).toLowerCase()));
    const webTabs = tabs.filter(tab => {
      try { return ['http:', 'https:'].includes(new URL(tab.url).protocol); } catch { return false; }
    });
    const protectedTabs = [];
    const eligible = webTabs.filter(tab => {
      let host = '';
      try { host = new URL(tab.url).hostname.toLowerCase(); } catch {}
      const isProtected = Boolean(tab.pinned) || whitelist.has(host);
      if (isProtected) protectedTabs.push(tab);
      return !isProtected;
    });
    const seen = new Set();
    const duplicates = [];
    for (const tab of webTabs) {
      if (seen.has(tab.url) && !tab.pinned) duplicates.push(tab);
      else seen.add(tab.url);
    }
    const stale = eligible.filter(tab => Number.isFinite(tab.lastAccessed) && tab.lastAccessed < staleBefore);
    return {
      total: webTabs.length,
      duplicates,
      stale,
      protected: protectedTabs,
      overload: webTabs.length > (options.overloadThreshold ?? 30),
    };
  }
  const api = { analyzeCleanup };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
