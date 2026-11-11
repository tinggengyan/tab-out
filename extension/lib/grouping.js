/* ================================================================
   Tab Out — site grouping and duplicate detection

   Pure functions: tabs in, groups / tab ids out. No chrome.* calls,
   so the Node tests exercise exactly what the dashboard runs.
   ================================================================ */
(function initGrouping(globalScope) {
  'use strict';

  const LANDING_GROUP = '__landing-pages__';

  // Homepages that get their own "Homepages" card so they can be closed
  // without touching content tabs on the same site.
  const DEFAULT_LANDING_PATTERNS = [
    { hostname: 'mail.google.com', test: (pathname, url) =>
        !url.includes('#inbox/') && !url.includes('#sent/') && !url.includes('#search/') },
    { hostname: 'x.com',            pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com',       pathExact: ['/'] },
    { hostname: 'www.youtube.com',  pathExact: ['/'] },
  ];

  const INTERNAL_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://'];

  function isRealTabUrl(url) {
    if (!url) return false;
    return !INTERNAL_PREFIXES.some(prefix => url.startsWith(prefix));
  }

  function hostnameMatches(rule, hostname) {
    if (rule.hostname) return hostname === rule.hostname;
    if (rule.hostnameEndsWith) return hostname.endsWith(rule.hostnameEndsWith);
    return false;
  }

  function isLandingPage(url, patterns) {
    try {
      const parsed = new URL(url);
      return patterns.some(rule => {
        if (!hostnameMatches(rule, parsed.hostname)) return false;
        if (rule.test)       return rule.test(parsed.pathname, url);
        if (rule.pathPrefix) return parsed.pathname.startsWith(rule.pathPrefix);
        if (rule.pathExact)  return rule.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  function matchCustomGroup(url, customGroups) {
    try {
      const parsed = new URL(url);
      return customGroups.find(rule => {
        if (!hostnameMatches(rule, parsed.hostname)) return false;
        if (rule.pathPrefix) return parsed.pathname.startsWith(rule.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  /**
   * groupTabsBySite(tabs, { landingPatterns, customGroups })
   * → [{ domain, label?, tabs }], homepages first, then by domain name.
   */
  function groupTabsBySite(tabs, options = {}) {
    const landingPatterns = [...DEFAULT_LANDING_PATTERNS, ...(options.landingPatterns || [])];
    const customGroups = options.customGroups || [];
    const groupMap = {};
    const landingTabs = [];

    for (const tab of tabs) {
      try {
        if (isLandingPage(tab.url, landingPatterns)) { landingTabs.push(tab); continue; }

        const customRule = matchCustomGroup(tab.url, customGroups);
        if (customRule) {
          const key = customRule.groupKey;
          if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
          groupMap[key].tabs.push(tab);
          continue;
        }

        const hostname = tab.url.startsWith('file://') ? 'local-files' : new URL(tab.url).hostname;
        if (!hostname) continue;
        if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
        groupMap[hostname].tabs.push(tab);
      } catch {
        // Skip malformed URLs
      }
    }

    if (landingTabs.length > 0) groupMap[LANDING_GROUP] = { domain: LANDING_GROUP, tabs: landingTabs };

    return Object.values(groupMap).sort((a, b) => {
      const aLanding = a.domain === LANDING_GROUP;
      const bLanding = b.domain === LANDING_GROUP;
      if (aLanding !== bLanding) return aLanding ? -1 : 1;
      return a.domain.localeCompare(b.domain, undefined, { sensitivity: 'base' });
    });
  }

  /**
   * duplicateTabIds(tabs) → ids of extra copies of the same exact URL.
   * Survivor per URL: a pinned copy, else the active one, else the first.
   * Pinned tabs are never returned.
   */
  function duplicateTabIds(tabs) {
    const byUrl = new Map();
    for (const tab of tabs) {
      if (!byUrl.has(tab.url)) byUrl.set(tab.url, []);
      byUrl.get(tab.url).push(tab);
    }
    const ids = [];
    for (const copies of byUrl.values()) {
      if (copies.length < 2) continue;
      const keep = copies.find(tab => tab.pinned) || copies.find(tab => tab.active) || copies[0];
      for (const tab of copies) {
        if (tab !== keep && !tab.pinned) ids.push(tab.id);
      }
    }
    return ids;
  }

  function faviconUrl(pageUrl, extensionId) {
    return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=16`;
  }

  const api = { LANDING_GROUP, isRealTabUrl, groupTabsBySite, duplicateTabIds, faviconUrl };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
