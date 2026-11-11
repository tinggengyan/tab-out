'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'extension/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'extension/app.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'extension/i18n.js'), 'utf8');
const entitlementConfig = fs.readFileSync(path.join(root, 'extension/entitlement-config.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));

test('static UI ids are unique and every required product surface exists', () => {
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
  for (const id of ['historyOverlay', 'workspacesOverlay', 'trashOverlay', 'commandOverlay', 'cleanupOverlay', 'upgradeOverlay', 'settingsOverlay', 'restoreOverlay', 'onboardingOverlay']) {
    assert.ok(ids.includes(id), `missing product surface ${id}`);
  }
});

test('literal DOM references resolve to static markup unless explicitly optional legacy stats', () => {
  const referenced = [...app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
  const allowedOptional = new Set(['statLabel', 'statTabs']);
  const missing = [...new Set(referenced)].filter(id => !allowedOptional.has(id) && !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});

test('every local script declared by the page exists in the extension package', () => {
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  for (const script of scripts) {
    assert.equal(fs.existsSync(path.join(root, 'extension', script)), true, `missing script ${script}`);
  }
});

test('destructive asset deletion exposes immediate trash undo', () => {
  assert.match(app, /showToast\(t\('toast\.movedToTrash'\), \{ undoTrashId: item\.id \}\)/);
  assert.match(app, /if \(action === 'undo-trash'\)/);
  assert.match(app, /await restoreTrashItem\(trashId\)/);
});

test('all four configurable commands are declared and implemented', () => {
  assert.deepEqual(Object.keys(manifest.commands).sort(), ['collect-current-window', 'open-tab-out', 'save-session', 'search-tab-out'].sort());
  for (const command of Object.keys(manifest.commands)) assert.match(background, new RegExp(`command === '${command}'`));
  assert.match(background, /command-collect-window/);
});

test('English and Chinese runtime dictionaries expose the same product keys', () => {
  const dictionaryBlocks = [...i18n.matchAll(/(?:en|'zh-CN'):\s*\{([\s\S]*?)\n\s*\},?/g)];
  assert.equal(dictionaryBlocks.length, 2, 'expected English and Chinese dictionaries');
  const keys = block => [...block.matchAll(/['"]([^'"]+)['"]\s*:/g)].map(match => match[1]).sort();
  assert.deepEqual(keys(dictionaryBlocks[0][1]), keys(dictionaryBlocks[1][1]));
});

test('every modal surface has an accessible dialog name and focusable control', () => {
  const overlays = [...html.matchAll(/<div class="modal-overlay"[\s\S]*?<\/section>\s*<\/div>/g)].map(match => match[0]);
  assert.ok(overlays.length >= 9, 'expected all modal overlays to be discoverable');
  for (const overlay of overlays) {
    assert.match(overlay, /role="dialog"/);
    assert.match(overlay, /aria-modal="true"/);
    assert.match(overlay, /aria-(?:label|labelledby)="[^"]+"/);
    assert.match(overlay, /<(?:button|input|select)\b/);
  }
  assert.match(app, /button:not\(\[disabled\]\), input:not\(\[disabled\]\), select:not\(\[disabled\]\)/);
  assert.match(app, /e\.shiftKey && document\.activeElement === focusable\[0\]/);
});

test('release manifest keeps least privilege and contains no remote executable code', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'favicon', 'storage', 'tabGroups', 'tabs']);
  assert.deepEqual(manifest.host_permissions, ['https://license.tabout.app/*']);
  assert.equal('activeTab' in manifest.permissions, false);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(`${html}\n${app}\n${background}`, /\beval\s*\(|new Function\s*\(/);
});

test('conditional encrypted sync cannot be sold by the checked-in release configuration', () => {
  assert.match(entitlementConfig, /TAB_OUT_CHECKOUT_URLS\s*=\s*\{\s*pro_lifetime:\s*'',\s*sync:\s*''\s*\}/);
  assert.match(i18n, /settings\.syncDeferred/);
});
