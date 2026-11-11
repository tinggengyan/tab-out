(function initDashboardNavigationModule(globalScope) {
  'use strict';

  const VIEWS = ['tabs', 'projects', 'memory'];

  function createDashboardNavigation({ document: doc = globalScope.document, window: win = globalScope, translate = key => key, languageService = globalScope.TabOutI18n } = {}) {
    const navigation = doc.getElementById('dashboardNavigation');
    const content = doc.getElementById('dashboardContent');
    const entries = VIEWS.map(name => {
      const suffix = name[0].toUpperCase() + name.slice(1);
      return { name, button: doc.getElementById(`dashboardNav${suffix}`), view: doc.getElementById(`dashboard${suffix}View`) };
    });
    if (!navigation || !content || entries.some(entry => !entry.button || !entry.view)) return null;
    const footer = doc.getElementById('dashboardFooter');
    const syncToastOffset = () => {
      const height = footer?.getBoundingClientRect?.().height;
      if (Number.isFinite(height)) doc.documentElement?.style?.setProperty('--dashboard-footer-height', `${Math.ceil(height)}px`);
    };
    const footerObserver = typeof globalScope.ResizeObserver === 'function' && footer ? new globalScope.ResizeObserver(syncToastOffset) : null;
    footerObserver?.observe(footer);
    win.addEventListener?.('resize', syncToastOffset);
    syncToastOffset();
    const scrollPositions = new Map(VIEWS.map(name => [name, { x: 0, y: 0 }]));
    let currentView = 'tabs';
    let languageScroll = null;
    const listeners = [];

    function render() {
      for (const entry of entries) {
        entry.view.hidden = entry.name !== currentView;
        if (entry.name === currentView) {
          entry.button.setAttribute('aria-current', 'page');
          content.setAttribute('aria-labelledby', entry.button.id);
        }
        else entry.button.removeAttribute('aria-current');
      }
    }

    function show(name) {
      const target = entries.find(entry => entry.name === name);
      if (!target) return false;
      if (name !== currentView) {
        // A later language redraw must not return the user to the departing view's position.
        languageScroll = null;
        // Read before hiding the departing view can clamp the shared scroll host.
        scrollPositions.set(currentView, { x: content.scrollLeft, y: content.scrollTop });
        currentView = name;
        render();
        const position = scrollPositions.get(name);
        // Layout is committed by scrollTo before restoring the destination position.
        content.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
      }
      target.button.focus({ preventScroll: true });
      return true;
    }

    function localize() {
      navigation.setAttribute('aria-label', translate('dashboard.navigation'));
      for (const entry of entries) entry.button.textContent = translate(`dashboard.${entry.name}`);
    }
    function restoreLanguageScroll() {
      const position = languageScroll;
      languageScroll = null;
      if (!position || position.view !== currentView) return false;
      content.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
      return true;
    }
    // Register before workbenches: clearing/rebuilding a result list can clamp scrollTop.
    const unsubscribe = languageService?.onChange(() => {
      languageScroll = { view: currentView, x: content.scrollLeft, y: content.scrollTop };
      localize();
    });
    const cancelLanguageScroll = () => { languageScroll = null; };
    const handleScrollKey = event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelLanguageScroll();
    };
    content.addEventListener('wheel', cancelLanguageScroll, { passive: true });
    content.addEventListener('pointerdown', cancelLanguageScroll);
    content.addEventListener('keydown', handleScrollKey);
    if (languageService?.ready) languageService.ready.then(localize);
    else localize();
    for (const entry of entries) {
      const listener = () => show(entry.name);
      entry.button.addEventListener('click', listener);
      listeners.push([entry.button, listener]);
    }
    // A new document always starts at Tabs. Navigation state never enters storage.
    if (win.history && 'scrollRestoration' in win.history) win.history.scrollRestoration = 'manual';
    render();
    content.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    return {
      get currentView() { return currentView; },
      show, localize, restoreLanguageScroll,
      destroy() {
        unsubscribe?.(); languageScroll = null;
        footerObserver?.disconnect();
        win.removeEventListener?.('resize', syncToastOffset);
        content.removeEventListener('wheel', cancelLanguageScroll);
        content.removeEventListener('pointerdown', cancelLanguageScroll);
        content.removeEventListener('keydown', handleScrollKey);
        for (const [button, listener] of listeners) button.removeEventListener('click', listener);
      },
    };
  }

  const api = { createDashboardNavigation };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
  if (globalScope.document) {
    const initialize = () => {
      if (globalScope.tabOutDashboardNavigation) return;
      globalScope.tabOutDashboardNavigation = createDashboardNavigation({ translate: typeof globalScope.t === 'function' ? globalScope.t : key => key });
    };
    // The script follows i18n and the complete markup, before either workbench.
    if (globalScope.document.getElementById('dashboardNavigation')) initialize();
    else globalScope.document.addEventListener('DOMContentLoaded', initialize, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
