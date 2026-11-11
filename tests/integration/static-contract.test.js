'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, 'extension', file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('index.html');

test('manifest keeps the original key and only the three core permissions', () => {
  assert.deepEqual(manifest.permissions, ['tabs', 'storage', 'favicon']);
  for (const field of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'commands', 'omnibox']) {
    assert.equal(manifest[field], undefined, `${field} must not be declared`);
  }
  assert.equal(manifest.version, '3.0.0');
  const original = JSON.parse(execFileSync('git', ['show', '40579ec:extension/manifest.json'], { cwd: root, encoding: 'utf8' }));
  assert.equal(manifest.key, original.key);
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

test('every literal getElementById in app.js resolves to static markup', () => {
  const app = read('app.js');
  const ids = [...new Set([...app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]))];
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
