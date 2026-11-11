'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/app.js'), 'utf8');
const start = source.indexOf('function closeOpenDashboardMenu(');
const context = vm.createContext({});
vm.runInContext(source.slice(start, source.indexOf('// Escape key →', start)), context);
const closeMenu = context.closeOpenDashboardMenu;
function event(extra = {}) { return { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; }
function menu(visible = true) {
  const value = { open: true, focused: false, getClientRects: () => visible ? [{}] : [], querySelector: () => ({ focus(options) { value.focused = options.preventScroll; } }) };
  return value;
}
test('Escape closes the focused saved menu and restores its summary without closing another menu', () => {
  const a = menu(), b = menu();
  const doc = { activeElement: { closest: selector => selector.includes('details.') ? b : null }, querySelectorAll: () => [a, b] };
  const key = event();
  assert.equal(closeMenu(key, doc), true);
  assert.equal(a.open, true); assert.equal(b.open, false); assert.equal(b.focused, true);
  assert.equal(key.prevented, true); assert.equal(key.stopped, true);
});
test('Escape outside a menu closes only an actually visible open dashboard menu', () => {
  const hidden = menu(false), visible = menu();
  const doc = { activeElement: { closest: () => null }, querySelectorAll: () => [hidden, visible] };
  assert.equal(closeMenu(event(), doc), true);
  assert.equal(hidden.open, true); assert.equal(visible.open, false); assert.equal(visible.focused, true);
});
test('menu Escape ignores modal focus, composing keys and unrelated keys', () => {
  const opened = menu();
  const modalDoc = { activeElement: { closest: () => ({}) }, querySelectorAll: () => [opened] };
  assert.equal(closeMenu(event(), modalDoc), false);
  const doc = { activeElement: { closest: () => null }, querySelectorAll: () => [opened] };
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { key: 'Enter' }]) assert.equal(closeMenu(event(extra), doc), false);
  assert.equal(opened.open, true);
});
