'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, 'extension', file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('index.html');
const ORIGINAL_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6xQrQfiVeE5u4U4hrm5S6HRw6UldPTYWbN2CywC6xghlQvTX5Yp7y1d7P88Wgo6ueexVbK7T5LIrYht7W8VJLDcMcF2CpbU/fzVIvQcXVkPk1xmRCkuu/XdZmHu1XAMisCjADK5K8BkBk5SLZDyiaUP43lzhfNHqNSst2ivLABmWOynTaI2OTdFQKIEV8suS/dOUxhVod9AQkfj6Ce82Bm2NUa/jHM0cW9P+Ptb/+CUFXbDIW7pselyVS4GNcED9pWShWTKZ9EDSh3BIBrPer4afQjQEGbTVtBzTyRbAMLsEtpmu+mXNDeeESoo1k+GrkrE9hJ1NgSfuTHcjn3yqbQIDAQAB';

test('manifest keeps the original key and only the three core permissions', () => {
  assert.deepEqual(manifest.permissions, ['tabs', 'storage', 'favicon']);
  // Search asks for these only when the user turns it on (owner decision, 2026-11-12).
  assert.deepEqual(manifest.optional_permissions, ['history', 'bookmarks']);
  for (const field of ['host_permissions', 'optional_host_permissions', 'omnibox']) {
    assert.equal(manifest[field], undefined, `${field} must not be declared`);
  }
  assert.equal(manifest.version, '3.0.0');
  // The public key from the original fork (40579ec). It fixes the extension ID, so users keep
  // their storage. Inlined so the test also works in a shallow CI checkout.
  assert.equal(manifest.key, ORIGINAL_KEY);
});

test('one browser-level shortcut opens search, even from a new tab whose cursor is in the address bar', () => {
  // Owner decision, 2026-11-13. A page cannot hear keys while the address bar has them, so this
  // is a manifest command. It needs no permission; users can change the key in chrome://extensions/shortcuts.
  assert.deepEqual(manifest.commands, {
    'open-search': {
      suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
      description: '__MSG_commandSearch__',
    },
  });
  for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
    assert.ok(messages.commandSearch?.message, `_locales/${locale} names the search shortcut`);
  }
  assert.match(read('background.js'), /chrome\.commands\.onCommand\.addListener\(/);
});

test('every local script and stylesheet referenced by the page exists', () => {
  const refs = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g),
    ...html.matchAll(/<link[^>]+href=["']([^"']+)["']/g),
  ].map(match => match[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    assert.equal(fs.existsSync(path.join(root, 'extension', ref)), true, `missing ${ref}`);
  }
});

