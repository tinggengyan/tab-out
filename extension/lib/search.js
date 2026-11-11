/* ================================================================
   Tab Out — search: matching, grouping and highlighting

   One query, five sources, always in this order: open tabs, saved for
   later, stash, bookmarks, history. Bookmarks and history are null
   until the user grants them, and then their group is left out.
   A result matches when every word of the query appears in its title
   or address. Everything here is pure, so it runs under node --test.
   ================================================================ */
(function initSearch(globalScope) {
  'use strict';

  const { escapeHtml } = typeof require === 'function'
    ? require('./sanitize.js')
    : globalScope.TabOutLib;

  // Bookmarklets (javascript:), data: and extension pages never become results.
  const OPENABLE = /^(https?|file):/i;

  function tokenize(query) {
    return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matches(tokens, ...fields) {
    const text = fields.map(field => String(field ?? '')).join('\n').toLowerCase();
    return tokens.every(token => text.includes(token));
  }

  function searchAll({ query, tabs = [], saved = [], stash = [], bookmarks = null, history = null }) {
    const tokens = tokenize(query);
    if (!tokens.length) return { tokens, groups: [] };
    const hit = item => matches(tokens, item.title, item.url);

    const groups = [
      { key: 'tabs', items: tabs.filter(hit)
        .map(({ id, windowId, url, title }) => ({ kind: 'tab', id, windowId, url, title })) },
      { key: 'saved', items: saved.filter(item => !item.completed && !item.dismissed && hit(item))
        .map(({ id, url, title, savedAt }) => ({ kind: 'saved', id, url, title, savedAt })) },
      { key: 'stash', items: stash.flatMap(record => {
        const found = [];
        if (record.name && matches(tokens, record.name)) {
          found.push({ kind: 'record', recordId: record.id, name: record.name, count: record.tabs.length, savedAt: record.savedAt });
        }
        for (const page of record.tabs) {
          if (hit(page)) found.push({ kind: 'stashPage', recordId: record.id, recordName: record.name || '', savedAt: record.savedAt, url: page.url, title: page.title });
        }
        return found;
      }) },
    ];

    if (bookmarks) {
      groups.push({ key: 'bookmarks', items: bookmarks.filter(item => OPENABLE.test(item.url || '') && hit(item))
        .map(({ id, url, title, path }) => ({ kind: 'bookmark', id, url, title, path })) });
    }
    if (history) {
      const shown = new Set(groups.flatMap(group => group.items.map(item => item.url)).filter(Boolean));
      const items = [];
      for (const item of [...history].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))) {
        if (!OPENABLE.test(item.url || '') || shown.has(item.url) || !hit(item)) continue;
        shown.add(item.url);
        items.push({ kind: 'history', url: item.url, title: item.title, lastVisitTime: item.lastVisitTime });
      }
      groups.push({ key: 'history', items });
    }

    return { tokens, groups: groups.filter(group => group.items.length) };
  }

  // Escapes the text, then wraps every occurrence of every word in <mark>.
  function highlight(text, tokens) {
    const source = String(text ?? '');
    const lower = source.toLowerCase();
    // A few characters change length when lowercased (İ → i̇); offsets would drift.
    if (!tokens.length || lower.length !== source.length) return escapeHtml(source);
    const marked = new Uint8Array(source.length);
    for (const token of tokens) {
      for (let at = lower.indexOf(token); at !== -1; at = lower.indexOf(token, at + 1)) {
        marked.fill(1, at, at + token.length);
      }
    }
    let html = '';
    for (let start = 0; start < source.length;) {
      let end = start;
      while (end < source.length && marked[end] === marked[start]) end++;
      const run = escapeHtml(source.slice(start, end));
      html += marked[start] ? `<mark>${run}</mark>` : run;
      start = end;
    }
    return html;
  }

  // chrome.bookmarks.getTree() → pages with the folders above them (the nameless root left out).
  function flattenBookmarks(tree) {
    const pages = [];
    const walk = (node, path) => {
      if (node.url) { pages.push({ id: node.id, title: node.title, url: node.url, path }); return; }
      const below = node.title ? [...path, node.title] : path;
      for (const child of node.children || []) walk(child, below);
    };
    for (const root of tree || []) walk(root, []);
    return pages;
  }

  function dayBucket(ms, now = Date.now()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (ms >= today.getTime()) return 'today';
    if (ms >= yesterday.getTime()) return 'yesterday';
    return 'earlier';
  }

  const api = { tokenize, searchAll, highlight, flattenBookmarks, dayBucket };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
