(function initRuleEngine(globalScope) {
  'use strict';
  function compilePattern(pattern) {
    const value = String(pattern || '').trim().toLowerCase();
    if (!value || value.startsWith('javascript:') || value.startsWith('data:')) {
      throw new TypeError('Invalid workspace rule pattern');
    }
    if (!value.includes('://')) {
      if (!/^(\*\.)?[a-z0-9.-]+(?::\d+)?$/.test(value)) throw new TypeError('Invalid workspace rule pattern');
      if (value.startsWith('*.')) {
        const suffix = value.slice(1);
        return url => {
          try { return new URL(url).hostname.toLowerCase().endsWith(suffix); } catch { return false; }
        };
      }
      return url => {
        try { return new URL(url).host.toLowerCase() === value; } catch { return false; }
      };
    }
    if (!/^https?:\/\//.test(value)) throw new TypeError('Invalid workspace rule pattern');
    const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return url => regex.test(String(url || ''));
  }

  function matchWorkspaceRules(url, rules = [], exclusions = []) {
    const excluded = exclusions.some(pattern => {
      try { return compilePattern(pattern)(url); } catch { return false; }
    });
    if (excluded) return [];
    return rules.filter(rule => {
      if (!rule?.enabled) return false;
      try { return compilePattern(rule.pattern)(url); } catch { return false; }
    });
  }
  const api = { compilePattern, matchWorkspaceRules };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
