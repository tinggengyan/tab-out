(function browsingMemoryContent(scope) {
  'use strict';
  function extractBrowsingMemory(document, maxLength = 30000) {
    // Traverse rendered reading content, not editable state. Forum replies remain ordinary blocks.
    const skip = 'script,style,noscript,template,nav,header,footer,aside,form,input,textarea,select,button,[contenteditable],[role="textbox"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="search"],[role="menu"],[role="toolbar"],[hidden],[aria-hidden="true"]';
    const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TR', 'FIGCAPTION']);
    const limit = Math.max(0, Math.min(Number(maxLength) || 0, 30000));
    if (!limit || String(document.designMode).toLowerCase() === 'on') return { text: '', truncated: false };
    function excluded(element) {
      if (element.matches(skip) || element.isContentEditable) return true;
      const style = scope.getComputedStyle?.(element);
      return Boolean(style && (style.display === 'none' || /^(?:hidden|collapse)$/.test(style.visibility)));
    }
    const root = document.body;
    if (!root) return { text: '', truncated: false };
    for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
      if (excluded(ancestor)) return { text: '', truncated: false };
    }
    const parts = [];
    let buffer = '', length = 0, visited = 0, truncated = false;
    function flush() {
      const value = buffer.replace(/\s+/gu, ' ').trim(); buffer = '';
      if (!value) return;
      const separator = parts.length ? 2 : 0;
      const remaining = limit - length - separator;
      if (remaining <= 0) { truncated = true; return; }
      let piece = value.slice(0, remaining);
      if (/[\uD800-\uDBFF]/u.test(piece.at(-1))) piece = piece.slice(0, -1);
      if (piece) { parts.push(piece); length += separator + piece.length; }
      if (piece.length < value.length) truncated = true;
    }
    function walk(node) {
      if (++visited > 15000) { truncated = true; return; }
      if (length >= limit || truncated) return;
      if (node.nodeType === 3) {
        // Bound the buffer too: a single huge text node must not defeat the capture limit.
        const value = String(node.nodeValue || '');
        const remaining = limit + 1 - buffer.length;
        buffer += value.slice(0, remaining);
        if (buffer.length > limit || value.length > remaining) { flush(); truncated = true; }
        return;
      }
      if (node.nodeType !== 1 || excluded(node)) return;
      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') { flush(); return; }
      const block = blocks.has(tag);
      if (block) flush();
      for (let index = 0; index < node.childNodes.length; index++) {
        walk(node.childNodes[index]);
        if (truncated || length >= limit) {
          if (index + 1 < node.childNodes.length) truncated = true;
          break;
        }
      }
      if (block) flush();
    }
    walk(root); flush();
    return { text: parts.join('\n\n'), truncated: truncated || visited > 15000 };
  }
  if (typeof module !== 'undefined') module.exports = { extractBrowsingMemory };
  if (!scope.document || !scope.chrome?.runtime || scope.top !== scope) return;
  if (scope.__tabOutMemoryCapture) { scope.__tabOutMemoryCapture.start(); return; }
  let active = false;
  let timer;
  let observer;
  let fingerprint = '';
  let lastSent = 0;
  const documentStartedAt = performance.timeOrigin || Date.now();
  async function capture() {
    timer = null;
    if (!active || document.visibilityState !== 'visible' || !/^https?:$/.test(location.protocol)) return;
    const extracted = extractBrowsingMemory(document);
    const next = location.href + '\n' + document.title + '\n' + extracted.text;
    if (next === fingerprint && Date.now() - lastSent < 60000) return;
    fingerprint = next;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'browsing-memory-capture', payload: {
        url: location.href, title: document.title, ...extracted, documentStartedAt,
      } });
      lastSent = Date.now();
      if (result?.ok && result.data?.recording === false) stop();
    } catch { stop(); }
  }
  function schedule() {
    if (!active || timer) return;
    timer = setTimeout(capture, 1200);
  }
  function stop() {
    active = false;
    clearTimeout(timer);
    timer = null;
    observer?.disconnect();
  }
  function start() {
    if (active) return;
    active = true;
    fingerprint = '';
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  document.addEventListener('visibilitychange', schedule);
  scope.addEventListener('popstate', schedule);
  scope.addEventListener('hashchange', schedule);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'browsing-memory-stop') stop();
  });
  scope.__tabOutMemoryCapture = { start, stop };
  start();
})(typeof globalThis !== 'undefined' ? globalThis : self);
