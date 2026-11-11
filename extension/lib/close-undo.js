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
        // A tab that is still loading has no committed url yet; its address is in pendingUrl.
        const url = current.url || current.pendingUrl || requested.url;
        entries.push({ id: current.id, url, windowId: current.windowId, index: current.index });
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

      // One page that Chrome refuses to open must not stop the others.
      let restored = 0;
      const failed = [];
      const open = async (options, { newWindow = false } = {}) => {
        try {
          const created = await (newWindow ? windowsApi.create(options) : tabsApi.create(options));
          restored++;
          return created;
        } catch { failed.push(options.url); return null; }
      };

      for (const [windowId, group] of byWindow) {
        group.sort((a, b) => a.index - b.index);
        if (openWindows.has(windowId)) {
          for (const entry of group) await open({ windowId, index: entry.index, url: entry.url, active: false });
          continue;
        }
        // Original window is gone: the first page that opens creates the new window.
        let win = null;
        for (const entry of group) {
          if (!win) { win = await open({ url: entry.url, focused: false }, { newWindow: true }); continue; }
          await open({ windowId: win.id, url: entry.url, active: false });
        }
      }
      return { restored, failed, meta };
    }

    function clear() { last = null; }

    return { close, canUndo, undo, clear };
  }

  const api = { createUndoController };
  globalScope.TabOutLib = Object.assign(globalScope.TabOutLib || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
