(function (globalScope) {
  'use strict';

  const MAX_IMPORT_BYTES = 1024 * 1024;
  function getCopy() {
    return new Proxy({}, { get: (_, key) => typeof globalScope.t === 'function' ? globalScope.t(`platform.${String(key)}`) : `platform.${String(key)}` });
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

  function localized(tag, className, key) {
    const node = el(tag, className, getCopy()[key]);
    node.dataset.platformCopy = key;
    return node;
  }

  function field(copy, key, input) {
    const wrap = el('label', 'sps-field');
    wrap.append(localized('span', 'sps-label', key), input);
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
    let statusCopy = null;
    let activeError = null;

    const overlay = el('div', 'sps-overlay'); overlay.id = 'searchPlatformSettingsOverlay'; overlay.hidden = true;
    const dialog = el('section', 'sps-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'spsTitle');
    const header = el('header', 'sps-header'); const heading = el('div');
    const title = localized('h2', '', 'title'); title.id = 'spsTitle'; heading.append(title, localized('p', '', 'subtitle'));
    const close = el('button', 'sps-icon-button', '×'); close.type = 'button'; close.dataset.action = 'close-platform-settings'; close.setAttribute('aria-label', copy.close);
    header.append(heading, close);
    const status = el('p', 'sps-status'); status.setAttribute('role', 'status');
    const toolbar = el('div', 'sps-toolbar');
    const add = localized('button', 'sps-button sps-primary', 'add'); add.type = 'button';
    const importButton = localized('button', 'sps-button', 'import'); importButton.type = 'button';
    const exportButton = localized('button', 'sps-button', 'export'); exportButton.type = 'button';
    const fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true;
    toolbar.append(add, importButton, exportButton, fileInput);
    const list = el('div', 'sps-list');
    const editor = el('form', 'sps-editor'); editor.hidden = true;
    const nameInput = el('input'); nameInput.name = 'name'; nameInput.autocomplete = 'off';
    const aliasesInput = el('textarea'); aliasesInput.name = 'aliases'; aliasesInput.rows = 2;
    const domainInput = el('input'); domainInput.name = 'domain'; domainInput.autocomplete = 'off'; domainInput.placeholder = 'example.com';
    const templateInput = el('input'); templateInput.name = 'searchUrlTemplate'; templateInput.autocomplete = 'off'; templateInput.placeholder = 'https://example.com/search?q={Query}';
    const aliasesField = field(copy, 'aliases', aliasesInput); aliasesField.append(localized('small', 'sps-hint', 'aliasesHint'));
    const templateField = field(copy, 'template', templateInput); templateField.append(localized('small', 'sps-hint', 'templateHint'));
    const destination = el('small', 'sps-destination'); templateField.append(destination);
    const testRow = el('div', 'sps-test-row'); const queryInput = el('input'); queryInput.name = 'testQuery'; queryInput.placeholder = copy.testQuery;
    const testButton = localized('button', 'sps-button', 'test'); testButton.type = 'button'; testRow.append(queryInput, testButton);
    const queryError = el('span', 'sps-error'); queryError.dataset.errorFor = 'query';
    const actions = el('div', 'sps-actions'); const cancel = localized('button', 'sps-button', 'cancel'); cancel.type = 'button'; const save = localized('button', 'sps-button sps-primary', 'save'); save.type = 'submit'; actions.append(cancel, save);
    editor.append(field(copy, 'name', nameInput), aliasesField, field(copy, 'domain', domainInput), templateField, testRow, queryError, actions);
    const preview = el('section', 'sps-import-preview'); preview.hidden = true;
    dialog.append(header, status, toolbar, list, editor, preview); overlay.append(dialog); document.body.append(overlay);

    const formValue = () => ({ name: nameInput.value, aliases: aliasesInput.value, domain: domainInput.value, searchUrlTemplate: templateInput.value });
    const setStatus = (text, error = false) => { statusCopy = globalScope.TabOutI18n?.describeTranslation(text); status.textContent = text || ''; status.classList.toggle('is-error', error); };
    const clearErrors = () => { activeError = null; dialog.querySelectorAll('.sps-error').forEach(node => { node.textContent = ''; }); };
    const showError = error => {
      clearErrors(); activeError = error; const message = String(error?.message || '');
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
      if (!platforms.length) { list.append(localized('p', 'sps-empty', 'empty')); return; }
      platforms.forEach(platform => {
        const card = el('article', 'sps-card'); const info = el('div');
        info.append(el('strong', '', platform.name), el('span', 'sps-meta', platform.aliases.join(', ') || platform.domain), el('span', 'sps-meta', platform.domain));
        const cardActions = el('div', 'sps-card-actions');
        const edit = localized('button', 'sps-link', 'edit'); edit.type = 'button'; edit.addEventListener('click', () => openEditor(platform));
        const remove = localized('button', 'sps-link sps-danger', 'remove'); remove.type = 'button'; remove.addEventListener('click', async () => {
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
      preview.append(localized('h3', '', 'importTitle'), el('p', changed ? 'sps-warning' : '', changed ? copy.importAgain : format(copy.importSummary, { added: result.added.length, conflicts: result.conflicts.length })));
      for (const [key, values] of [['added', result.added], ['conflicts', result.conflicts]]) {
        const section = el('div', 'sps-preview-section'); section.append(localized('strong', '', key), el('p', '', values.length ? values.join(', ') : copy.none)); preview.append(section);
      }
      const controls = el('div', 'sps-actions'); const cancelImport = localized('button', 'sps-button', 'cancel'); cancelImport.type = 'button';
      const confirmImport = localized('button', 'sps-button sps-primary', 'confirmImport'); confirmImport.type = 'button'; controls.append(cancelImport, confirmImport); preview.append(controls);
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
    globalScope.TabOutI18n?.onChange(() => {
      dialog.querySelectorAll('[data-platform-copy]').forEach(node => { node.textContent = copy[node.dataset.platformCopy]; });
      close.setAttribute('aria-label', copy.close);
      queryInput.placeholder = copy.testQuery;
      updateDestination(); renderList();
      if (importPreview && !preview.hidden) renderImport(importPreview, false);
      const descriptor = statusCopy;
      if (descriptor) setStatus(globalScope.TabOutI18n.translateDescriptor(descriptor), status.classList.contains('is-error'));
      if (activeError) showError(activeError);
    });
    core.openSearchPlatformSettings = openModal;
  }

  const api = { aliasesFromText, targetHostFromTemplate, validationErrorField, handleDialogKeydown, createPlatformSettingsController, initSearchPlatformSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (globalScope.document) {
    const initialize = async () => { await globalScope.TabOutI18n?.ready; initSearchPlatformSettings(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
