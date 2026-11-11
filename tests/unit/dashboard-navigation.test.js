'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDashboardNavigation } = require('../../extension/src/ui/dashboard-navigation.js');

function languageHarness() {
  const listeners = new Set();
  return {
    listeners,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async change() { await Promise.all([...listeners].map(listener => Promise.resolve().then(listener))); },
  };
}

function harness({ languageService, initialize = true } = {}) {
  const nodes = new Map();
  const scrollCalls = [];
  const doc = { activeElement: null, getElementById: id => nodes.get(id) };
  const win = {
    scrollX: 0, scrollY: 680, history: { scrollRestoration: 'auto' },
    scrollTo() { assert.fail('window must not be used as the content scroll host'); },
  };
  function node(id, extra = {}) {
    const listeners = new Map();
    const attributes = new Map();
    const value = {
      id, hidden: false, attributes,
      setAttribute: (name, content) => attributes.set(name, content),
      removeAttribute: name => attributes.delete(name),
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
      click: () => listeners.get('click')?.(),
      emit: (name, event = {}) => listeners.get(name)?.(event),
      focus(options) { this.focusOptions = options; doc.activeElement = this; if (!options?.preventScroll) nodes.get('dashboardContent').scrollTop = 0; },
      ...extra,
    };
    nodes.set(id, value);
    return value;
  }
  node('dashboardNavigation');
  const content = node('dashboardContent', {
    scrollLeft: 0, scrollTop: 680, clientHeight: 630,
    scrollTo(position) {
      scrollCalls.push(position);
      const current = [...nodes.values()].find(node => node.height && !node.hidden);
      this.scrollTop = Math.min(position.top, Math.max(0, (current?.height || 0) - this.clientHeight));
      this.scrollLeft = position.left;
    },
  });
  for (const suffix of ['Tabs', 'Projects', 'Memory']) {
    node(`dashboardNav${suffix}`);
    node(`dashboard${suffix}View`, { height: 3000, localState: { query: 'kept query', selected: ['a'] } });
  }
  const navigation = initialize ? createDashboardNavigation({ document: doc, window: win, translate: key => `localized ${key}`, languageService }) : null;
  return { navigation, nodes, win, doc, content, scrollCalls };
}

test('a new document starts at Tabs at the top without focusing a workbench', () => {
  const { navigation, nodes, doc, win, content } = harness();
  assert.equal(navigation.currentView, 'tabs');
  assert.equal(nodes.get('dashboardTabsView').hidden, false);
  assert.equal(nodes.get('dashboardProjectsView').hidden, true);
  assert.equal(nodes.get('dashboardMemoryView').hidden, true);
  assert.equal(doc.activeElement, null);
  assert.equal(content.scrollTop, 0);
  assert.equal(win.scrollY, 680, 'initialization does not move the window');
  assert.equal(content.attributes.get('aria-labelledby'), 'dashboardNavTabs');
  assert.equal(win.history.scrollRestoration, 'manual');
  assert.equal(nodes.get('dashboardNavMemory').textContent, 'localized dashboard.memory');
  assert.equal(nodes.get('dashboardNavigation').attributes.get('aria-label'), 'localized dashboard.navigation');
});

test('real button handlers switch only the view and keep each existing workbench and its state', () => {
  const { navigation, nodes, content } = harness();
  const memoryView = nodes.get('dashboardMemoryView');
  const state = memoryView.localState;
  nodes.get('dashboardNavMemory').click();
  assert.equal(navigation.currentView, 'memory');
  assert.equal(memoryView.hidden, false);
  assert.equal(nodes.get('dashboardTabsView').hidden, true);
  assert.equal(nodes.get('dashboardProjectsView').hidden, true);
  assert.equal(content.attributes.get('aria-labelledby'), 'dashboardNavMemory');
  assert.deepEqual([...nodes.values()].filter(node => node.attributes.get('aria-current')).map(node => node.id), ['dashboardNavMemory']);
  nodes.get('dashboardNavProjects').click();
  nodes.get('dashboardNavMemory').click();
  assert.equal(nodes.get('dashboardMemoryView'), memoryView);
  assert.equal(memoryView.localState, state);
  assert.deepEqual(state, { query: 'kept query', selected: ['a'] });
});

