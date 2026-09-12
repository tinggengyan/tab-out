(function initTelemetryService(globalScope) {
  'use strict';
  const EVENT_FIELDS = Object.freeze({
    snapshot_created: ['type', 'tab_count_bucket', 'result'],
    restore_started: ['mode', 'tab_count_bucket'],
    restore_completed: ['mode', 'tab_count_bucket', 'result', 'error_code'],
    undo_used: ['operation_kind', 'age_bucket'],
    search_completed: ['source_filters', 'result_bucket', 'action_type'],
    paywall_viewed: ['feature', 'plan'],
    purchase_completed: ['plan'],
  });
  function createTelemetryService(storageArea, options = {}) {
    const maxEvents = options.maxEvents || 200;
    const maxErrors = options.maxErrors || 50;
    const now = options.now || (() => new Date().toISOString());
    async function append(key, value, limit) {
      const stored = await storageArea.get(key);
      const current = Array.isArray(stored[key]) ? stored[key] : [];
      await storageArea.set({ [key]: [value, ...current].slice(0, limit) });
    }
    return {
      async record(name, properties = {}) {
        if (!EVENT_FIELDS[name]) return false;
        const safe = {};
        for (const field of EVENT_FIELDS[name]) {
          const value = properties[field];
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safe[field] = String(value).slice(0, 64);
        }
        await append('telemetryEventsV1', { name, at: now(), properties: safe }, maxEvents);
        return true;
      },
      async error(scope, code) {
        await append('localErrorsV1', { scope: String(scope || 'unknown').slice(0, 32), code: String(code || 'unknown').slice(0, 64), at: now() }, maxErrors);
      },
    };
  }
  const api = { createTelemetryService };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
