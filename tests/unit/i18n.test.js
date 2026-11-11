'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
function harness({ languages = ['en'], primary = languages[0], chromeLanguage = 'en', stored = {}, readError = false, writeError = false } = {}) {
  const writes = [];
  const html = { lang: '' };
  const context = vm.createContext({ navigator: { languages, language: primary }, document: { documentElement: html }, module: { exports: {} },
    chrome: { i18n: { getUILanguage: () => chromeLanguage }, storage: { local: {
      async get() { if (readError) throw new Error('Read unavailable'); return stored; },
      async set(value) { if (writeError) throw new Error('Write unavailable'); writes.push(value); Object.assign(stored, value); },
    } } },
  });
  for (const file of ['extension/locales/zh-TW.js', 'extension/locales/ja.js', 'extension/i18n.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { ...context.module.exports, context, writes, stored, html };
}

test('auto language follows preference order, regional variants and explicit Chinese scripts', async () => {
  for (const [languages, expected] of [
    [['en', 'zh-CN'], 'en'], [['ja-JP', 'en'], 'ja'], [['zh-TW'], 'zh-TW'], [['zh-HK'], 'zh-TW'],
    [['zh-MO'], 'zh-TW'], [['zh-Hant-CN'], 'zh-TW'], [['zh-Hans-TW'], 'zh-CN'], [['zh-SG'], 'zh-CN'],
    [['de-DE', 'ja-JP'], 'ja'], [['fr-FR', 'de-DE'], 'en'],
  ]) {
    const h = harness({ languages }); await h.TabOutI18n.ready;
    assert.equal(h.TabOutI18n.locale, expected, languages.join(','));
    assert.equal(h.html.lang, expected);
  }
});

test('auto language falls back to primary navigator then Chrome language and English', async () => {
  for (const [primary, chromeLanguage, expected] of [['ja-JP', 'en', 'ja'], ['fr', 'zh-Hant', 'zh-TW'], ['fr', 'fr', 'en']]) {
    const h = harness({ languages: [], primary, chromeLanguage }); await h.TabOutI18n.ready;
    assert.equal(h.TabOutI18n.locale, expected);
  }
});

test('stored manual language wins on first initialization and invalid or unreadable preferences recover', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja']) {
    const h = harness({ languages: ['ja'], stored: { interfaceLanguageV1: locale } }); await h.TabOutI18n.ready;
    assert.equal(h.TabOutI18n.locale, locale); assert.equal(h.TabOutI18n.preference, locale);
  }
  for (const value of [null, 'de', {}, ['ja'], '__proto__']) {
    const h = harness({ languages: ['ja'], stored: { interfaceLanguageV1: value } }); await h.TabOutI18n.ready;
    assert.equal(h.TabOutI18n.preference, 'auto'); assert.equal(h.TabOutI18n.locale, 'ja');
  }
  const h = harness({ languages: ['zh-TW'], readError: true }); await h.TabOutI18n.ready;
  assert.equal(h.TabOutI18n.locale, 'zh-TW');
});

test('successful language selection saves only its preference and waits for in-place subscribers', async () => {
  const h = harness({ stored: { deferred: [{ title: 'Untouched' }] } }); await h.TabOutI18n.ready;
  let notified;
  const unsubscribe = h.TabOutI18n.onChange(async locale => { await Promise.resolve(); notified = locale; });
  await h.TabOutI18n.setLanguage('ja');
  assert.equal(notified, 'ja'); assert.equal(h.html.lang, 'ja');
  assert.equal(JSON.stringify(h.writes), JSON.stringify([{ interfaceLanguageV1: 'ja' }]));
  assert.deepEqual(h.stored.deferred, [{ title: 'Untouched' }]);
  unsubscribe(); await h.TabOutI18n.setLanguage('auto');
  assert.equal(h.TabOutI18n.locale, 'en'); assert.equal(notified, 'ja');
});

test('failed saving keeps the previous language and a later retry can succeed', async () => {
  const h = harness({ stored: { interfaceLanguageV1: 'zh-CN' }, writeError: true }); await h.TabOutI18n.ready;
  let calls = 0; h.TabOutI18n.onChange(() => calls++);
  await assert.rejects(h.TabOutI18n.setLanguage('ja'), /Write unavailable/);
  assert.equal(h.TabOutI18n.locale, 'zh-CN'); assert.equal(h.TabOutI18n.preference, 'zh-CN');
  assert.equal(h.html.lang, 'zh-CN'); assert.equal(calls, 0);
  h.context.chrome.storage.local.set = async value => h.writes.push(value);
  await h.TabOutI18n.setLanguage('ja'); assert.equal(h.TabOutI18n.locale, 'ja'); assert.equal(calls, 1);
});

test('queued rapid selections retain selection order and recover after a failed save', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  let calls = 0;
  h.context.chrome.storage.local.set = async () => { if (++calls === 1) throw new Error('First failed'); };
  const first = h.TabOutI18n.setLanguage('zh-TW');
  const second = h.TabOutI18n.setLanguage('ja');
  await assert.rejects(first, /First failed/); await second;
  assert.equal(h.TabOutI18n.preference, 'ja'); assert.equal(h.TabOutI18n.locale, 'ja');
});

test('all four complete dictionaries have matching keys and placeholders without English merge', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  const dictionaries = h.I18N_LOCALES;
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'ja', 'zh-CN', 'zh-TW']);
  const keys = Object.keys(dictionaries.en).sort();
  assert.ok(keys.length >= 578);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const locale of Object.keys(dictionaries)) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof dictionaries[locale][key], 'string', `${locale}:${key}`);
      assert.ok(dictionaries[locale][key].trim(), `${locale}:${key} must not be empty`);
      assert.deepEqual(placeholders(dictionaries[locale][key]), placeholders(dictionaries.en[key]), `${locale}:${key}`);
    }
  }
});

