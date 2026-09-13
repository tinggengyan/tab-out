(function (globalScope) {
  'use strict';

  const MAX_IMPORT_BYTES = 1024 * 1024;
  const COPY = {
    en: {
      title: 'Search platforms', subtitle: 'Use a name or alias before your query to search a platform.',
      add: 'Add platform', empty: 'No search platforms yet.', edit: 'Edit', remove: 'Delete',
      name: 'Name', aliases: 'Aliases', aliasesHint: 'Separate aliases with commas or new lines.',
      domain: 'Platform domain', template: 'Search URL template',
      templateHint: 'Paste a real search URL and replace its query with {Query}.', destination: 'Actual destination: {host}',
      testQuery: 'Test query', test: 'Open test search', save: 'Save', cancel: 'Cancel', close: 'Close',
      import: 'Import', export: 'Export', importTitle: 'Import preview',
      importSummary: '{added} new · {conflicts} conflicts', added: 'Will add', conflicts: 'Skipped conflicts',
      none: 'None', confirmImport: 'Import platforms', importAgain: 'The preview changed because your platforms were edited. Review it before confirming again.',
      saved: 'Platform saved.', deleted: 'Platform deleted.', imported: 'Platforms imported.',
      confirmDelete: 'Delete “{name}”?', fileTooLarge: 'The import file must be 1 MB or smaller.',
      invalidFile: 'Choose a valid Tab Out platform export file.', queryRequired: 'Enter a test query.',
      stale: 'These platforms changed elsewhere. Your action was not saved; review the latest list and try again.',
      conflict: 'Conflicts with “{name}”.',
      genericError: 'Could not complete that action.', nameError: 'Check the platform name.', aliasesError: 'Check the aliases.',
      domainError: 'Check the platform domain.', templateError: 'Check the search URL template.',
    },
    zh: {
      title: '搜索平台', subtitle: '在关键词前输入平台名称或别名，即可搜索该平台。',
      add: '添加平台', empty: '暂无搜索平台。', edit: '编辑', remove: '删除',
      name: '名称', aliases: '别名', aliasesHint: '用逗号或换行分隔多个别名。',
      domain: '平台域名', template: '搜索网址模板',
      templateHint: '复制真实搜索网址，并将关键词替换为 {Query}。', destination: '实际目标：{host}',
      testQuery: '测试关键词', test: '打开测试搜索', save: '保存', cancel: '取消', close: '关闭',
      import: '导入', export: '导出', importTitle: '导入预览',
      importSummary: '新增 {added} 项 · 冲突 {conflicts} 项', added: '将新增', conflicts: '冲突并跳过',
      none: '无', confirmImport: '导入平台', importAgain: '平台配置已发生变化，请查看更新后的预览后再次确认。',
      saved: '平台已保存。', deleted: '平台已删除。', imported: '平台已导入。',
      confirmDelete: '删除“{name}”？', fileTooLarge: '导入文件不能超过 1 MB。',
      invalidFile: '请选择有效的 Tab Out 平台导出文件。', queryRequired: '请输入测试关键词。',
      stale: '平台配置已在其他页面发生变化。本次操作未保存，请查看最新列表后重试。',
      conflict: '与“{name}”冲突。',
      genericError: '操作失败，请重试。', nameError: '请检查平台名称。', aliasesError: '请检查别名。',
      domainError: '请检查平台域名。', templateError: '请检查搜索网址模板。',
    },
  };

  function getCopy() {
    const locale = (() => {
      try { return globalScope.chrome?.i18n?.getUILanguage?.() || ''; } catch { return ''; }
    })() || globalScope.navigator?.language || '';
    return COPY[String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en'];
  }

  function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (_, key) => values[key] === undefined ? `{${key}}` : values[key]);
  }

  function aliasesFromText(text) {
    return String(text || '').split(/[,，\n\r]+/).map(value => value.trim()).filter(Boolean);
  }

  function targetHostFromTemplate(template) {
    try { return new URL(String(template || '').replace('{Query}', 'preview')).host; } catch { return ''; }
  }

  function samePlatform(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function validationErrorField(error) {
    const path = String(error?.message || '').match(/(?:platforms\[\d+\]\.)?(name|aliases(?:\[\d+\])?|domain|searchUrlTemplate|query)/)?.[1] || '';
    if (path.startsWith('aliases')) return 'aliases';
    return path === 'searchUrlTemplate' ? 'template' : path;
  }

  function handleDialogKeydown(event, dialog, activeElement, closeDialog) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeDialog(); return;
    }
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.hidden && node.offsetParent !== null);
    if (!focusable.length) { event.preventDefault(); return; }
    if (event.shiftKey && activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }

  function formPlatform(form, id, randomUUID) {
    return {
      id: id || randomUUID(),
      name: String(form.name || '').trim(),
      aliases: aliasesFromText(form.aliases),
      domain: String(form.domain || '').trim(),
      searchUrlTemplate: String(form.searchUrlTemplate || '').trim(),
    };
  }

  function createPlatformSettingsController(repository, options = {}) {
    if (!repository?.list || !repository?.save) throw new TypeError('A search platform repository is required');
    const randomUUID = options.randomUUID || (() => globalScope.crypto.randomUUID());
    const validateSearchPlatforms = options.validateSearchPlatforms || (list => globalScope.TabOutCore.validateSearchPlatforms(list));
    const parsePlatformQuery = options.parsePlatformQuery || ((text, platforms) => globalScope.TabOutCore.parsePlatformQuery(text, platforms));
    const openUrl = options.openUrl || (url => globalScope.chrome.tabs.create({ url }));
    let platforms = [];
    let pendingPayload = null;

    async function rethrowAfterStaleRefresh(error, knownFresh) {
      if (/stale configuration/i.test(String(error?.message || ''))) {
        try { platforms = knownFresh || await repository.list(); } catch { /* preserve the actionable stale error */ }
      }
      throw error;
    }

    return {
      async load() { platforms = await repository.list(); return platforms.slice(); },
      list() { return platforms.slice(); },
      async saveForm(form, editingId) {
        const record = formPlatform(form, editingId, randomUUID);
        const fresh = await repository.list();
        const cachedTarget = platforms.find(item => item.id === editingId);
        const freshTarget = fresh.find(item => item.id === editingId);
        if (editingId && (!cachedTarget || !freshTarget || !samePlatform(cachedTarget, freshTarget))) {
          return rethrowAfterStaleRefresh(new Error('searchPlatformsV1: stale configuration'), fresh);
        }
        const index = fresh.findIndex(item => item.id === editingId);
        const next = fresh.slice();
        if (index < 0) next.push(record); else next[index] = record;
        try { platforms = await repository.save(next, fresh); }
        catch (error) { return rethrowAfterStaleRefresh(error); }
        return record;
      },
      async delete(id) {
        const cachedTarget = platforms.find(item => item.id === id);
        const fresh = await repository.list();
        const freshTarget = fresh.find(item => item.id === id);
        if (!cachedTarget || !freshTarget || !samePlatform(cachedTarget, freshTarget)) {
          return rethrowAfterStaleRefresh(new Error('searchPlatformsV1: stale configuration'), fresh);
        }
        try { platforms = await repository.save(fresh.filter(item => item.id !== id), fresh); }
        catch (error) { return rethrowAfterStaleRefresh(error); }
        return platforms.slice();
      },
      async testForm(form, query, editingId) {
        const record = formPlatform(form, editingId, randomUUID);
        const normalizedRecord = validateSearchPlatforms([record])[0];
        const command = `${normalizedRecord.name} ${String(query || '').trim()}`;
        const parsed = parsePlatformQuery(command, [normalizedRecord]);
        if (parsed.kind !== 'platform' || !parsed.url) throw new Error('query: A test query is required');
        await openUrl(parsed.url);
        return parsed.url;
      },
      async previewImport(payload) { pendingPayload = payload; return repository.previewImport(payload); },
      cancelImport() { pendingPayload = null; },
      async confirmImport(expectedPreview) {
        if (!pendingPayload) throw new Error('No import is pending');
        const expectedPlatforms = await repository.list();
        const preview = await repository.previewImport(pendingPayload);
        if (expectedPreview && (JSON.stringify(preview.added) !== JSON.stringify(expectedPreview.added)
          || JSON.stringify(preview.conflicts) !== JSON.stringify(expectedPreview.conflicts))) {
          return { ...preview, needsReview: true };
        }
        try { platforms = await repository.save(preview.platforms, expectedPlatforms); }
        catch (error) { return rethrowAfterStaleRefresh(error); }
        pendingPayload = null;
        return preview;
      },
      export: () => repository.export(),
    };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function field(copy, key, input) {
    const wrap = el('label', 'sps-field');
    wrap.append(el('span', 'sps-label', copy[key]), input);
    const error = el('span', 'sps-error'); error.dataset.errorFor = key; wrap.append(error);
    return wrap;
  }

  function initSearchPlatformSettings() {
    if (!globalScope.document || document.getElementById('searchPlatformSettingsOverlay')) return;
    const core = globalScope.TabOutCore || {};
    if (!core.createSearchPlatformRepository) return;
    const copy = getCopy();
    const repository = core.createSearchPlatformRepository(globalScope.chrome.storage.local);
    const controller = createPlatformSettingsController(repository);
    let editingId = null;
    let importPreview = null;
    let returnFocus = null;

    const overlay = el('div', 'sps-overlay'); overlay.id = 'searchPlatformSettingsOverlay'; overlay.hidden = true;
    const dialog = el('section', 'sps-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'spsTitle');
    const header = el('header', 'sps-header'); const heading = el('div');
    const title = el('h2', '', copy.title); title.id = 'spsTitle'; heading.append(title, el('p', '', copy.subtitle));
    const close = el('button', 'sps-icon-button', '×'); close.type = 'button'; close.dataset.action = 'close-platform-settings'; close.setAttribute('aria-label', copy.close);
    header.append(heading, close);
    const status = el('p', 'sps-status'); status.setAttribute('role', 'status');
    const toolbar = el('div', 'sps-toolbar');
    const add = el('button', 'sps-button sps-primary', copy.add); add.type = 'button';
    const importButton = el('button', 'sps-button', copy.import); importButton.type = 'button';
    const exportButton = el('button', 'sps-button', copy.export); exportButton.type = 'button';
    const fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true;
    toolbar.append(add, importButton, exportButton, fileInput);
    const list = el('div', 'sps-list');
    const editor = el('form', 'sps-editor'); editor.hidden = true;
    const nameInput = el('input'); nameInput.name = 'name'; nameInput.autocomplete = 'off';
    const aliasesInput = el('textarea'); aliasesInput.name = 'aliases'; aliasesInput.rows = 2;
    const domainInput = el('input'); domainInput.name = 'domain'; domainInput.autocomplete = 'off'; domainInput.placeholder = 'example.com';
    const templateInput = el('input'); templateInput.name = 'searchUrlTemplate'; templateInput.autocomplete = 'off'; templateInput.placeholder = 'https://example.com/search?q={Query}';
    const aliasesField = field(copy, 'aliases', aliasesInput); aliasesField.append(el('small', 'sps-hint', copy.aliasesHint));
    const templateField = field(copy, 'template', templateInput); templateField.append(el('small', 'sps-hint', copy.templateHint));
    const destination = el('small', 'sps-destination'); templateField.append(destination);
    const testRow = el('div', 'sps-test-row'); const queryInput = el('input'); queryInput.name = 'testQuery'; queryInput.placeholder = copy.testQuery;
    const testButton = el('button', 'sps-button', copy.test); testButton.type = 'button'; testRow.append(queryInput, testButton);
    const queryError = el('span', 'sps-error'); queryError.dataset.errorFor = 'query';
    const actions = el('div', 'sps-actions'); const cancel = el('button', 'sps-button', copy.cancel); cancel.type = 'button'; const save = el('button', 'sps-button sps-primary', copy.save); save.type = 'submit'; actions.append(cancel, save);
    editor.append(field(copy, 'name', nameInput), aliasesField, field(copy, 'domain', domainInput), templateField, testRow, queryError, actions);
    const preview = el('section', 'sps-import-preview'); preview.hidden = true;
    dialog.append(header, status, toolbar, list, editor, preview); overlay.append(dialog); document.body.append(overlay);

    const formValue = () => ({ name: nameInput.value, aliases: aliasesInput.value, domain: domainInput.value, searchUrlTemplate: templateInput.value });
    const setStatus = (text, error = false) => { status.textContent = text || ''; status.classList.toggle('is-error', error); };
    const clearErrors = () => dialog.querySelectorAll('.sps-error').forEach(node => { node.textContent = ''; });
    const showError = error => {
      clearErrors(); const message = String(error?.message || '');
      if (/stale configuration/i.test(message)) { setStatus(copy.stale, true); closeEditor(); controller.load().then(renderList).catch(() => {}); return; }
      const key = validationErrorField(error);
      const target = dialog.querySelector(`[data-error-for="${key}"]`);
      const fallback = { name: copy.nameError, aliases: copy.aliasesError, domain: copy.domainError, template: copy.templateError, query: copy.queryRequired }[key];
      const conflict = message.match(/conflicts with (.+)$/i)?.[1];
      if (target) target.textContent = conflict ? format(copy.conflict, { name: conflict }) : (fallback || copy.genericError); else setStatus(copy.genericError, true);
    };
    const updateDestination = () => { const host = targetHostFromTemplate(templateInput.value); destination.textContent = host ? format(copy.destination, { host }) : ''; };

    function renderList() {
      list.replaceChildren(); const platforms = controller.list();
      if (!platforms.length) { list.append(el('p', 'sps-empty', copy.empty)); return; }
      platforms.forEach(platform => {
        const card = el('article', 'sps-card'); const info = el('div');
        info.append(el('strong', '', platform.name), el('span', 'sps-meta', platform.aliases.join(', ') || platform.domain), el('span', 'sps-meta', platform.domain));
        const cardActions = el('div', 'sps-card-actions');
        const edit = el('button', 'sps-link', copy.edit); edit.type = 'button'; edit.addEventListener('click', () => openEditor(platform));
        const remove = el('button', 'sps-link sps-danger', copy.remove); remove.type = 'button'; remove.addEventListener('click', async () => {
          if (!globalScope.confirm(format(copy.confirmDelete, { name: platform.name }))) return;
          try { await controller.delete(platform.id); renderList(); setStatus(copy.deleted); } catch (error) { showError(error); }
        });
        cardActions.append(edit, remove); card.append(info, cardActions); list.append(card);
      });
    }
    function openEditor(platform) {
      editingId = platform?.id || null; clearErrors(); setStatus('');
      nameInput.value = platform?.name || ''; aliasesInput.value = platform?.aliases?.join(', ') || '';
      domainInput.value = platform?.domain || ''; templateInput.value = platform?.searchUrlTemplate || ''; queryInput.value = '';
      editor.hidden = false; preview.hidden = true; updateDestination(); nameInput.focus();
    }
    function closeEditor() { editor.hidden = true; editingId = null; clearErrors(); }
    function closeModal() { overlay.hidden = true; closeEditor(); controller.cancelImport(); preview.hidden = true; returnFocus?.focus?.(); returnFocus = null; }
    async function openModal() {
      returnFocus = document.activeElement; overlay.hidden = false; setStatus('');
      try { await controller.load(); renderList(); add.focus(); } catch (error) { showError(error); }
    }
    function renderImport(result, changed) {
      importPreview = result; preview.replaceChildren(); preview.hidden = false; editor.hidden = true;
      preview.append(el('h3', '', copy.importTitle), el('p', changed ? 'sps-warning' : '', changed ? copy.importAgain : format(copy.importSummary, { added: result.added.length, conflicts: result.conflicts.length })));
      for (const [label, values] of [[copy.added, result.added], [copy.conflicts, result.conflicts]]) {
        const section = el('div', 'sps-preview-section'); section.append(el('strong', '', label), el('p', '', values.length ? values.join(', ') : copy.none)); preview.append(section);
      }
      const controls = el('div', 'sps-actions'); const cancelImport = el('button', 'sps-button', copy.cancel); cancelImport.type = 'button';
      const confirmImport = el('button', 'sps-button sps-primary', copy.confirmImport); confirmImport.type = 'button'; controls.append(cancelImport, confirmImport); preview.append(controls);
      cancelImport.addEventListener('click', () => { controller.cancelImport(); preview.hidden = true; importPreview = null; });
      confirmImport.addEventListener('click', async () => {
        try {
          const final = await controller.confirmImport(importPreview);
          if (final.needsReview) { renderImport(final, true); return; }
          importPreview = null; preview.hidden = true; renderList(); setStatus(copy.imported);
        } catch (error) { showError(error); }
      });
    }

    add.addEventListener('click', () => openEditor(null)); cancel.addEventListener('click', closeEditor); close.addEventListener('click', closeModal);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
    templateInput.addEventListener('input', updateDestination);
    editor.addEventListener('submit', async event => { event.preventDefault(); clearErrors(); try { await controller.saveForm(formValue(), editingId); closeEditor(); renderList(); setStatus(copy.saved); } catch (error) { showError(error); } });
    testButton.addEventListener('click', async () => { clearErrors(); try { await controller.testForm(formValue(), queryInput.value, editingId); } catch (error) { showError(error); } });
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) { setStatus(copy.fileTooLarge, true); return; }
      try { const payload = JSON.parse(await file.text()); renderImport(await controller.previewImport(payload), false); } catch { setStatus(copy.invalidFile, true); }
    });
    exportButton.addEventListener('click', async () => {
      try {
        const payload = await controller.export(); const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const anchor = el('a'); anchor.href = url; anchor.download = 'tab-out-search-platforms.json'; anchor.click(); URL.revokeObjectURL(url);
      } catch (error) { showError(error); }
    });
    dialog.addEventListener('keydown', event => handleDialogKeydown(event, dialog, document.activeElement, closeModal));
    core.openSearchPlatformSettings = openModal;
  }

  const api = { aliasesFromText, targetHostFromTemplate, validationErrorField, handleDialogKeydown, createPlatformSettingsController, initSearchPlatformSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (globalScope.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSearchPlatformSettings, { once: true });
    else initSearchPlatformSettings();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
