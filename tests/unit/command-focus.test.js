'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../../extension/app.js'), 'utf8');
const commandStart = app.indexOf('async function openCommandPalette(');
const commandEnd = app.indexOf('\nasync function renderSettings()', commandStart);
const observerStart = app.indexOf('const modalFocusObserver = new MutationObserver(');
const observerEnd = app.indexOf('\n\n/* ----------------------------------------------------------------\n   INITIALIZE', observerStart);

function harness(triggerId = 'dashboardNavTabs') {
  const nodes = new Map();
  const queued = [];
  let observe;
  const document = { activeElement: null, getElementById: id => nodes.get(id), querySelectorAll: () => [nodes.get('commandOverlay')] };
  class Element {
    constructor(id, parent) {
      this.id = id; this.parent = parent; this.style = {}; this.isConnected = true;
      this.focusCalls = [];
      nodes.set(id, this);
    }
    contains(target) { for (let node = target; node; node = node.parent) if (node === this) return true; return false; }
    matches() { return this.id === 'commandOverlay'; }
    closest(selector) { for (let node = this; node; node = node.parent) if (selector === '[hidden]' && node.hidden) return node; return null; }
    getClientRects() { for (let node = this; node; node = node.parent) if (node.hidden || node.style.display === 'none') return []; return [{}]; }
    querySelector() { return nodes.get('commandInput'); }
    focus(options) { this.focusCalls.push(options); document.activeElement = this; }
  }
  const overlay = new Element('commandOverlay'); overlay.style.display = 'none';
  const input = new Element('commandInput', overlay);
  new Element('commandEmpty', overlay);
  const trigger = new Element(triggerId); document.activeElement = trigger;
  const context = vm.createContext({ document, commandQueryGeneration: 0, commandMemoryRequestId: null, HTMLElement: Element,
    MutationObserver: class { constructor(callback) { observe = callback; } observe() {} },
    queueMicrotask: callback => queued.push(callback),
    buildCommandSearchIndex: async () => {}, renderCommandResults() {}, t: key => key,
  });
  vm.runInContext(app.slice(commandStart, commandEnd) + '\n' + app.slice(observerStart, observerEnd), context);
  return { context, document, overlay, input, trigger,
    observe: () => observe([{ target: overlay }]),
    flush: () => { while (queued.length) queued.shift()(); },
  };
}

test('command search restores the external navigation trigger after its synchronous input focus', async () => {
  for (const id of ['dashboardNavTabs', 'dashboardNavProjects', 'dashboardNavMemory']) {
    const { context, document, overlay, input, trigger, observe, flush } = harness(id);
    await context.openCommandPalette();
    assert.equal(document.activeElement, input);
    observe(); flush();
    assert.equal(overlay._returnFocus, trigger, 'observer must retain the external trigger');
    context.closeCommandPalette(); observe(); flush();
    assert.equal(document.activeElement, trigger);
    assert.equal(trigger.focusCalls.at(-1).preventScroll, true);
    assert.equal(overlay._returnFocus, null);
  }
});

test('closing command search cannot restore a disconnected or newly hidden trigger', async () => {
  for (const mode of ['disconnected', 'hidden']) {
    const { context, overlay, trigger, observe, flush } = harness();
    await context.openCommandPalette(); observe(); flush();
    if (mode === 'disconnected') trigger.isConnected = false;
    else trigger.hidden = true;
    context.closeCommandPalette(); observe(); flush();
    assert.equal(trigger.focusCalls.length, 0);
    assert.equal(overlay._returnFocus, null);
  }
});

test('a queued initial focus cannot refocus command search after it has already closed', async () => {
  const { context, document, input, trigger, observe, flush } = harness();
  await context.openCommandPalette(); observe();
  const before = input.focusCalls.length;
  context.closeCommandPalette(); observe(); flush();
  assert.equal(document.activeElement, trigger);
  assert.equal(input.focusCalls.length, before);
});
