'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractBrowsingMemory } = require('../../extension/src/content/browsing-memory-content.js');
function element(tag, attrs = {}, ...children) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), attrs, childNodes: children.flat().map(child => typeof child === 'string' ? { nodeType: 3, nodeValue: child } : child),
    matches(selector) { return selector.split(',').some(part => {
      const attr = part.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);
      return attr ? Object.hasOwn(attrs, attr[1]) && (!attr[2] || attrs[attr[1]] === attr[2]) : tag.toLowerCase() === part;
    }); } };
  node.childNodes.forEach(child => { child.parentElement = node; });
  return node;
}
function documentOf(...children) { return { body: element('body', {}, ...children), designMode: 'off' }; }

test('extracts complete reading blocks and inline text without a newline per span', () => {
  const doc = documentOf(element('article', {}, element('h1', {}, 'A reading note'), element('p', {}, 'This ', element('strong', {}, 'important'), ' paragraph ', element('a', {}, 'has a link'), '.'), element('p', {}, '第二段', element('span', {}, '正文。'))));
  assert.deepEqual(extractBrowsingMemory(doc), { text: 'A reading note\n\nThis important paragraph has a link.\n\n第二段正文。', truncated: false });
});

test('keeps forum replies and signed-in reading content outside the first article', () => {
  const doc = documentOf(element('main', {}, element('article', {}, element('p', {}, 'An original fountain pen review.'))), element('section', { class: 'comments' }, element('article', {}, element('p', {}, 'Alice: a fine nib works well.')), element('div', { class: 'reply' }, 'Bob: bottled ink is my preference.')));
  const text = extractBrowsingMemory(doc).text;
  assert.match(text, /original fountain pen/);
  assert.match(text, /Alice: a fine nib/);
  assert.match(text, /Bob: bottled ink/);
});

test('does not read form values, editor drafts, navigation or hidden descendants', () => {
  const doc = documentOf(element('nav', {}, 'NAV SECRET'), element('div', { role: 'navigation' }, 'MENU SECRET'),
    element('form', {}, element('p', {}, 'FORM SECRET'), element('input', { value: 'VALUE SECRET' })),
    element('textarea', {}, 'TEXTAREA SECRET'), element('select', {}, 'SELECT SECRET'), element('button', {}, 'BUTTON SECRET'),
    element('div', { contenteditable: 'true' }, element('p', {}, 'DRAFT SECRET'), element('div', { contenteditable: 'false' }, 'NESTED DRAFT SECRET')),
    element('div', { role: 'textbox' }, 'ARIA DRAFT SECRET'), element('p', { hidden: '' }, 'HIDDEN SECRET'),
    element('section', { 'aria-hidden': 'true' }, element('p', {}, 'ARIA HIDDEN SECRET')),
    element('footer', {}, 'FOOTER SECRET'), element('article', {}, element('p', {}, 'Visible reading content.')));
  assert.equal(extractBrowsingMemory(doc).text, 'Visible reading content.');
  doc.designMode = 'on';
  assert.equal(extractBrowsingMemory(doc).text, '');
});

test('respects computed hidden styles and ancestor exclusion', () => {
  const original = global.getComputedStyle;
  global.getComputedStyle = node => ({ display: node.attrs?.style === 'hidden' ? 'none' : 'block', visibility: 'visible' });
  try {
    const doc = documentOf(element('div', { style: 'hidden' }, element('p', {}, 'PRIVATE')), element('p', {}, 'Public note.'));
    assert.equal(extractBrowsingMemory(doc).text, 'Public note.');
  } finally { if (original) global.getComputedStyle = original; else delete global.getComputedStyle; }
});

test('bounds captured content, marks truncation and never leaves a broken surrogate pair', () => {
  const extracted = extractBrowsingMemory(documentOf(element('p', {}, 'x'.repeat(99) + '😀'.repeat(200))), 100);
  assert.equal(extracted.text.length, 99);
  assert.equal(extracted.truncated, true);
  const blocks = extractBrowsingMemory(documentOf(element('p', {}, 'abc'), element('p', {}, 'defghijkl')), 8);
  assert.equal(blocks.text, 'abc\n\ndef');
  assert.equal(blocks.truncated, true);
});
