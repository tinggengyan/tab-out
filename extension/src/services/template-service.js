(function initTemplateService(globalScope) {
  'use strict';
  function createTemplateService(options = {}) {
    const createId = options.id || (() => globalScope.crypto.randomUUID());
    function builtInTemplates() {
      return [
        { id: 'builtin-research', name: 'Research', color: '#7b6d9b', entries: [], rules: [] },
        { id: 'builtin-development', name: 'Development', color: '#5a7a62', entries: [], rules: [{ pattern: 'github.com', mode: 'suggest' }] },
        { id: 'builtin-morning', name: 'Morning start', color: '#c8713a', entries: [], rules: [] },
      ];
    }
    function createFromWorkspace(workspace, templateOptions = {}) {
      return {
        id: createId(),
        name: workspace.name,
        description: workspace.description || '',
        color: workspace.color || '#c8713a',
        entries: templateOptions.includeUrls
          ? (workspace.entries || []).map(entry => ({ url: entry.url, title: entry.title, pinned: Boolean(entry.pinned) }))
          : [],
        rules: templateOptions.rules || [],
      };
    }
    async function instantiate(template, repositories) {
      const workspace = await repositories.workspaceRepository.create({
        name: template.name,
        description: template.description || '',
        color: template.color || '#c8713a',
        entries: template.entries || [],
      });
      for (const rule of template.rules || []) {
        await repositories.ruleRepository.create({
          workspaceId: workspace.id,
          pattern: rule.pattern,
          mode: rule.mode || 'suggest',
        });
      }
      return workspace;
    }
    return { builtInTemplates, createFromWorkspace, instantiate };
  }
  const api = { createTemplateService };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
