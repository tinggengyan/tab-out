(function initBrowsingMemoryText(scope) {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const wordChar = /[\p{L}\p{N}]/u;
  function codePointBefore(text, index) {
    if (index <= 0) return '';
    const start = index > 1 && /[\uDC00-\uDFFF]/u.test(text[index - 1]) ? index - 2 : index - 1;
    return String.fromCodePoint(text.codePointAt(start));
  }
  function termsFrom(value) {
    const text = normalize(value).trim();
    const words = wordSegmenter ? [...wordSegmenter.segment(text)].filter(item => item.isWordLike).map(item => item.segment)
      : text.match(/[\p{L}\p{N}]+/gu) || [];
    return [...new Set(words.filter(word => word.length > 1 || word === text))].slice(0, 80);
  }
  // The display/search view is disposable. Stored text remains untouched for exact citations.
  function cleanMemoryText(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t\f\v \u00a0]+/g, ' ').trim());
    const chromeLine = /^(?:home|homepage|menu|navigation|sign\s*(?:in|up|out)|log\s*(?:in|out)|recommend(?:ation(?:s)?|ed articles)|related (?:articles|posts)|all rights reserved[.!]?|copyright(?:\s+.*)?|©.*|首页|主頁|首頁|菜单|菜單|导航|導航|登录|登入|注册|註冊|相关推荐|相關推薦|推荐阅读|推薦閱讀|ホーム|メニュー|ログイン|会員登録|おすすめ記事)$/iu;
    const navStart = /^(?:navigation|related (?:articles|posts)|recommended articles|导航|導航|相关推荐|相關推薦|おすすめ記事)$/iu;
    // Recognize a trailing link cluster only with multiple navigation markers, never by site/class names.
    let tailStart = -1, markers = 0;
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index], marker = chromeLine.test(line);
      if (line && !marker && (line.length > 60 || /[.!?。！？]/u.test(line))) break;
      if (marker) markers++;
      if (markers >= 2 && navStart.test(line)) tailStart = index;
    }
    const useful = (tailStart < 0 ? lines : lines.slice(0, tailStart)).filter(line => !chromeLine.test(line));
    const parts = [];
    let previous = '', paragraphBreak = false;
    for (const line of useful) {
      if (!line) { if (parts.length) paragraphBreak = true; continue; }
      const first = String.fromCodePoint(line.codePointAt(0));
      const separator = !parts.length ? '' : paragraphBreak ? '\n\n' : /[，。！？、；：,.!?;:)}\]）】]/u.test(first)
        || (cjk.test(previous) && cjk.test(first)) ? '' : ' ';
      parts.push(separator, line);
      previous = codePointBefore(line, line.length);
      paragraphBreak = false;
    }
    return parts.join('').trim();
  }

  function normalizedOffsets(value) {
    const original = String(value || '');
    function* fallbackSegments() {
      for (const match of original.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) yield { segment: match[0], index: match.index };
    }
    const pieces = graphemes ? graphemes.segment(original) : fallbackSegments();
    let text = ''; const starts = [], ends = [];
    for (const item of pieces) {
      const part = normalize(item.segment);
      for (let index = 0; index < part.length; index++) { starts.push(item.index); ends.push(item.index + item.segment.length); }
      text += part;
    }
    return { text, starts, ends };
  }
  function rangesFor(value, terms, { url = false, offsets = true } = {}) {
    const mapped = offsets ? normalizedOffsets(value) : { text: normalize(value) }, ranges = [];
    for (const raw of terms) {
      const term = normalize(raw).trim();
      if (!term) continue;
      const explicitURL = url && /(?:https?:\/\/|[\p{L}\p{N}-]+\.[\p{L}]{2,}(?:[/:?#]|$))/u.test(term);
      const termCharacters = Array.from(term), first = termCharacters[0], last = termCharacters.at(-1);
      const startsWord = wordChar.test(first) && !cjk.test(first);
      const endsWord = wordChar.test(last) && !cjk.test(last);
      let from = 0, count = 0;
      while (from < mapped.text.length && count < 100) {
        const index = mapped.text.indexOf(term, from);
        if (index < 0) break;
        const end = index + term.length;
        const before = codePointBefore(mapped.text, index);
        const after = end < mapped.text.length ? String.fromCodePoint(mapped.text.codePointAt(end)) : '';
        // Non-CJK words require real token boundaries; AI must not match baike, paid or trail.
        if (explicitURL || ((!startsWord || !wordChar.test(before) || cjk.test(before)) && (!endsWord || !wordChar.test(after) || cjk.test(after)))) {
          ranges.push({ start: offsets ? mapped.starts[index] : index, end: offsets ? mapped.ends[end - 1] : end, term });
          count++;
          if (!offsets) break;
        }
        from = end;
      }
    }
    return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  function snippetParts(text, terms) {
    const ranges = rangesFor(text, terms), merged = [];
    for (const range of ranges) {
      const prior = merged.at(-1);
      if (prior && prior.end >= range.start) prior.end = Math.max(prior.end, range.end);
      else merged.push({ ...range });
    }
    const parts = []; let cursor = 0;
    for (const range of merged) {
      if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), match: false });
      parts.push({ text: text.slice(range.start, range.end), match: true }); cursor = range.end;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
    return parts;
  }
  function snippetFor(value, terms, maxLength = 240) {
    const text = cleanMemoryText(value).replace(/\s+/gu, ' ').trim();
    if (!text) return { snippet: '', snippetParts: [] };
    const first = rangesFor(text, terms)[0];
    let start = Math.max(0, (first?.start || 0) - 55);
    if (start > 0) {
      const near = text.slice(start, start + 35).search(/\s/u);
      if (near >= 0 && start + near < (first?.start || 0)) start += near + 1;
      if (/[\uDC00-\uDFFF]/u.test(text[start])) start++;
    }
    const prefix = start ? '…' : '';
    const budget = maxLength - prefix.length;
    let end = Math.min(text.length, start + budget - (text.length > start + budget ? 1 : 0));
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    const snippet = prefix + text.slice(start, end).trim() + (end < text.length ? '…' : '');
    return { snippet, snippetParts: snippetParts(snippet, terms) };
  }
  const api = { memorySearchTerms: termsFrom, cleanMemoryText, memoryMatchRanges: rangesFor, memorySnippet: snippetFor, normalizeMemorySearch: normalize };
  scope.TabOutCore = Object.assign(scope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
