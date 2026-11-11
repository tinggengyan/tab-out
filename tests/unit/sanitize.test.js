'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, normalizeWebUrl } = require('../../extension/lib/sanitize.js');

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(escapeHtml('<img src=x onerror="a">\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&#39;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('normalizeWebUrl accepts only http and https', () => {
  assert.equal(normalizeWebUrl(' https://example.com/a '), 'https://example.com/a');
  assert.equal(normalizeWebUrl('javascript:alert(1)'), null);
  assert.equal(normalizeWebUrl('chrome://settings'), null);
  assert.equal(normalizeWebUrl(42), null);
});