test('plural selection uses locale rules and preserves interpolation and safe fallback', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja']) {
    await h.TabOutI18n.setLanguage(locale);
    for (const n of [0, 1, 2]) {
      const key = new Intl.PluralRules(locale).select(n) === 'one' ? 'label.item' : 'label.items';
      assert.equal(h.tPlural('label.item', 'label.items', n), h.t(key, { n }));
    }
    assert.equal(h.t('missing.key'), 'missing.key');
    assert.equal(h.t('constructor'), 'constructor');
    assert.equal(h.t('memory.selected', { n: '<test>' }), h.I18N_LOCALES[locale]['memory.selected'].replace('{n}', '<test>'));
    assert.ok(h.t('memory.selected').includes('{n}'));
  }
  delete h.I18N_LOCALES.ja['memory.selected'];
  assert.equal(h.t('memory.selected', { n: 2 }), '2 selected');
});

test('dates use the selected interface locale and captured UI descriptors can be translated again', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  const descriptor = h.TabOutI18n.describeTranslation(h.t('memory.searchComplete', { n: 2 }));
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja']) {
    await h.TabOutI18n.setLanguage(locale);
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    assert.equal(h.TabOutI18n.formatDate('2026-11-04T00:00:00Z', options), new Intl.DateTimeFormat(locale, options).format(new Date('2026-11-04T00:00:00Z')));
    assert.equal(h.TabOutI18n.translateDescriptor(descriptor), h.t('memory.searchComplete', { n: 2 }));
  }
});


test('literal UI translation calls resolve in every supported language, including result checkbox labels', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? files(file) : file.endsWith('.js') ? [file] : [];
    });
  }
  const sources = [path.join(root, 'extension/app.js'), ...files(path.join(root, 'extension/src/ui'))];
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:t|tr)\(\s*['"]([^'"]+)['"]/g)) {
      for (const [locale, dictionary] of Object.entries(h.I18N_LOCALES)) assert.ok(Object.hasOwn(dictionary, match[1]), `${path.relative(root, file)}: ${locale} missing ${match[1]}`);
    }
  }
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja']) {
    await h.TabOutI18n.setLanguage(locale);
    const label = h.t('memory.selectResult', { title: 'Original user title' });
    assert.ok(label.includes('Original user title'));
    assert.ok(!label.includes('memory.selectResult'));
  }
});


test('project backup and preview failures retranslate without retrying the business action', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, handlers: {}, style: { display: 'none' }, options: [{}, {}],
      textContent: '', value: '', dataset: {}, classList: { toggle() {} },
      setAttribute() {}, querySelectorAll: () => [], closest: () => null,
      addEventListener(event, handler) { this.handlers[event] = handler; },
    });
    return nodes.get(id);
  };
  const doc = { getElementById: node, documentElement: { lang: 'en' }, querySelectorAll: () => [], activeElement: null };
  let exports = 0; let previews = 0;
  const context = vm.createContext({ document: doc, TabOutI18n: h.TabOutI18n, TabOutCore: {
    normalizeWebUrl: value => value, escapeHtml: value => String(value),
  } });
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/src/ui/project-workbench.js'), 'utf8'), context);
  const api = context.TabOutCore.createProjectWorkbench({
    document: doc, translate: h.t, workspaceRepository: { list: async () => [] },
    chromeApi: { tabs: { query: async () => [] }, windows: { getCurrent: async () => ({ id: 1 }) },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } },
    service: { async previewSave() { previews++; throw Object.assign(new Error('Limit'), { code: 'workspace_limit' }); } },
    async exportBackup() { exports++; throw new Error('Export failed'); },
  });
  await node('projectBackupBtn').handlers.click();
  assert.equal(node('projectMainStatus').textContent, h.t('project.backupFailed'));
  await h.TabOutI18n.setLanguage('ja');
  assert.equal(node('projectMainStatus').textContent, h.t('project.backupFailed'));
  assert.equal(exports, 1);
  await api.begin('save');
  assert.equal(node('projectMainStatus').textContent, h.t('project.error.workspace_limit'));
  await h.TabOutI18n.setLanguage('zh-TW');
  assert.equal(node('projectMainStatus').textContent, h.t('project.error.workspace_limit'));
  assert.equal(previews, 1); assert.equal(exports, 1);
});

test('upgrade status reuses the known plan when its language changes', async () => {
  const h = harness(); await h.TabOutI18n.ready;
  const app = fs.readFileSync(path.join(root, 'extension/app.js'), 'utf8');
  const start = app.indexOf('let upgradeStatusPlan = null;');
  const end = app.indexOf('let pendingRestoreSessionId', start);
  const status = { textContent: '' };
  const context = vm.createContext({ document: { getElementById: () => status }, t: h.t });
  vm.runInContext(app.slice(start, end), context);
  for (const plan of ['free', 'pro_lifetime']) {
    context.renderUpgradeStatus(plan);
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja']) {
      await h.TabOutI18n.setLanguage(locale); context.renderUpgradeStatus();
      assert.equal(status.textContent, h.t(plan === 'free' ? 'upgrade.freeStatus' : 'upgrade.activeStatus', { plan }));
      assert.ok(!status.textContent.includes('{plan}'));
    }
  }
});