test('each long view restores its own position and returning to Tabs retains visible navigation focus', () => {
  const { navigation, nodes, content, win, doc } = harness();
  content.scrollTop = 612;
  navigation.show('projects');
  assert.equal(content.scrollTop, 0);
  content.scrollTop = 814;
  navigation.show('memory');
  content.scrollTop = 430;
  navigation.show('tabs');
  assert.equal(content.scrollTop, 612);
  assert.equal(doc.activeElement, nodes.get('dashboardNavTabs'));
  assert.deepEqual(doc.activeElement.focusOptions, { preventScroll: true });
  navigation.show('projects');
  assert.equal(content.scrollTop, 814);
  navigation.show('memory');
  assert.equal(content.scrollTop, 430);
  assert.equal(win.scrollY, 680, 'view switching never scrolls the window');
});

test('reselecting the current view or requesting an invalid view cannot reset its scroll position', () => {
  const { navigation, content, scrollCalls } = harness();
  content.scrollTop = 701;
  const before = scrollCalls.length;
  assert.equal(navigation.show('tabs'), true);
  assert.equal(navigation.show('unknown'), false);
  assert.equal(content.scrollTop, 701);
  assert.equal(scrollCalls.length, before);
});

test('a short destination clamps only its own content position without losing the long view position', () => {
  const { navigation, nodes, content } = harness();
  content.scrollTop = 1260;
  nodes.get('dashboardProjectsView').height = 200;
  navigation.show('projects');
  assert.equal(content.scrollTop, 0);
  navigation.show('tabs');
  assert.equal(content.scrollTop, 1260);
});

test('teardown removes navigation listeners and incomplete host markup stays untouched', () => {
  const { navigation, nodes } = harness();
  navigation.destroy();
  nodes.get('dashboardNavMemory').click();
  assert.equal(navigation.currentView, 'tabs');
  assert.equal(createDashboardNavigation({ document: { getElementById: () => null }, window: {} }), null);
});

test('language redraw restores the position captured before another subscriber clamps the content height', async () => {
  const languageService = languageHarness();
  const { navigation, content, nodes } = harness({ languageService });
  navigation.show('memory');
  content.scrollTop = 460;
  languageService.onChange(async () => {
    nodes.get('dashboardMemoryView').height = 100;
    content.scrollTo({ left: 0, top: content.scrollTop });
    assert.equal(content.scrollTop, 0, 'clearing the long results really clamps scroll');
    await Promise.resolve();
    nodes.get('dashboardMemoryView').height = 3000;
  });
  languageService.onChange(async () => {
    await Promise.resolve();
    assert.equal(navigation.restoreLanguageScroll(), true);
  });
  await languageService.change();
  assert.equal(content.scrollTop, 460);
  assert.equal(navigation.restoreLanguageScroll(), false, 'a completed restoration cannot be replayed');
});

test('navigation and deliberate content scrolling invalidate a pending language position', async () => {
  const languageService = languageHarness();
  const { navigation, content } = harness({ languageService });
  for (const action of [
    () => navigation.show(navigation.currentView === 'tabs' ? 'memory' : 'tabs'),
    () => content.emit('wheel'),
    () => content.emit('pointerdown'),
    () => content.emit('keydown', { key: 'PageDown' }),
  ]) {
    content.scrollTop = 460;
    await languageService.change();
    action();
    content.scrollTop = 800;
    assert.equal(navigation.restoreLanguageScroll(), false);
    assert.equal(content.scrollTop, 800, 'redraw must not undo the user action');
  }
});

test('the page shell registers its language capture before preference loading finishes', async () => {
  const languageService = languageHarness();
  const ready = Promise.withResolvers();
  languageService.ready = ready.promise;
  const { doc, win, nodes } = harness({ initialize: false });
  const context = vm.createContext({ ...win, document: doc, TabOutI18n: languageService, t: key => `translated ${key}` });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/src/ui/dashboard-navigation.js'), 'utf8'), context);
  assert.ok(context.tabOutDashboardNavigation, 'shell must exist before later scripts register their redraws');
  assert.equal(languageService.listeners.size, 1);
  ready.resolve();
  await ready.promise;
  assert.equal(nodes.get('dashboardNavMemory').textContent, 'translated dashboard.memory');
});
