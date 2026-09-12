(function initSearchService(globalScope) {
  'use strict';
  function tokenize(value) {
    const input = String(value || '').normalize('NFKC').toLowerCase();
    const tokens = [];
    for (const match of input.matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
      const part = match[0];
      if (/^[\p{Script=Han}]+$/u.test(part)) {
        if (part.length === 1) tokens.push(part);
        else for (let index = 0; index < part.length - 1; index += 1) tokens.push(part.slice(index, index + 2));
      } else tokens.push(part);
    }
    return [...new Set(tokens)];
  }

  function parseSearchQuery(value) {
    const filters = { types: [] };
    const text = String(value || '').replace(/\b(type|after|before):([^\s]+)/gi, (_match, name, token) => {
      const key = name.toLowerCase();
      if (key === 'type') filters.types.push(...token.toLowerCase().split(',').filter(Boolean));
      else filters[key] = token;
      return ' ';
    }).replace(/\s+/g, ' ').trim();
    return { text, ...(filters.types.length ? { types: [...new Set(filters.types)] } : {}), ...(filters.after ? { after: filters.after } : {}), ...(filters.before ? { before: filters.before } : {}) };
  }

  function createSearchIndex(items = []) {
    const records = items.map((item, index) => {
      const title = String(item.title || '').toLowerCase();
      const subtitle = String(item.subtitle || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();
      let domain = '';
      try { domain = new URL(item.url).hostname.toLowerCase(); } catch {}
      const haystack = `${title} ${subtitle} ${url} ${domain}`;
      return { item, index, title, haystack, tokens: new Set(tokenize(haystack)) };
    });
    return {
      search(query, options = {}) {
        const normalized = String(query || '').trim().toLowerCase();
        const queryTokens = tokenize(normalized);
        const types = options.types ? new Set(options.types) : null;
        const after = options.after ? Date.parse(options.after) : null;
        const before = options.before ? Date.parse(options.before) : null;
        if (!normalized && !types && !Number.isFinite(after) && !Number.isFinite(before)) return [];
        return records.map(record => {
          if (types && !types.has(record.item.type)) return null;
          const timestamp = Date.parse(record.item.capturedAt || record.item.savedAt || record.item.updatedAt || record.item.createdAt || record.item.addedAt || 0);
          if (Number.isFinite(after) && (!Number.isFinite(timestamp) || timestamp < after)) return null;
          if (Number.isFinite(before) && (!Number.isFinite(timestamp) || timestamp > before)) return null;
          if (!normalized) return { ...record.item, _score: 1, _index: record.index };
          let score = 0;
          if (record.title.includes(normalized)) score += 30;
          score += record.title.split(normalized).length > 1
            ? (record.title.split(normalized).length - 1) * 10
            : 0;
          if (record.haystack.includes(normalized)) score += 15;
          for (const token of queryTokens) {
            if (record.tokens.has(token)) score += record.title.includes(token) ? 8 : 3;
          }
          if (queryTokens.some(token => !record.tokens.has(token)) && !record.haystack.includes(normalized)) return null;
          return score > 0 ? { ...record.item, _score: score, _index: record.index } : null;
        }).filter(Boolean)
          .sort((a, b) => b._score - a._score || a._index - b._index)
          .slice(0, options.limit || 20)
          .map(({ _score, _index, ...item }) => item);
      },
    };
  }
  const api = { tokenize, parseSearchQuery, createSearchIndex };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
