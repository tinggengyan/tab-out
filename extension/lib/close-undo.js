/* ================================================================
   Tab Out — close by tab id, with a 30-second undo

   Every close in the dashboard (single tab, site, duplicates, all,
   stash) goes through close(). Pinned tabs are never closed. Only the
   most recent operation can be undone; undo reopens pages in their
   original window and position, or in a new window if that one is gone.
   ================================================================ */
(function initCloseUndo(globalScope) {
  'use strict';

  function createUndoController({ tabsApi, windowsApi, now = Date.now, ttlMs = 30000 }) {
    let last = null; // { entries: [{ url, windowId, index }], meta, at }

    async function close(tabs, meta = {}) {
      const live = new Map((await tabsApi.query({})).map(tab => [tab.id, tab]));
      let skippedPinned = 0;
      const entries = [];
      for (const requested of tabs) {
        const current = live.get(requested.id);
        if (requested.pinned || current?.pinned) { skippedPinned++; continue; }
        if (!current) continue; // closed elsewhere since the page rendered
        entries.push({ id: current.id, url: current.url, windowId: current.windowId, index: current.index });
      }
      if (entries.length === 0) return { closed: 0, skippedPinned };

      await tabsApi.remove(entries.map(entry => entry.id));
      last = {
        entries: entries.map(({ url, windowId, index }) => ({ url, windowId, index })),
        meta,
        at: now(),
      };
      return { closed: entries.length, skippedPinned };
    }

    function canUndo() {
      return Boolean(last) && now() - last.at <= ttlMs;
    }

    async function undo() {
      if (!canUndo()) return null;
      const { entries, meta } = last;
      last = null;

      const openWindows = new Set((await windowsApi.getAll({})).map(win => win.id));
      const byWindow = new Map();
      for (const entry of entries) {
        if (!byWindow.has(entry.windowId)) byWindow.set(entry.windowId, []);
        byWindow.get(entry.windowId).push(entry);
      }

      for (const [windowId, group] of byWindow) {
        group.sort((a, b) => a.index - b.index);
        if (openWindows.has(windowId)) {
          for (const entry of group) {
            await tabsApi.create({ windowId, index: entry.index, url: entry.url, active: false });
          }
        } else {
          const [first, ...rest] = group;
          const win = await windowsApi.create({ url: first.url, focused: false });
          for (const [offset, entry] of rest.entries()) {
            await tabsApi.create({ windowId: win.id, index: offset + 1, url: entry.url, active: false });
          }
        }
      }
      return { restored: entries.length, meta };
    }

    function clear() { last = null; }

    return { close, canUndo, undo, clear };
  }

  const api = { createUndoController };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
