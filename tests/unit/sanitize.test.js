'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, normalizeWebUrl } = require('../../extension/src/shared/sanitize.js');

test('escapeHtml neutralizes markup and attribute delimiters', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)"> & \'quoted\''),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;'
  );
});

test('escapeHtml safely handles nullish values', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('normalizeWebUrl accepts http and https URLs', () => {
  assert.equal(normalizeWebUrl(' https://example.com/path '), 'https://example.com/path');
  assert.equal(normalizeWebUrl('http://localhost:3000/'), 'http://localhost:3000/');
});

test('normalizeWebUrl rejects executable and unsupported protocols', () => {
  assert.equal(normalizeWebUrl('javascript:alert(1)'), null);
  assert.equal(normalizeWebUrl('data:text/html,bad'), null);
  assert.equal(normalizeWebUrl('chrome://settings'), null);
  assert.equal(normalizeWebUrl('not a url'), null);
});
