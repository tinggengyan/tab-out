'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../extension/i18n.js'), 'utf8');

function loadLocales(languages = ['en-US']) {
  const context = vm.createContext({
    navigator: { languages, language: languages[0] },
    chrome: { i18n: { getUILanguage: () => languages[0] } },
  });
  vm.runInContext(`${source}\n;globalThis.__out = { I18N_LOCALES, t, tPlural, locale: _currentLocale };`, context);
  return context.__out;
}

const { I18N_LOCALES } = loadLocales();
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('en and zh-CN have identical keys', () => {
  const en = Object.keys(I18N_LOCALES.en).sort();
  const zh = Object.keys(I18N_LOCALES['zh-CN']).sort();
  assert.deepEqual(zh.filter(key => !en.includes(key)), [], 'keys only in zh-CN');
  assert.deepEqual(en.filter(key => !zh.includes(key)), [], 'keys only in en');
});

test('placeholders match per key', () => {
  for (const key of Object.keys(I18N_LOCALES.en)) {
    const zh = I18N_LOCALES['zh-CN'][key];
    if (zh === undefined) continue;
    // Chinese has no plural forms, so a plural key may legitimately drop {n} only if English also lacks it.
    assert.deepEqual(placeholders(zh), placeholders(I18N_LOCALES.en[key]), `placeholder mismatch for ${key}`);
  }
});

test('new copy exists', () => {
  for (const key of ['btn.closeAllShort', 'btn.collect', 'btn.dedupShort', 'btn.dedupAll', 'btn.undo', 'confirm.closeAll', 'collected.title', 'toast.undone']) {
    for (const locale of ['en', 'zh-CN']) {
      assert.equal(typeof I18N_LOCALES[locale][key], 'string', `${locale} is missing ${key}`);
    }
  }
});

test('Chinese browsers get zh-CN copy', () => {
  const { t, locale } = loadLocales(['zh-CN', 'en']);
  assert.equal(locale, 'zh-CN');
  assert.equal(t('btn.collect'), I18N_LOCALES['zh-CN']['btn.collect']);
});
