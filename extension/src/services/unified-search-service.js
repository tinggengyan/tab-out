(function initUnifiedSearch(globalScope) {
  'use strict';
  const core = typeof require === 'function' ? {
    ...require('./search-service.js'), ...require('../shared/sanitize.js'),
  } : globalScope.TabOutCore;

  function openTabSearchItems(tabs) {
    const counts = new Map();
    tabs.forEach(tab => counts.set(tab.url, (counts.get(tab.url) || 0) + 1));
    return tabs.filter(tab => core.normalizeWebUrl(tab.url)).map(tab => ({
      id: `tab:${tab.id}`, type: 'open', tabId: tab.id, windowId: tab.windowId,
      title: tab.title || tab.url, url: tab.url, duplicateCount: counts.get(tab.url),
    }));
  }
  function searchOpenTabs(query, tabs, limit = 30) {
    return core.createSearchIndex(openTabSearchItems(tabs)).search(query, { limit });
  }
  async function activateSearchResult(item, chromeApi) {
    if (item.type === 'open') {
      let tab;
      try { tab = await chromeApi.tabs.get(item.tabId); }
      catch { throw new Error('search.stale'); }
      await chromeApi.windows.update(tab.windowId, { focused: true });
      await chromeApi.tabs.update(tab.id, { active: true });
      return;
    }
    const url = core.normalizeWebUrl(item.url);
    if (!url) throw new Error('search.failed');
    if (item.type !== 'platform') {
      const existing = (await chromeApi.tabs.query({})).find(tab => tab.url === url);
      if (existing) return activateSearchResult({ type: 'open', tabId: existing.id }, chromeApi);
    }
    await chromeApi.tabs.create({ url });
  }
  const api = { openTabSearchItems, searchOpenTabs, activateSearchResult };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
