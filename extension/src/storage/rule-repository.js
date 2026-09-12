(function initRuleRepository(globalScope) {
  'use strict';
  const compilePattern = typeof require === 'function'
    ? require('../domain/rule-engine.js').compilePattern
    : globalScope.TabOutCore.compilePattern;

  function createRuleRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const key = options.key || 'workspaceRulesV2';
    const createId = options.id || (() => globalScope.crypto.randomUUID());
    async function list() {
      const stored = await storageArea.get(key);
      return Array.isArray(stored[key]) ? stored[key] : [];
    }
    async function write(rules) { await storageArea.set({ [key]: rules }); }
    function validate(input) {
      if (!input.workspaceId) throw new TypeError('Workspace id is required');
      compilePattern(input.pattern);
      if (input.mode && !['suggest', 'auto'].includes(input.mode)) throw new TypeError('Invalid rule mode');
    }
    return {
      list,
      async get(id) { return (await list()).find(rule => rule.id === id) || null; },
      async create(input) {
        validate(input);
        const rule = {
          id: createId(), workspaceId: String(input.workspaceId), pattern: String(input.pattern).trim(),
          enabled: input.enabled !== false, mode: input.mode || 'suggest',
        };
        await write([...(await list()), rule]);
        return rule;
      },
      async update(id, patch) {
        const rules = await list();
        const index = rules.findIndex(rule => rule.id === id);
        if (index < 0) throw new Error('Rule not found');
        const next = { ...rules[index], ...patch, id: rules[index].id, workspaceId: rules[index].workspaceId };
        validate(next);
        rules[index] = next;
        await write(rules);
        return next;
      },
      async remove(id) { await write((await list()).filter(rule => rule.id !== id)); },
    };
  }
  const api = { createRuleRepository };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