test('every literal getElementById (or searchEl) in app.js resolves to static markup', () => {
  const app = read('app.js');
  const ids = [...new Set([...app.matchAll(/(?:getElementById|searchEl)\(['"]([^'"]+)['"]\)/g)].map(match => match[1]))];
  const missing = ids.filter(id => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});

const EXTERNAL_RESOURCE = /<script[^>]+src=["']https?:|<link[^>]+href=["']https?:|@import\s+url\(["']?https?:|url\(["']?https?:|s2\/favicons/;

test('page markup, styles and scripts reference no external resources', () => {
  for (const file of ['index.html', 'style.css', 'app.js', 'i18n.js']) {
    assert.doesNotMatch(read(file), EXTERNAL_RESOURCE, `${file} loads an external resource`);
  }
});

test('page markup has no inline event handler attributes', () => {
  assert.doesNotMatch(html, /\son[a-z]+=["']/i);
});

test('the page loads the lib modules before app.js', () => {
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  const app = scripts.indexOf('app.js');
  for (const lib of ['lib/sanitize.js', 'lib/grouping.js']) {
    assert.ok(scripts.includes(lib), `${lib} is not loaded`);
    assert.ok(scripts.indexOf(lib) < app, `${lib} must load before app.js`);
  }
});

test('app.js closes user tabs only through the undo controller', () => {
  const app = read('app.js');
  const direct = [...app.matchAll(/chrome\.tabs\.remove\(/g)].length;
  // The single allowed direct call closes extra copies of Tab Out itself.
  assert.equal(direct, 1, 'only closeTabOutDupes may call chrome.tabs.remove directly');
  assert.match(app, /createUndoController\(/);
  assert.match(html, /id="toastAction"/);
});

test('stash records use the collected store and migrate before the first render', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /storage\.local\.(get|set)\(\s*\{?\s*['"]?tabGroups/, 'app.js must not read or write the legacy tabGroups key');
  assert.match(app, /createCollectedStore\(chrome\.storage\.local\)/);
  const init = app.slice(app.lastIndexOf('INITIALIZE'));
  assert.ok(init.indexOf('migrateLegacy(') !== -1 && init.indexOf('migrateLegacy(') < init.indexOf('renderDashboard('),
    'migrateLegacy must run before the first renderDashboard');
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('lib/collected-store.js') !== -1 && scripts.indexOf('lib/collected-store.js') < scripts.indexOf('app.js'));
  assert.ok(html.indexOf('id="deferredColumn"') < html.indexOf('id="tabGroupsColumn"'), 'save-for-later sits above the stash, so a long stash cannot push it off screen');
});

test('import and export go through config-io and never touch the legacy tabGroups key', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /['"]tabGroups['"]/, 'app.js must not name the legacy tabGroups key');
  assert.match(app, /parseImport\(/);
  assert.match(app, /buildExport\(/);
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('lib/collected-store.js') < scripts.indexOf('lib/config-io.js'), 'config-io depends on collected-store');
  assert.ok(scripts.indexOf('lib/config-io.js') !== -1 && scripts.indexOf('lib/config-io.js') < scripts.indexOf('app.js'));
});

test('the open-tabs view follows tab changes in other windows', () => {
  const app = read('app.js');
  assert.match(app, /createRefreshScheduler\(/);
  for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onReplaced']) {
    assert.match(app, new RegExp(`chrome\\.tabs\\.${event}\\.addListener\\(`), `app.js must listen to chrome.tabs.${event}`);
  }
  assert.match(app, /addEventListener\('visibilitychange'/, 'a hidden page catches up when shown again');
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('lib/live-refresh.js') !== -1 && scripts.indexOf('lib/live-refresh.js') < scripts.indexOf('app.js'));
});

test('search reads bookmarks and history but never changes them', () => {
  const scripts = ['app.js', 'background.js', ...fs.readdirSync(path.join(root, 'extension/lib')).map(file => `lib/${file}`)];
  for (const file of scripts) {
    assert.doesNotMatch(read(file), /chrome\.bookmarks\.(create|update|move|remove|removeTree)\(/, `${file} must not change bookmarks`);
    assert.doesNotMatch(read(file), /chrome\.history\.(addUrl|deleteUrl|deleteRange|deleteAll)\(/, `${file} must not change history`);
  }
  const app = read('app.js');
  const requests = [...app.matchAll(/chrome\.permissions\.request\(/g)].length;
  assert.equal(requests, 1, 'permissions are requested in one place, when the user turns on bookmarks and history');
  // Chrome has no switch for optional API permissions, so the overlay gives them back itself (owner decision, 2026-11-13).
  const removals = [...app.matchAll(/chrome\.permissions\.remove\(([^)]*)\)/g)].map(match => match[1]);
  assert.deepEqual(removals, ['SEARCH_PERMISSIONS'], 'permissions are given back in one place, when the user turns them off');
  assert.match(app, /permissions: \['history', 'bookmarks'\]/);
  assert.match(html, /<button[^>]+id="searchRevokeBtn"/);
});

test('the search overlay is static markup, hidden until opened, loaded after its helpers', () => {
  assert.match(html, /<button[^>]+id="searchTrigger"/);
  assert.match(html, /<div[^>]+id="searchOverlay"[^>]*\shidden/);
  assert.match(html, /<input[^>]+id="searchInput"[^>]+role="combobox"/);
  assert.match(html, /id="searchResults"[^>]+role="listbox"/);
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('lib/sanitize.js') < scripts.indexOf('lib/search.js'), 'search depends on sanitize');
  assert.ok(scripts.indexOf('lib/search.js') !== -1 && scripts.indexOf('lib/search.js') < scripts.indexOf('app.js'));
  assert.match(read('style.css'), /\.search-overlay\[hidden\]\s*\{\s*display:\s*none/, 'the overlay rule must not override [hidden]');
});
