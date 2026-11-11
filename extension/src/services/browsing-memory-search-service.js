(function initBrowsingMemorySearchService(globalScope) {
  'use strict';
  const summaryValidator = typeof require === 'function'
    ? require('./openai-compatible-client.js').validateMemorySummaryItems : globalScope.TabOutCore.validateMemorySummaryItems;
  const fail = code => Object.assign(new Error(code), { code });
  const textTools = typeof require === 'function' ? require('./browsing-memory-text.js') : globalScope.TabOutCore;
  const { memorySearchTerms: termsFrom, cleanMemoryText, memoryMatchRanges, memorySnippet, normalizeMemorySearch: normalize } = textTools;
  function evidenceFor(record, query, terms, expandedTerms) {
    const allTerms = [...new Set([query, ...terms, ...expandedTerms].filter(Boolean).map(normalize))];
    if (!allTerms.length) return { score: 0, matchedFields: [], matchedTerms: [] };
    const fields = { title: record.title || '', url: record.url || '', text: cleanMemoryText(record.text) };
    const matchedFields = [], matchedTerms = new Set();
    let score = 0;
    for (const [field, value] of Object.entries(fields)) {
      const found = new Set(memoryMatchRanges(value, allTerms, { url: field === 'url', offsets: false }).map(range => range.term));
      if (!found.size) continue;
      matchedFields.push(field);
      found.forEach(term => matchedTerms.add(term));
      if (found.has(normalize(query))) score += { title: 40, text: 25, url: 10 }[field];
      for (const term of terms) if (found.has(term)) score += { title: 6, text: 3, url: 2 }[field];
      for (const term of expandedTerms) if (found.has(term)) score += { title: 9, text: 7, url: 2 }[field];
    }
    return { score, matchedFields, matchedTerms: [...matchedTerms] };
  }
  function createBrowsingMemorySearchService({ repository, modelClient, now = () => Date.now() }) {
    if (!repository?.list || !repository?.getMany || !repository?.revision) throw new TypeError('Browsing memory repository is required');
    function assertActive(signal) { if (signal?.aborted) throw fail('model_cancelled'); }
    async function assertRevision(revision, signal) {
      const current = await repository.revision();
      assertActive(signal);
      if (current !== revision) throw fail('stale_result');
    }
    function toResult(record, terms, reason, evidence) {
      return { id: record.id, url: record.url, title: record.title || record.url,
        visitedAt: record.visitedAt, capturedAt: record.capturedAt || null,
        coverage: record.text ? 'content' : 'metadata', ...memorySnippet(record.text, terms),
        matchedFields: evidence?.matchedFields || [], matchedTerms: evidence?.matchedTerms || [],
        ...(record.truncated ? { truncated: true } : {}), ...(reason ? { reason } : {}) };
    }
    return {
      async search({ query = '', days = 30, limit = 30, useAI = false, includeContent = false, config, signal } = {}) {
        if (typeof query !== 'string' || query.length > 2000) throw fail('invalid_query');
        if (!Number.isFinite(days) || days < 1 || days > 3650) throw fail('invalid_days');
        assertActive(signal);
        const normalizedQuery = query.trim();
        const resultLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
        const revision = await repository.revision();
        const records = await repository.list({ since: now() - days * 86400000, until: now(), limit: 5000 });
        assertActive(signal);
        const terms = termsFrom(normalizedQuery), warnings = [];
        let expandedTerms = [], mode = 'local';
        if (useAI && normalizedQuery) {
          try {
            const expanded = await modelClient.expand({ query: normalizedQuery, config, signal });
            expandedTerms = [...new Set((expanded?.terms || []).filter(term => typeof term === 'string').filter(term => term.length <= 120).map(term => normalize(term).trim()).filter(Boolean))].slice(0, 16);
            mode = 'expanded';
          } catch (error) { warnings.push(safeWarning(error)); }
          await assertRevision(revision, signal);
        }
        const scored = records.map(record => ({ record, ...evidenceFor(record, normalizedQuery, terms, expandedTerms) }))
          .sort((a, b) => b.score - a.score || b.record.visitedAt - a.record.visitedAt || a.record.id.localeCompare(b.record.id));
        const evidenceById = new Map(scored.map(item => [item.record.id, item]));
        let matching = scored.filter(item => !normalizedQuery || item.score > 0).map(item => item.record);
        const combinedTerms = [...expandedTerms, ...terms];
        let reasons = new Map();
        let aiCandidates = 0;
        if (useAI && includeContent && normalizedQuery) {
          // A few recent non-keyword matches allow a semantic reranker to surface pages missed locally.
          const pool = [...matching.slice(0, 32), ...records.filter(record => !matching.slice(0, 32).some(item => item.id === record.id)).slice(0, 8)]
            .slice(0, 40);
          aiCandidates = pool.length;
          if (pool.length) {
            try {
              const ranked = await modelClient.rerank({ query: normalizedQuery,
                candidates: pool.map(record => ({ id: record.id, title: record.title, url: record.url, snippet: memorySnippet(record.text, combinedTerms).snippet })), config, signal });
              const byId = new Map(pool.map(record => [record.id, record])), used = new Set();
              const rankedRecords = [];
              for (const item of Array.isArray(ranked) ? ranked : []) {
                if (!byId.has(item.id) || used.has(item.id)) continue;
                used.add(item.id); rankedRecords.push(byId.get(item.id));
                if (typeof item.reason === 'string') reasons.set(item.id, item.reason.slice(0, 300));
              }
              // Empty valid rankings mean the model did not find a relevant candidate; retain local matches.
              if (rankedRecords.length) matching = [...rankedRecords, ...matching.filter(record => !used.has(record.id))];
              mode = 'reranked';
            } catch (error) { warnings.push(safeWarning(error)); }
            await assertRevision(revision, signal);
          }
        }
        await assertRevision(revision, signal);
        return { results: matching.slice(0, resultLimit).map(record => toResult(record, combinedTerms, reasons.get(record.id), evidenceById.get(record.id))),
          mode, warnings: [...new Set(warnings)], scanned: records.length, aiCandidates,
          withContent: records.filter(record => Boolean(record.text)).length,
          metadataOnly: records.filter(record => !record.text).length };
      },
      async summarize({ query = '', ids, includeContent = false, config, signal } = {}) {
        if (!includeContent) throw fail('content_permission_required');
        if (typeof query !== 'string' || query.length > 2000) throw fail('invalid_query');
        const selectedIds = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
        if (!selectedIds.length) throw fail('empty_selection');
        if (selectedIds.length > 8) throw fail('too_many_summary_sources');
        assertActive(signal);
        const revision = await repository.revision();
        const records = await repository.getMany(selectedIds);
        assertActive(signal);
        if (records.length !== selectedIds.length) throw fail('stale_result');
        const sources = records.filter(record => Boolean(record.text));
        if (!sources.length) throw fail('no_content');
        const warnings = records.length !== sources.length ? ['metadata_excluded'] : [];
        const summary = await modelClient.summarize({ query, sources: sources.map(record => ({ id: record.id, title: record.title, url: record.url, text: record.text })), config, signal });
        await assertRevision(revision, signal);
        if (summary?.limited) warnings.push('summary_content_limited');
        const items = summaryValidator(summary?.items, sources);
        if (!items.length) throw fail('invalid_citations');
        const used = new Set(items.flatMap(item => item.sourceIds));
        return { items, sources: sources.filter(source => used.has(source.id)).map(source => ({ id: source.id, url: source.url, title: source.title })), warnings };
      },
    };
  }
  function safeWarning(error) {
    const code = String(error?.code || 'model_failed');
    return /^(?:model_[a-z0-9_]+|invalid_model_[a-z_]+|invalid_citations)$/.test(code) ? code : 'model_failed';
  }
  const api = { createBrowsingMemorySearchService };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
