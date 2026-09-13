(function initPlatformSearchService(globalScope) {
  'use strict';

  const MAX_PLATFORMS = 100;
  const MAX_ALIASES = 20;
  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

  function fail(field, message) {
    throw new Error(`${field}: ${message}`);
  }

  function normalizeCommand(value) {
    return String(value).normalize('NFKC').trim().toLowerCase();
  }

  function normalizeText(value, field, maxLength, options = {}) {
    if (typeof value !== 'string') fail(field, 'must be a string');
    const normalized = value.normalize('NFKC').trim();
    if (!options.allowEmpty && !normalized) fail(field, 'is required');
    if (normalized.length > maxLength) fail(field, `must be at most ${maxLength} characters`);
    if (CONTROL_CHARACTERS.test(normalized)) fail(field, 'must not contain control characters');
    return normalized;
  }

  function normalizeDomain(value, field) {
    const input = normalizeText(value, field, 253).toLowerCase();
    if (/[/\\%@?#:\s]/u.test(input)) fail(field, 'must be a hostname');
    let url;
    try { url = new URL(`https://${input}`); } catch { fail(field, 'must be a valid hostname'); }
    const domain = url.hostname.toLowerCase();
    const labels = domain.split('.');
    if (domain.length > 253 || labels.some(label => !label || label.length > 63
      || !/^[a-z0-9-]+$/u.test(label) || label.startsWith('-') || label.endsWith('-'))) fail(field, 'must be a valid hostname');
    return domain;
  }

  function normalizeTemplate(value, field) {
    const template = normalizeText(value, field, 4096);
    if ((template.match(/\{Query\}/g) || []).length !== 1) fail(field, 'must contain exactly one {Query} placeholder');
    let markerIndex = 0;
    let marker = 'tab-out-query-marker';
    while (template.includes(marker)) { markerIndex += 1; marker = `tab-out-query-marker-${markerIndex}`; }
    let url;
    try { url = new URL(template.replace('{Query}', marker)); } catch { fail(field, 'must be a valid URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) fail(field, 'must use HTTP or HTTPS');
    if (url.username || url.password) fail(field, 'must not contain credentials');
    if (url.hostname.includes(marker)) fail(field, 'placeholder must be in the path or query');
    if (url.hash.includes(marker)) fail(field, 'placeholder must be in the path or query');
    if (!url.pathname.includes(marker) && !url.search.includes(marker)) fail(field, 'placeholder must be in the path or query');
    return template;
  }

  function validateSearchPlatforms(list) {
    if (!Array.isArray(list)) fail('platforms', 'must be an array');
    if (list.length > MAX_PLATFORMS) fail('platforms', `must contain at most ${MAX_PLATFORMS} items`);
    const commands = new Map();
    const ids = new Set();
    return list.map((input, platformIndex) => {
      const base = `platforms[${platformIndex}]`;
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(base, 'must be an object');
      const id = normalizeText(input.id, `${base}.id`, 128);
      if (ids.has(id)) fail(`${base}.id`, 'must be unique');
      ids.add(id);
      const name = normalizeText(input.name, `${base}.name`, 80);
      if (!Array.isArray(input.aliases)) fail(`${base}.aliases`, 'must be an array');
      if (input.aliases.length > MAX_ALIASES) fail(`${base}.aliases`, `must contain at most ${MAX_ALIASES} items`);
      const ownCommands = new Set([normalizeCommand(name)]);
      const aliases = [];
      input.aliases.forEach((alias, aliasIndex) => {
        const field = `${base}.aliases[${aliasIndex}]`;
        const clean = normalizeText(alias, field, 80);
        const command = normalizeCommand(clean);
        if (!ownCommands.has(command)) { ownCommands.add(command); aliases.push(clean); }
      });
      for (const command of ownCommands) {
        if (commands.has(command)) fail(command === normalizeCommand(name) ? `${base}.name` : `${base}.aliases[${input.aliases.findIndex(alias => normalizeCommand(alias) === command)}]`, `conflicts with ${commands.get(command)}`);
        commands.set(command, name);
      }
      return {
        id,
        name,
        aliases,
        domain: normalizeDomain(input.domain, `${base}.domain`),
        searchUrlTemplate: normalizeTemplate(input.searchUrlTemplate, `${base}.searchUrlTemplate`),
      };
    });
  }

  function commandEndOffset(text, normalizedCommand) {
    let sourcePrefix = '';
    let offset = 0;
    for (const character of text) {
      sourcePrefix += character;
      offset += character.length;
      if (normalizeCommand(sourcePrefix) === normalizedCommand) return offset;
    }
    return -1;
  }

  function commandMatches(text, command) {
    const normalizedText = normalizeCommand(text);
    if (normalizedText !== command && !(normalizedText.startsWith(command) && /^\s/u.test(normalizedText.slice(command.length)))) return null;
    const offset = commandEndOffset(text, command);
    if (offset < 0) return null;
    const remainder = text.slice(offset);
    if (remainder && !/^\s/u.test(remainder)) return null;
    return { offset, length: command.length };
  }

  function parsePlatformQuery(text, platforms) {
    const queryText = String(text ?? '').trim();
    let best = null;
    for (const platform of platforms || []) {
      for (const label of [platform.name, ...(platform.aliases || [])]) {
        const command = normalizeCommand(label);
        const match = commandMatches(queryText, command);
        if (match && (!best || match.length > best.length)) best = { ...match, platform };
      }
    }
    if (!best) return { kind: 'tabs', query: queryText };
    const query = queryText.slice(best.offset).trim();
    return {
      kind: 'platform',
      platform: best.platform,
      query,
      url: query ? best.platform.searchUrlTemplate.replace('{Query}', encodeURIComponent(query)) : null,
    };
  }

  function findSearchPlatforms(text, platforms) {
    const needle = normalizeCommand(text);
    if (!needle) return [];
    return (platforms || []).filter(platform =>
      [platform.name, ...(platform.aliases || [])].some(label => normalizeCommand(label).startsWith(needle))
    );
  }

  const api = { findSearchPlatforms, parsePlatformQuery, validateSearchPlatforms };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
