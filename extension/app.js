/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];
let lastUndoOperationId = null;
let toastTimer = null;
let toastDescriptor = null;
let upgradeStatusPlan = null;
function renderUpgradeStatus(plan = upgradeStatusPlan) {
  if (plan === null) return;
  upgradeStatusPlan = plan;
  document.getElementById('upgradeStatus').textContent = plan === 'free'
    ? t('upgrade.freeStatus')
    : t('upgrade.activeStatus', { plan });
}
let pendingRestoreSessionId = null;
let pendingRetrySession = null;
let pendingRetryGroupFailures = [];
let pendingRestoreJobId = null;
let commandSearchIndex = null;
let commandPlatforms = [];
let commandBuildGeneration = 0;
let commandQueryGeneration = 0;
let commandMemoryRequestId = null;
let commandWindowNames = new Map();
let commandHasAdvanced = false;
let commandSearchItems = new Map();
let commandSelectedIndex = 0;
let pendingImport = null;
let importGeneration = 0;
const escapeHtml = TabOutCore.escapeHtml;

const sessionAdapter = TabOutCore.createChromeSessionAdapter(chrome, { deviceId: 'local' });
const operationRepository = TabOutCore.createOperationRepository(chrome.storage.local);
const workspaceRepository = TabOutCore.createWorkspaceRepository(chrome.storage.local);
const ruleRepository = TabOutCore.createRuleRepository(chrome.storage.local);
const restoreJobRepository = TabOutCore.createRestoreJobRepository(chrome.storage.local);
const templateService = TabOutCore.createTemplateService();
const entitlementService = TabOutCore.createEntitlementService({
  storage: chrome.storage.local,
  publicKeyJwk: globalThis.TAB_OUT_PUBLIC_KEY_JWK,
});
const telemetry = TabOutCore.createTelemetryService(chrome.storage.local);

function countBucket(count) {
  if (count <= 10) return '0-10';
  if (count <= 50) return '11-50';
  if (count <= 100) return '51-100';
  return '101+';
}
const trashRepository = TabOutCore.createTrashRepository(chrome.storage.local, {
  retentionDays: () => entitlementService.limit('trash.days'),
});
const snapshotRepository = TabOutCore.createSnapshotRepository(chrome.storage.local, {
  automaticLimit: Infinity,
});
const operationService = TabOutCore.createOperationService({
  captureTabs: sessionAdapter.captureTabs,
  removeTabs: tabIds => chrome.tabs.remove(tabIds),
  getExistingTabIds: async tabIds => {
    const wanted = new Set(tabIds);
    return (await chrome.tabs.query({})).map(tab => tab.id).filter(id => wanted.has(id));
  },
  restoreSession: sessionAdapter.restoreSession,
  repository: operationRepository,
});
const projectService = TabOutCore.createProjectService({
  chromeApi: chrome,
  workspaceRepository,
  sessionAdapter,
  operationService,
  getWorkspaceLimit: () => entitlementService.limit('workspaces.limit'),
});
function initializeProjectWorkbench() {
  if (globalThis.tabOutProjectWorkbench) return;
  globalThis.tabOutProjectWorkbench = TabOutCore.createProjectWorkbench({
  chromeApi: chrome,
  service: projectService,
  workspaceRepository,
  translate: t,
  onOperation: operation => showToast(t('project.undoAvailable'), { undoOperationId: operation.id }),
  onRefresh: () => renderStaticDashboard(),
  exportBackup: () => exportConfig(),
  undoOperation: operationId => undoTrackedOperation(operationId),
  onDelete: id => deleteProject(id),
  });
}
const collectionTransferService = TabOutCore.createCollectionTransferService({
  workspaceRepository,
  getGroups: () => getTabGroups(),
  saveGroups: groups => saveTabGroups(groups),
});

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.pendingUrl || t.url,
      title:    t.title || t.pendingUrl || t.url,
      windowId: t.windowId,
      active:   t.active,
      lastAccessed: t.lastAccessed,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: (t.pendingUrl || t.url) === newtabUrl || (t.pendingUrl || t.url) === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const item = {
    id:        crypto.randomUUID(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  };
  deferred.push(item);
  await chrome.storage.local.set({ deferred });
  return item;
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message, options = {}) {
  const toast = document.getElementById('toast');
  const actionButton = document.getElementById('toastAction');
  toastDescriptor = TabOutI18n.describeTranslation(message);
  document.getElementById('toastText').textContent = message;
  if (options.undoOperationId) {
    lastUndoOperationId = options.undoOperationId;
    actionButton.dataset.action = 'undo-last-operation';
    delete actionButton.dataset.trashId;
    actionButton.textContent = t('btn.undo');
    actionButton.style.display = 'inline-block';
  } else if (options.undoTrashId) {
    actionButton.dataset.action = 'undo-trash';
    actionButton.dataset.trashId = options.undoTrashId;
    actionButton.textContent = t('btn.undo');
    actionButton.style.display = 'inline-block';
  } else {
    actionButton.style.display = 'none';
  }
  toast.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    actionButton.style.display = 'none';
  }, options.undoOperationId || options.undoTrashId ? 30000 : 2500);
}

function showCloseResult(operation, successMessage) {
  const succeeded = operation?.result?.succeeded || 0;
  const failed = operation?.result?.failed?.length || 0;
  showToast(failed ? t('toast.partialClose', { succeeded, failed }) : successMessage, {
    undoOperationId: succeeded ? operation.id : null,
  });
  return failed;
}

async function latestUndoableOperation(excludeId) {
  const cutoff = Date.now() - 30000;
  return (await operationRepository.list()).find(operation =>
    operation.id !== excludeId && ['complete', 'partially_failed'].includes(operation.status) && operation.result?.succeeded > 0 && Date.parse(operation.createdAt) >= cutoff
  ) || null;
}

async function undoTrackedOperation(operationId) {
  const operation = await operationService.undo(operationId);
  const undoAge = Math.max(0, Date.now() - Date.parse(operation.createdAt));
  telemetry.record('undo_used', { operation_kind: operation.kind || 'close', age_bucket: undoAge <= 10000 ? '0-10s' : undoAge <= 30000 ? '11-30s' : '31s+' }).catch(() => {});
  if (operation.status === 'undone') {
    // Undo restores browser pages; a saved project remains available.
    if (operation.metadata?.deferredId) {
      const { deferred = [] } = await chrome.storage.local.get('deferred');
      await chrome.storage.local.set({ deferred: deferred.filter(item => item.id !== operation.metadata.deferredId) });
    }
  }
  const previous = await latestUndoableOperation(operation.id);
  const failed = operation.undoResult?.failed?.length || 0;
  lastUndoOperationId = failed ? operation.id : previous?.id || null;
  showToast(t(failed ? 'toast.undoFailed' : 'toast.undoSucceeded'), { undoOperationId: lastUndoOperationId });
  await renderDashboard();
  if (document.getElementById('historyOverlay').style.display !== 'none') await renderHistory();
  return operation;
}

function trashItemTitle(item) {
  if (item.entityType === 'tabGroup') {
    const count = item.payload?.tabs?.length || 0;
    return t('tabGroups.tabCount', { n: count });
  }
  if (item.entityType === 'session') return t('trash.session');
  return item.payload?.title || item.payload?.name || item.payload?.url || t(`trash.${item.entityType}`);
}

async function renderTrash({ purge = true } = {}) {
  if (purge) await trashRepository.purgeExpired();
  const items = await trashRepository.list();
  const list = document.getElementById('trashList');
  const empty = document.getElementById('trashEmpty');
  const clear = document.getElementById('trashClearBtn');
  list.innerHTML = items.map(item => {
    const safeId = escapeHtml(item.id);
    const typeLabel = escapeHtml(t(`trash.${item.entityType}`));
    const title = escapeHtml(trashItemTitle(item));
    const deletedAt = escapeHtml(timeAgo(item.deletedAt));
    return `<div class="trash-item">
      <div class="trash-item-info">
        <div class="trash-item-title">${title}</div>
        <div class="trash-item-meta">${typeLabel} &middot; ${deletedAt}</div>
      </div>
      <div class="trash-item-actions">
        <button class="action-btn" data-action="restore-trash" data-trash-id="${safeId}">${t('btn.restore')}</button>
        <button class="action-btn danger" data-action="delete-trash" data-trash-id="${safeId}">${t('btn.deleteForever')}</button>
      </div>
    </div>`;
  }).join('');
  list.style.display = items.length ? 'block' : 'none';
  empty.style.display = items.length ? 'none' : 'block';
  clear.style.display = items.length ? 'inline-flex' : 'none';
}

async function restoreTrashItem(id) {
  const item = (await trashRepository.list()).find(entry => entry.id === id);
  if (!item) return;
  if (item.entityType === 'tabGroup') {
    await workspaceRepository.importLegacyGroups([item.payload]);
    await globalThis.tabOutProjectWorkbench?.refresh();
  } else if (item.entityType === 'deferred') {
    const { deferred = [] } = await chrome.storage.local.get('deferred');
    deferred.unshift({ ...item.payload, dismissed: false });
    await chrome.storage.local.set({ deferred });
    await renderDeferredColumn();
  } else if (item.entityType === 'shortcut') {
    _shortcuts.unshift(item.payload);
    await saveShortcuts(_shortcuts);
    renderShortcuts();
  } else if (item.entityType === 'session') {
    await snapshotRepository.add(item.payload);
  } else if (item.entityType === 'workspace') {
    const restored = await workspaceRepository.restore({ ...item.payload, restoredFromTrashId: id });
    for (const [index, rule] of (item.payload.rules || []).entries()) {
      await ruleRepository.restore({ ...rule, workspaceId: restored.id }, { trashId: id, sourceRuleId: rule.id || `index:${index}` });
    }
    await renderWorkspaces();
  }
  await trashRepository.restore(id);
  await renderTrash();
}

async function renderHistory() {
  const [sessions, operations] = await Promise.all([snapshotRepository.list(), operationRepository.list()]);
  const automaticAccessLimit = await entitlementService.limit('history.automatic');
  let automaticIndex = 0;
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  list.innerHTML = sessions.map((session, sessionIndex) => {
    const locked = (session.type || 'automatic') === 'automatic' && automaticIndex++ >= automaticAccessLimit;
    const safeId = escapeHtml(session.id);
    const date = new Date(session.capturedAt).toLocaleString(_currentLocale);
    const summary = t('history.summary', {
      windows: session.stats?.windowCount || session.windows?.length || 0,
      tabs: session.stats?.tabCount || 0,
      groups: session.stats?.groupCount || 0,
    });
    const previous = sessions[sessionIndex + 1];
    const tabDelta = previous ? (session.stats?.tabCount || 0) - (previous.stats?.tabCount || 0) : 0;
    const windowDelta = previous ? (session.stats?.windowCount || 0) - (previous.stats?.windowCount || 0) : 0;
    const difference = previous ? t('history.difference', {
      tabs: `${tabDelta >= 0 ? '+' : ''}${tabDelta}`,
      windows: `${windowDelta >= 0 ? '+' : ''}${windowDelta}`,
    }) : t('history.baseline');
    const note = session.note ? `<div class="trash-item-meta history-note">${escapeHtml(session.note)}</div>` : '';
    return `<div class="trash-item">
      <div class="trash-item-info">
        <div class="trash-item-title">${escapeHtml(date)}</div>
        <div class="trash-item-meta">${t(`history.${session.type || 'automatic'}`)} &middot; ${escapeHtml(summary)} &middot; ${escapeHtml(difference)}</div>
        ${note}
      </div>
      <div class="trash-item-actions">
        <button class="action-btn primary" data-action="${locked ? 'open-upgrade' : 'restore-snapshot'}" data-snapshot-id="${safeId}">${t(locked ? 'history.locked' : 'btn.restoreNewWindow')}</button>
        <button class="action-btn danger" data-action="delete-snapshot" data-snapshot-id="${safeId}">${t('shortcuts.delete')}</button>
      </div>
    </div>`;
  }).join('');
  list.style.display = sessions.length ? 'block' : 'none';
  empty.style.display = sessions.length ? 'none' : 'block';
  const operationList = document.getElementById('operationHistoryList');
  const operationEmpty = document.getElementById('operationHistoryEmpty');
  operationList.innerHTML = operations.slice(0, 30).map(operation => {
    const succeeded = operation.result?.succeeded || 0;
    const failed = operation.result?.failed?.length || 0;
    const undoable = ['complete', 'partially_failed'].includes(operation.status) && operation.result?.succeeded > 0 && Date.now() - Date.parse(operation.createdAt) <= 30000;
    return `<div class="trash-item"><div class="trash-item-info"><div class="trash-item-title">${escapeHtml(t(`operation.${operation.kind || 'close'}`))}</div><div class="trash-item-meta">${escapeHtml(new Date(operation.createdAt).toLocaleString(_currentLocale))} · ${escapeHtml(t(`operation.status.${({ partially_failed: "partial", undo_failed: "undo_partial", in_progress: "running" })[operation.status] || operation.status}`))} · ${t('operation.result', { succeeded, failed })}</div></div>${undoable ? `<button class="action-btn" data-action="undo-operation" data-operation-id="${escapeHtml(operation.id)}">${t('btn.undo')}</button>` : ''}</div>`;
  }).join('');
  operationList.style.display = operations.length ? 'block' : 'none';
  operationEmpty.style.display = operations.length ? 'none' : 'block';
}

async function deleteProject(id) {
  const workspace = await workspaceRepository.get(id);
  if (!workspace) return;
  const rules = (await ruleRepository.list()).filter(rule => rule.workspaceId === id);
  // Retain the payload before changing the active project or its automation.
  const item = await trashRepository.add('workspace', id, { ...workspace, rules });
  await workspaceRepository.remove(id);
  for (const rule of rules) await ruleRepository.remove(rule.id);
  showToast(t('toast.movedToTrash'), { undoTrashId: item.id });
}

async function renderWorkspaces() {
  const workspaces = await workspaceRepository.list();
  const list = document.getElementById('workspaceList');
  const empty = document.getElementById('workspaceEmpty');
  list.innerHTML = workspaces.map(workspace => {
    const safeId = escapeHtml(workspace.id);
    const preview = workspace.entries.slice(0, 12).map(entry =>
      `<label class="workspace-entry-chip" draggable="true" data-workspace-id="${safeId}" data-entry-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.url)}"><input type="checkbox" class="workspace-entry-select" value="${escapeHtml(entry.id)}">${escapeHtml(entry.title || entry.url)}</label>`
    ).join('');
    const targets = [
      ...workspaces.filter(item => item.id !== workspace.id).map(item => `<option value="workspace:${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`),
    ].join('');
    return `<article class="workspace-card" data-workspace-drop="${safeId}" style="--workspace-color:${escapeHtml(workspace.color || '#c8713a')}">
      <div class="workspace-card-top">
        <div class="workspace-card-info">
          <div class="workspace-card-name">${escapeHtml(workspace.icon || '')} ${escapeHtml(workspace.name)}</div>
          <div class="workspace-card-meta">${t('workspaces.entryCount', { n: workspace.entries.length })}</div>
          ${workspace.description ? `<div class="workspace-card-description">${escapeHtml(workspace.description)}</div>` : ''}
        </div>
        <div class="workspace-card-actions">
          <button class="action-btn primary" data-action="open-workspace" data-workspace-id="${safeId}">${t('workspaces.openMissing')}</button>
          <button class="action-btn" data-action="open-all-workspace" data-workspace-id="${safeId}">${t('workspaces.openAll')}</button>
          <button class="action-btn" data-action="add-workspace-rule" data-workspace-id="${safeId}">${t('workspaces.addRule')}</button>
          <button class="action-btn" data-action="rename-workspace" data-workspace-id="${safeId}">${t('workspaces.edit')}</button>
          <input class="workspace-color-input" type="color" value="${escapeHtml(workspace.color || '#c8713a')}" data-action="change-workspace-color" data-workspace-id="${safeId}" aria-label="${t('workspaces.color')}">
          <button class="action-btn" data-action="pin-workspace" data-workspace-id="${safeId}">${t(workspace.pinned ? 'workspaces.unpin' : 'workspaces.pin')}</button>
          <button class="action-btn" data-action="move-workspace-up" data-workspace-id="${safeId}" aria-label="${t('workspaces.moveUp')}">↑</button>
          <button class="action-btn" data-action="move-workspace-down" data-workspace-id="${safeId}" aria-label="${t('workspaces.moveDown')}">↓</button>
          <button class="action-btn" data-action="save-workspace-template" data-workspace-id="${safeId}">${t('workspaces.saveTemplate')}</button>
          <button class="action-btn danger" data-action="delete-workspace" data-workspace-id="${safeId}">${t('shortcuts.delete')}</button>
        </div>
      </div>
      <div class="workspace-entry-preview">${preview}</div>
      <div class="workspace-bulk-actions">${targets ? `<select class="workspace-target-select">${targets}</select>` : ''}<button class="action-btn" data-action="open-selected-entries" data-workspace-id="${safeId}">${t('workspaces.openSelected')}</button>${targets ? `<button class="action-btn" data-action="move-selected-entries" data-workspace-id="${safeId}">${t('workspaces.moveSelected')}</button><button class="action-btn" data-action="copy-selected-entries" data-workspace-id="${safeId}">${t('workspaces.copySelected')}</button>` : ''}<button class="action-btn danger" data-action="delete-selected-entries" data-workspace-id="${safeId}">${t('workspaces.deleteSelected')}</button></div>
    </article>`;
  }).join('');
  list.style.display = workspaces.length ? 'grid' : 'none';
  empty.style.display = workspaces.length ? 'none' : 'block';
  const rules = await ruleRepository.list();
  const { workspaceSuggestionsV2 = [] } = await chrome.storage.local.get('workspaceSuggestionsV2');
  const workspaceNames = new Map(workspaces.map(workspace => [workspace.id, workspace.name]));
  document.getElementById('workspaceSuggestions').innerHTML = workspaceSuggestionsV2.map(suggestion => `
    <div class="workspace-automation-row">
      <span class="workspace-automation-title" title="${escapeHtml(suggestion.url)}">${escapeHtml(suggestion.title || suggestion.url)} → ${escapeHtml(workspaceNames.get(suggestion.workspaceId) || '')}</span>
      <button class="action-btn" data-action="accept-workspace-suggestion" data-suggestion-id="${escapeHtml(suggestion.id)}">${t('workspaces.accept')}</button>
      <button class="action-btn" data-action="dismiss-workspace-suggestion" data-suggestion-id="${escapeHtml(suggestion.id)}">${t('workspaces.dismiss')}</button>
    </div>`).join('');
  document.getElementById('workspaceRules').innerHTML = rules.map(rule => `
    <div class="workspace-automation-row">
      <span class="workspace-automation-title">${escapeHtml(rule.pattern)} → ${escapeHtml(workspaceNames.get(rule.workspaceId) || '')}</span>
      <select class="workspace-rule-mode" data-action="change-rule-mode" data-rule-id="${escapeHtml(rule.id)}">
        <option value="suggest" ${rule.mode === 'suggest' ? 'selected' : ''}>${t('workspaces.modeSuggest')}</option>
        <option value="auto" ${rule.mode === 'auto' ? 'selected' : ''}>${t('workspaces.modeAuto')}</option>
      </select>
      <button class="action-btn danger" data-action="delete-workspace-rule" data-rule-id="${escapeHtml(rule.id)}">${t('shortcuts.delete')}</button>
    </div>`).join('');
  const { workspaceRuleExclusionsV2 = [] } = await chrome.storage.local.get('workspaceRuleExclusionsV2');
  document.getElementById('workspaceRuleExclusions').innerHTML = workspaceRuleExclusionsV2.map((pattern, index) => `
    <div class="workspace-automation-row"><span class="workspace-automation-title">${escapeHtml(pattern)}</span><button class="action-btn danger" data-action="delete-rule-exclusion" data-exclusion-index="${index}">${t('shortcuts.delete')}</button></div>`).join('');

  const { workspaceTemplatesV2 = [] } = await chrome.storage.local.get('workspaceTemplatesV2');
  const builtIns = templateService.builtInTemplates().map(template => ({
    ...template,
    name: t(template.id === 'builtin-research' ? 'workspaces.templateResearch' : template.id === 'builtin-development' ? 'workspaces.templateDevelopment' : 'workspaces.templateMorning'),
  }));
  const templates = [...builtIns, ...workspaceTemplatesV2];
  const select = document.getElementById('workspaceTemplateSelect');
  select.innerHTML = templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
  select._templates = templates;
}

async function openProjectSavePreview(mode, tabs, options = {}) {
  const ids = (tabs || []).map(tab => tab.id).filter(Number.isInteger);
  if (tabs && !ids.length) { showToast(t('workspaces.noSelection')); return; }
  await globalThis.tabOutProjectWorkbench?.begin(mode, options.workspaceId, {
    ...(tabs ? { tabIds: ids, acrossWindows: true } : {}), ...options,
  });
}
async function saveTabsToWorkspace(tabs) { return openProjectSavePreview('save', tabs); }

async function buildCommandSearchIndex() {
  const generation = ++commandBuildGeneration;
  const tabs = await chrome.tabs.query({});
  const advanced = await entitlementService.has('search.advanced');
  const platforms = await TabOutCore.createSearchPlatformRepository(chrome.storage.local).list();
  const [workspaces, snapshots, saved] = await Promise.all([
    workspaceRepository.list(), advanced ? snapshotRepository.list() : [], getSavedTabs(),
  ]);
  if (generation !== commandBuildGeneration) return;
  commandWindowNames = new Map([...new Set(tabs.map(tab => tab.windowId))].sort((a, b) => a - b).map((id, index) => [id, index + 1]));
  commandPlatforms = platforms;
  commandHasAdvanced = advanced;
  const items = [];
  let sequence = 0;
  const add = item => {
    const searchId = `search-${++sequence}`;
    const record = { ...item, id: searchId };
    items.push(record);
    commandSearchItems.set(searchId, record);
  };
  commandSearchItems = new Map();
  TabOutCore.openTabSearchItems(tabs).forEach(add);
  workspaces.forEach(workspace => {
    add({ type: 'workspace', title: workspace.name, subtitle: workspace.description, workspaceId: workspace.id, updatedAt: workspace.updatedAt });
    workspace.entries.forEach(entry => add({ type: 'workspace', title: entry.title, subtitle: workspace.name, url: entry.url, workspaceId: workspace.id, entryId: entry.id, addedAt: entry.addedAt }));
  });
  [...saved.active, ...saved.archived].forEach(item => add({ type: 'deferred', title: item.title, url: item.url, savedAt: item.savedAt }));
  snapshots.forEach(snapshot => snapshot.windows.forEach(window => window.tabs.forEach(tab => {
    if (tab.restorable) add({ type: 'history', title: tab.title, url: tab.url, snapshotId: snapshot.id, subtitle: new Date(snapshot.capturedAt).toLocaleString(_currentLocale), capturedAt: snapshot.capturedAt });
  })));
  commandSearchIndex = TabOutCore.createSearchIndex(items);
}

function searchTypeLabel(type) {
  return t(`search.type${type.charAt(0).toUpperCase()}${type.slice(1)}`);
}

async function renderCommandResults(query) {
  const generation = ++commandQueryGeneration;
  let command;
  try { command = TabOutCore.parsePlatformQuery(query, commandPlatforms); }
  catch { command = { kind: 'tabs', query }; }
  const parsed = commandHasAdvanced ? TabOutCore.parseSearchQuery(query) : { text: query };
  let results = command.kind === 'platform'
    ? [{ type: 'platform', title: command.platform.name, platform: command.platform, url: command.url, query: command.query }]
    : [...(commandSearchIndex?.search(parsed.text, { limit: 30, types: parsed.types, after: parsed.after, before: parsed.before }) || []),
      ...TabOutCore.findSearchPlatforms(query, commandPlatforms).map(platform => ({ type: 'platform', title: platform.name, platform }))];
  // The memory worker owns the body index. Only this query's compact results reach the UI.
  if (commandMemoryRequestId) chrome.runtime.sendMessage({ type: 'browsing-memory', action: 'cancel', payload: { requestId: commandMemoryRequestId } }).catch(() => {});
  commandMemoryRequestId = null;
  let memoryFailed = false;
  if (command.kind !== 'platform' && parsed.text.trim() && (!parsed.types || parsed.types.includes('memory'))) {
    document.getElementById('commandResults').setAttribute('aria-busy', 'true');
    document.getElementById('commandResults').style.display = 'none';
    document.getElementById('commandEmpty').style.display = 'block';
    document.getElementById('commandEmpty').textContent = t('search.loading');
    const requestId = `command:${Date.now()}:${generation}`;
    commandMemoryRequestId = requestId;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'browsing-memory', action: 'search', payload: { query: parsed.text, useAI: false, includeContent: false, days: 365, limit: 30, requestId } });
      if (generation !== commandQueryGeneration) return;
      if (!response?.ok) memoryFailed = true;
      else results.push(...(response.data?.results || []).map(item => ({ ...item, type: 'memory', memoryId: item.id, id: `memory:${item.id}`, subtitle: item.url })));
    } catch { memoryFailed = true; }
  }
  if (generation !== commandQueryGeneration) return;
  document.getElementById('commandHint').textContent = t(memoryFailed ? 'search.memoryUnavailable' : 'search.hint');
  for (const key of commandSearchItems.keys()) if (key.startsWith('platform:') || key.startsWith('memory:')) commandSearchItems.delete(key);
  results.forEach((item, index) => {
    if (item.type === 'memory') commandSearchItems.set(item.id, item);
    if (item.type === 'platform') { item.id = `platform:${index}`; commandSearchItems.set(item.id, item); }
    if (item.type === 'open') item.subtitle = `${item.url} · ${t('search.window', { n: commandWindowNames.get(item.windowId) || 1 })}${item.duplicateCount > 1 ? ` · ${item.duplicateCount}×` : ''}`;
    if (item.type === 'platform') item.subtitle = item.url ? `${t('search.searchPlatform')} · ${new URL(item.url).host} · ${item.query}` : `${item.platform.domain} · ${t('search.enterQuery')}`;
  });
  const container = document.getElementById('commandResults');
  const empty = document.getElementById('commandEmpty');
  commandSelectedIndex = 0;
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = results.map((item, index) => {
    const contextAction = item.snapshotId
      ? `<button class="command-context-action" data-action="restore-search-snapshot" data-search-id="${escapeHtml(item.id)}">${t('search.restore')}</button>`
      : item.groupId
        ? `<button class="command-context-action" data-action="restore-search-group" data-search-id="${escapeHtml(item.id)}">${t('search.restoreGroup')}</button>`
        : item.entryId
          ? `<button class="command-context-action" data-action="move-search-entry" data-search-id="${escapeHtml(item.id)}">${t('search.move')}</button>`
          : item.workspaceId
            ? `<button class="command-context-action" data-action="open-search-workspace" data-search-id="${escapeHtml(item.id)}">${t('search.showWorkspace')}</button>`
          : '';
    return `<div class="command-result-row"><button class="command-result ${index === 0 ? 'selected' : ''}" data-action="open-search-result" data-search-id="${escapeHtml(item.id)}">
      <span class="command-result-main"><span class="command-result-title">${escapeHtml(item.title)}</span><span class="command-result-subtitle">${escapeHtml(item.subtitle || item.url || '')}</span>${item.snippet ? `<span class="command-result-snippet">${TabOutCore.renderMemorySnippetHTML(item, escapeHtml)}</span>` : ''}</span>
      <span class="command-result-type">${escapeHtml(item.type === 'open' ? t('search.switch') : item.type === 'platform' ? t('search.searchPlatform') : searchTypeLabel(item.type))}</span>
    </button>${contextAction}</div>`;
  }).join('');
  container.style.display = results.length ? 'block' : 'none';
  empty.style.display = results.length ? 'none' : 'block';
  empty.textContent = query.trim() ? t('search.noResults') : t('search.commandEmpty');
}

async function openCommandPalette(query = '') {
  const overlay = document.getElementById('commandOverlay');
  const input = document.getElementById('commandInput');
  if (!overlay.contains(document.activeElement)) overlay._returnFocus = document.activeElement;
  overlay.style.display = 'flex';
  input.value = query;
  input.focus({ preventScroll: true });
  document.getElementById('commandEmpty').textContent = t('search.loading');
  try {
    await buildCommandSearchIndex();
    await renderCommandResults(input.value);
  } catch {
    commandSearchIndex = null;
    commandSearchItems = new Map();
    renderCommandResults('');
    document.getElementById('commandEmpty').textContent = t('search.failed');
  }
}

function closeCommandPalette() {
  commandQueryGeneration++;
  if (commandMemoryRequestId) chrome.runtime.sendMessage({ type: 'browsing-memory', action: 'cancel', payload: { requestId: commandMemoryRequestId } }).catch(() => {});
  commandMemoryRequestId = null;
  document.getElementById('commandOverlay').style.display = 'none';
}

async function renderSettings() {
  document.getElementById('settingsLanguageSelect').value = TabOutI18n.preference;
  const [stored, entitlement, bytes] = await Promise.all([
    chrome.storage.local.get(['automaticSnapshotsEnabledV1', 'workspaceAutomationEnabledV1', 'telemetryOptInV1']),
    entitlementService.current(),
    chrome.storage.local.getBytesInUse ? chrome.storage.local.getBytesInUse(null) : Promise.resolve(0),
  ]);
  document.getElementById('settingsSnapshotsInput').checked = stored.automaticSnapshotsEnabledV1 !== false;
  document.getElementById('settingsRulesInput').checked = stored.workspaceAutomationEnabledV1 !== false;
  document.getElementById('settingsTelemetryInput').checked = stored.telemetryOptInV1 === true;
  document.getElementById('settingsStorageUsage').textContent = t('settings.storageUsage', { size: (bytes / 1048576).toFixed(2) });
  document.getElementById('settingsPlanStatus').textContent = entitlement.plan === 'free'
    ? t('upgrade.freeStatus')
    : t('upgrade.activeStatus').replace('{plan}', entitlement.plan);
  document.getElementById('settingsDeactivateBtn').style.display = entitlement.plan === 'free' ? 'none' : 'inline-flex';
}

async function activateLicenseValue(value) {
  if (value.includes('.')) return entitlementService.activate(value);
  if (!globalThis.TAB_OUT_REDEMPTION_URL || !/^https:\/\//i.test(globalThis.TAB_OUT_REDEMPTION_URL)) throw new Error('Redemption is not configured');
  const stored = await chrome.storage.local.get('licenseDeviceIdV1');
  const deviceId = stored.licenseDeviceIdV1 || crypto.randomUUID();
  if (!stored.licenseDeviceIdV1) await chrome.storage.local.set({ licenseDeviceIdV1: deviceId });
  const response = await fetch(globalThis.TAB_OUT_REDEMPTION_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ licenseKey: value, deviceId }),
  });
  if (!response.ok) throw new Error('License redemption failed');
  const result = await response.json();
  const entitlement = await entitlementService.activate(result.token);
  await chrome.storage.local.set({ licenseSourceV1: { licenseKey: value, deviceId, instanceId: result.instanceId, refreshedAt: new Date().toISOString() } });
  return entitlement;
}

async function prepareSnapshotRestore(snapshotId) {
  const allSnapshots = await snapshotRepository.list();
  const sessionIndex = allSnapshots.findIndex(item => item.id === snapshotId);
  const targetSnapshot = allSnapshots[sessionIndex];
  if (!targetSnapshot) return false;
  const automaticRank = allSnapshots.slice(0, sessionIndex + 1).filter(item => (item.type || 'automatic') === 'automatic').length - 1;
  if ((targetSnapshot.type || 'automatic') === 'automatic' && automaticRank >= await entitlementService.limit('history.automatic')) {
    showToast(t('upgrade.proRequired'));
    return false;
  }
  const session = targetSnapshot;
  pendingRestoreSessionId = session.id;
  pendingRetrySession = null;
  pendingRetryGroupFailures = [];
  pendingRestoreJobId = null;
  document.getElementById('restoreConfirmBtn').textContent = t('restore.confirm');
  const plan = TabOutCore.planRestore(session, openTabs, { skipDuplicates: true });
  document.getElementById('restoreSummary').textContent = t('restore.summary', {
    open: plan.summary.toOpen, duplicates: plan.summary.duplicates, unsupported: plan.summary.unsupported,
  });
  document.getElementById('restoreOverlay').style.display = 'flex';
  return true;
}

async function renderCleanup() {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({}), chrome.storage.local.get('cleanupWhitelistV2'),
  ]);
  const whitelist = stored.cleanupWhitelistV2 || [];
  const analysis = TabOutCore.analyzeCleanup(tabs, { whitelist, staleDays: 14, overloadThreshold: 30 });
  const reasons = new Map();
  analysis.duplicates.forEach(tab => reasons.set(tab.id, t('cleanup.duplicate')));
  analysis.stale.forEach(tab => { if (!reasons.has(tab.id)) reasons.set(tab.id, t('cleanup.stale')); });
  const candidates = [...new Map([...analysis.duplicates, ...analysis.stale].map(tab => [tab.id, tab])).values()];
  document.getElementById('cleanupSummary').textContent = t('cleanup.summary', {
    duplicates: analysis.duplicates.length, stale: analysis.stale.length, protected: analysis.protected.length,
  });
  document.getElementById('cleanupList').innerHTML = candidates.length ? candidates.map(tab => `
    <label class="cleanup-item">
      <input type="checkbox" class="cleanup-checkbox" value="${tab.id}" ${analysis.duplicates.some(item => item.id === tab.id) ? 'checked' : ''}>
      <span class="cleanup-item-info"><span class="cleanup-item-title">${escapeHtml(tab.title || tab.url)}</span><span class="cleanup-item-reason">${escapeHtml(reasons.get(tab.id))}</span></span>
    </label>`).join('') : `<div class="trash-empty">${t('cleanup.none')}</div>`;
  document.getElementById('cleanupApplyBtn').style.display = candidates.length ? 'inline-flex' : 'none';
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${t('empty.inboxZero')}</div>
      <div class="empty-subtitle">${t('empty.youAreFree')}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = t('empty.zeroDomains');
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return t('time.justNow');
  if (diffMins < 60)  return t('time.minAgo', { n: diffMins });
  if (diffHours < 24) return t(diffHours !== 1 ? 'time.hrsAgo' : 'time.hrAgo', { n: diffHours });
  if (diffDays === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: diffDays });
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  return t('greeting.evening');
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  const locale = _currentLocale;
  return new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return t('title.substack', { name: capitalize(hostname.replace('.substack.com', '')) });
  }
  if (hostname.endsWith('.github.io')) {
    return t('title.githubPages', { name: capitalize(hostname.replace('.github.io', '')) });
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? t('title.postBy', { user: username }) : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return t('title.issue', { repo: `${owner}/${repo}`, n: rest[1] });
      if (rest[0] === 'pull'   && rest[1]) return t('title.pr', { repo: `${owner}/${repo}`, n: rest[1] });
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return t('title.youtubeVideo');
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return t('title.redditPost', { sub: parts[subIdx + 1] });
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];
const selectedSaveTabIds = new Set();
function updateTabsSelectionToolbar() {
  const toolbar = document.getElementById('tabsSelectionToolbar');
  if (!toolbar) return;
  const chips = [...document.querySelectorAll('#openTabsMissions .page-chip[data-tab-id]')];
  for (const chip of chips) {
    const selected = selectedSaveTabIds.has(Number(chip.dataset.tabId)) && Boolean(TabOutCore.normalizeWebUrl(chip.dataset.tabUrl));
    chip.classList.toggle('selected-for-workspace', selected);
    chip.querySelector('.chip-select')?.setAttribute('aria-pressed', String(selected));
  }
  toolbar.hidden = !selectedSaveTabIds.size;
  document.getElementById('tabsSelectionSummary').textContent = t('savedFlow.selected', { n: selectedSaveTabIds.size });
  document.getElementById('tabsSelectionSaveBtn').textContent = t('savedFlow.saveSelected', { n: selectedSaveTabIds.size });
  document.getElementById('tabsSelectionClearBtn').textContent = t('project.clearSelection');
  document.getElementById('tabsSelectionHint').textContent = t('savedFlow.selectHint');
}
let openTabsViewMode = 'domain';


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(tab => tab.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const textEl  = document.getElementById('tabOutDupeText');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (textEl) textEl.innerHTML = t('banner.dupeText', { n: tabOutTabs.length });
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    const safeLabel = escapeHtml(label);
    const faviconUrl = tab.url
      ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16`
      : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${safeLabel}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-select" data-action="select-workspace-tab" aria-pressed="false" ${TabOutCore.normalizeWebUrl(tab.url) ? '' : 'disabled'} aria-label="${t('savedFlow.selectPage')}" title="${t('savedFlow.selectPage')}">✓</button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('btn.saveForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('btn.closeThisTab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${t('overflow.more', { n: hiddenTabs.length })}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tPlural('label.tabOpen', 'label.tabsOpen', tabCount)}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${tPlural('label.duplicate', 'label.duplicates', totalExtras)}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    const safeLabel = escapeHtml(label);
    const faviconUrl = tab.url
      ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16`
      : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${safeLabel}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-select" data-action="select-workspace-tab" aria-pressed="false" ${TabOutCore.normalizeWebUrl(tab.url) ? '' : 'disabled'} aria-label="${t('savedFlow.selectPage')}" title="${t('savedFlow.selectPage')}">✓</button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('btn.saveForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('btn.closeThisTab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `<details class="tabs-card-menu"><summary>${t('savedFlow.more')}</summary><button class="project-button" data-action="select-domain-tabs" data-domain-id="${stableId}">${t('savedFlow.selectGroup')}</button><button class="project-button" data-action="close-domain-tabs" data-domain-id="${stableId}">${t('btn.close')} ${tabCount}</button></details>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${tPlural('btn.closeDupe', 'btn.closeDupePlural', totalExtras)}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHtml(isLanding ? t('label.homepages') : (group.label || friendlyDomain(group.domain)))}</span>
          ${tabBadge}
          ${dupeBadge}

        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = tPlural('label.item', 'label.items', active.length);
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=16`;
  const ago = timeAgo(item.savedAt);
  const safeId = escapeHtml(item.id);
  const safeUrl = escapeHtml(item.url);
  const safeTitle = escapeHtml(item.title || item.url);

  return `
    <div class="deferred-item" data-deferred-id="${safeId}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${safeId}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="deferred-title" title="${safeTitle}">
          <img src="${escapeHtml(faviconUrl)}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" class="deferred-favicon">${safeTitle}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${safeId}" title="${t('btn.dismiss')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeUrl = escapeHtml(item.url);
  const safeTitle = escapeHtml(item.title || item.url);
  return `
    <div class="archive-item">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title" title="${safeTitle}">
        ${safeTitle}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Set document language ---
  const htmlRoot = document.getElementById('htmlRoot');
  if (htmlRoot) htmlRoot.lang = _currentLocale;

  // --- Localize static HTML elements ---
  const deferredTitle = document.getElementById('deferredTitle');
  if (deferredTitle) deferredTitle.textContent = t('section.savedForLater');
  const deferredEmptyText = document.getElementById('deferredEmptyText');
  if (deferredEmptyText) deferredEmptyText.textContent = t('empty.nothingSaved');
  const archiveLabel = document.getElementById('archiveLabel');
  if (archiveLabel) archiveLabel.textContent = t('btn.archive');
  const archiveSearch = document.getElementById('archiveSearch');
  if (archiveSearch) archiveSearch.placeholder = t('search.archivePlaceholder');
  const statLabel = document.getElementById('statLabel');
  if (statLabel) statLabel.textContent = t('label.openTabs');
  const closeExtrasBtn = document.getElementById('closeExtrasBtn');
  if (closeExtrasBtn) closeExtrasBtn.textContent = t('btn.closeExtras');

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  const { openTabsViewModeV1 = 'domain' } = await chrome.storage.local.get('openTabsViewModeV1');
  openTabsViewMode = openTabsViewModeV1 === 'window' ? 'window' : 'domain';

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge optional patterns from the packaged config.js defaults.
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  const readableWindows = new Map([...new Set(realTabs.map(tab => tab.windowId))].sort((a, b) => a - b).map((id, index) => [id, index + 1]));
  for (const tab of realTabs) {
    try {
      if (openTabsViewMode === 'window') {
        const key = `__window-${tab.windowId}`;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: `${t('view.windowName', { n: readableWindows.get(tab.windowId) })} · ${TabOutCore.savedDefaultName([tab])}`, windowId: tab.windowId, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (openTabsViewMode === 'domain' && landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then alphabetically by domain name
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    if (openTabsViewMode === 'window') return a.windowId - b.windowId;
    return a.domain.localeCompare(b.domain, undefined, { sensitivity: 'base' });
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.openTabs');
    const groupCount = openTabsViewMode === 'window'
      ? t('view.windowCount', { n: domainGroups.length })
      : tPlural('label.domain', 'label.domains', domainGroups.length);
    openTabsSectionCount.innerHTML = `${escapeHtml(groupCount)} <span class="tabs-view-toggle"><button data-action="switch-tabs-view" data-view="domain" class="${openTabsViewMode === 'domain' ? 'active' : ''}">${t('view.domain')}</button><button data-action="switch-tabs-view" data-view="window" class="${openTabsViewMode === 'window' ? 'active' : ''}">${t('view.window')}</button></span><details class="tabs-bulk-menu" id="tabsBulkMenu"><summary>${t('savedFlow.more')}</summary><button class="project-button" data-action="select-all-saveable">${t('savedFlow.selectAll')}</button><button class="project-button" data-action="close-all-open-tabs">${tPlural('btn.closeAll', 'btn.closeAllPlural', realTabs.length)}</button></details>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
    const openIds = new Set(realTabs.filter(tab => TabOutCore.normalizeWebUrl(tab.url)).map(tab => tab.id));
    for (const id of selectedSaveTabIds) if (!openIds.has(id)) selectedSaveTabIds.delete(id);
    updateTabsSelectionToolbar();
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // Hide broken favicons (inline onerror blocked by extension CSP)
  document.querySelectorAll('.chip-favicon, .deferred-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });

  // --- Render Tab Groups (OneTab) ---
  await renderTabGroups();
  await globalThis.tabOutProjectWorkbench?.refresh();
}

function localizeDashboardChrome() {
  document.getElementById('trashOpenBtn').textContent = t('btn.trash');
  document.getElementById('trashTitle').textContent = t('trash.title');
  document.getElementById('trashSubtitle').textContent = t('trash.subtitle');
  document.getElementById('trashEmpty').textContent = t('trash.empty');
  document.getElementById('trashClearBtn').textContent = t('btn.clearTrash');
  document.getElementById('historyOpenBtn').textContent = t('btn.history');
  document.getElementById('historyTitle').textContent = t('history.title');
  document.getElementById('historySubtitle').textContent = t('history.subtitle');
  document.getElementById('historyEmpty').textContent = t('history.empty');
  document.getElementById('operationHistoryTitle').textContent = t('operation.title');
  document.getElementById('operationHistoryEmpty').textContent = t('operation.empty');
  document.getElementById('saveSnapshotBtn').textContent = t('btn.saveSnapshot');
  document.getElementById('workspacesOpenBtn').textContent = t('saved.advanced');
  document.getElementById('workspacesTitle').textContent = t('workspaces.title');
  document.getElementById('workspacesSubtitle').textContent = t('workspaces.subtitle');
  document.getElementById('workspaceEmpty').textContent = t('workspaces.empty');
  document.getElementById('saveWorkspaceBtn').textContent = t('workspaces.saveCurrent');
  document.getElementById('createTemplateBtn').textContent = t('workspaces.fromTemplate');
  document.getElementById('commandInput').placeholder = t('search.commandPlaceholder');
  document.getElementById('searchOpenBtn').textContent = t('search.open');
  document.getElementById('platformSettingsBtn').textContent = t('search.platformSettings');
  document.getElementById('commandHint').textContent = t('search.hint');
  document.getElementById('commandInput').setAttribute('aria-label', t('search.open'));
  document.getElementById('cleanupOpenBtn').textContent = t('cleanup.open');
  document.getElementById('cleanupTitle').textContent = t('cleanup.title');
  document.getElementById('cleanupSubtitle').textContent = t('cleanup.subtitle');
  document.getElementById('cleanupWhitelistInput').placeholder = t('cleanup.whitelist');
  document.getElementById('cleanupWhitelistBtn').textContent = t('cleanup.addWhitelist');
  document.getElementById('cleanupApplyBtn').textContent = t('cleanup.apply');
  document.getElementById('workspaceSuggestionsTitle').textContent = t('workspaces.suggestions');
  document.getElementById('workspaceRulesTitle').textContent = t('workspaces.rules');
  document.getElementById('workspaceRuleExclusionInput').placeholder = t('workspaces.exclusionPrompt');
  document.getElementById('workspaceRuleExclusionBtn').textContent = t('workspaces.addExclusion');
  const settingsText = {
    settingsOpenBtn: 'settings.open', settingsTitle: 'settings.title', settingsSubtitle: 'settings.subtitle',
    settingsPrivacyTitle: 'settings.privacyTitle', settingsPrivacyText: 'settings.privacyText',
    settingsTelemetryLabel: 'settings.telemetry', settingsRecoveryTitle: 'settings.recoveryTitle',
    settingsSnapshotsLabel: 'settings.snapshots', settingsAutomationTitle: 'settings.automationTitle',
    settingsRulesLabel: 'settings.rules', settingsDataTitle: 'settings.dataTitle', settingsDataText: 'settings.dataText',
    settingsExportBtn: 'settings.export', settingsImportBtn: 'settings.import', settingsPlanTitle: 'settings.planTitle',
    settingsUpgradeBtn: 'upgrade.open', settingsDeactivateBtn: 'settings.deactivate', settingsSyncTitle: 'settings.syncTitle',
    settingsSyncStatus: 'settings.syncDeferred', settingsMemoryTitle: 'memory.settings', settingsMemoryText: 'settings.memoryText', settingsMemoryBtn: 'settings.memoryOpen', settingsMemoryExportBtn: 'memory.export',
  };
  Object.entries(settingsText).forEach(([id, key]) => { document.getElementById(id).textContent = t(key); });
  const importText = {
    importPreviewTitle: 'import.title', importStrategyMerge: 'import.merge', importStrategyReplace: 'import.replace',
    importPreviewWarning: 'import.warning', importCancelBtn: 'restore.cancel', importConfirmBtn: 'import.confirm',
  };
  Object.entries(importText).forEach(([id, key]) => { document.getElementById(id).textContent = t(key); });
  const upgradeText = {
    upgradeTitle: 'upgrade.title', upgradeSubtitle: 'upgrade.subtitle',
    proLifetimeTitle: 'upgrade.lifetimeTitle', proLifetimeText: 'upgrade.lifetimeText',
    syncPlanTitle: 'upgrade.syncTitle', syncPlanText: 'upgrade.syncText',
    buyLifetimeBtn: 'upgrade.buyLifetime', buySyncBtn: 'upgrade.buySync',
    activateLicenseBtn: 'upgrade.activate',
  };
  Object.entries(upgradeText).forEach(([id, key]) => { document.getElementById(id).textContent = t(key); });
  const checkout = globalThis.TAB_OUT_CHECKOUT_URLS?.pro_lifetime || globalThis.TAB_OUT_CHECKOUT_URL;
  document.getElementById('proLifetimeOffer').hidden = !/^https:\/\//i.test(checkout || '');
  document.getElementById('syncOffer').hidden = true;
  document.getElementById('licenseTokenInput').placeholder = t('upgrade.tokenPlaceholder');
  const restoreText = {
    restoreTitle: 'restore.title', restoreModeNew: 'restore.modeNew', restoreModeMerge: 'restore.modeMerge',
    restoreModeReplace: 'restore.modeReplace', restoreSkipText: 'restore.skipDuplicates',
    restoreWarning: 'restore.replaceWarning', restoreCancelBtn: 'restore.cancel', restoreConfirmBtn: 'restore.confirm',
  };
  Object.entries(restoreText).forEach(([id, key]) => { document.getElementById(id).textContent = t(key); });
  const onboardingText = {
    onboardingTitle: 'onboarding.title', onboardingLead: 'onboarding.lead',
    onboardingStep1Title: 'onboarding.step1Title', onboardingStep1Text: 'onboarding.step1Text',
    onboardingStep2Title: 'onboarding.step2Title', onboardingStep2Text: 'onboarding.step2Text',
    onboardingStep3Title: 'onboarding.step3Title', onboardingStep3Text: 'onboarding.step3Text',
    onboardingPrivacyTitle: 'onboarding.privacyTitle', onboardingPrivacyText: 'onboarding.privacyText',
    onboardingStartBtn: 'onboarding.start',
  };
  Object.entries(onboardingText).forEach(([id, key]) => { document.getElementById(id).textContent = t(key); });
  document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
  document.getElementById('dashboardCredit').textContent = t('dashboard.credit');
  document.getElementById('upgradePerYear').textContent = t('upgrade.perYear');
  document.getElementById('settingsLanguageTitle').textContent = t('settings.languageTitle');
  document.getElementById('settingsLanguageLabel').textContent = t('settings.languageLabel');
  document.getElementById('settingsLanguageHint').textContent = t('settings.languageHint');
  document.getElementById('settingsLanguageSelect').options[0].textContent = t('settings.languageAuto');
  document.getElementById('settingsLanguageSelect').value = TabOutI18n.preference;
}

async function renderDashboard() {
  await TabOutI18n.ready;
  initializeProjectWorkbench();
  await TabOutCore.runStorageMigration(chrome.storage.local, { deviceId: 'local' });
  localizeDashboardChrome();
  const { onboardingV1 = false } = await chrome.storage.local.get('onboardingV1');
  if (!onboardingV1) document.getElementById('onboardingOverlay').style.display = 'flex';
  await renderStaticDashboard();
  const recentUndo = await latestUndoableOperation();
  if (recentUndo) showToast(t('toast.undoAvailable'), { undoOperationId: recentUndo.id });
  const resumableJob = await restoreJobRepository.latestResumable();
  if (resumableJob) {
    await fetchOpenTabs();
    pendingRestoreJobId = resumableJob.id;
    pendingRetrySession = TabOutCore.planRestore(resumableJob.session, openTabs, { skipDuplicates: true });
    pendingRetryGroupFailures = Array.isArray(resumableJob.groupFailures) ? resumableJob.groupFailures : [];
    document.getElementById('restoreSummary').textContent = t('restore.resume', { n: pendingRetrySession.summary?.toOpen || pendingRetrySession.stats?.tabCount || 0 });
    document.getElementById('restoreConfirmBtn').textContent = t('restore.retry');
    document.querySelector('input[name="restoreMode"][value="merge"]').checked = true;
    document.getElementById('restoreWarning').style.display = 'none';
    document.getElementById('restoreOverlay').style.display = 'flex';
  }
  if (location.hash.startsWith('#search=')) {
    const params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname);
    await openCommandPalette(params.get('search') || '');
    if (params.get('error')) showToast(t(params.get('error') === 'search.stale' ? 'search.stale' : 'search.failed'));
  }
  await consumeProjectCaptureRequest();
  const { openCommandOnLoad = false } = await chrome.storage.local.get('openCommandOnLoad');
  if (openCommandOnLoad) {
    await chrome.storage.local.set({ openCommandOnLoad: false });
    await openCommandPalette();
  }
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'clear-selected-tabs') { selectedSaveTabIds.clear(); updateTabsSelectionToolbar(); return; }
  if (action === 'save-selected-tabs') {
    const tabs = (await chrome.tabs.query({})).filter(tab => selectedSaveTabIds.has(tab.id) && TabOutCore.normalizeWebUrl(tab.pendingUrl || tab.url));
    await saveTabsToWorkspace(tabs); return;
  }
  if (action === 'select-domain-tabs' || action === 'select-all-saveable') {
    const tabs = action === 'select-all-saveable' ? await chrome.tabs.query({}) : domainGroups.find(item => `domain-${item.domain.replace(/[^a-z0-9]/g, '-')}` === actionEl.dataset.domainId)?.tabs || [];
    for (const tab of tabs) if (TabOutCore.normalizeWebUrl(tab.pendingUrl || tab.url) && !tab.incognito) selectedSaveTabIds.add(tab.id);
    actionEl.closest('details')?.removeAttribute('open'); updateTabsSelectionToolbar(); return;
  }
  if (action === 'open-memory-settings' || action === 'export-memory') {
    document.getElementById('settingsOverlay').style.display = 'none';
    globalThis.tabOutDashboardNavigation?.show('memory');
    document.getElementById('memorySettings').open = true;
    if (action === 'export-memory') document.getElementById('memoryExportBtn').click();
    else document.getElementById('memorySettingsToggle').focus({ preventScroll: true });
    document.getElementById('memorySettings').scrollIntoView({ block: 'start' });
    return;
  }
  if (action === 'open-platform-settings') { closeCommandPalette(); TabOutCore.openSearchPlatformSettings(); return; }
  if (action === 'open-command') {
    await openCommandPalette();
    return;
  }
  if (action === 'switch-tabs-view') {
    await chrome.storage.local.set({ openTabsViewModeV1: actionEl.dataset.view === 'window' ? 'window' : 'domain' });
    await renderStaticDashboard();
    return;
  }
  if (action === 'open-cleanup') {
    await renderCleanup();
    document.getElementById('cleanupOverlay').style.display = 'flex';
    return;
  }
  if (action === 'close-cleanup') {
    document.getElementById('cleanupOverlay').style.display = 'none';
    return;
  }
  if (action === 'add-cleanup-whitelist') {
    const input = document.getElementById('cleanupWhitelistInput');
    const domain = input.value.trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(domain)) { showToast(t('toast.invalidUrl')); return; }
    const { cleanupWhitelistV2 = [] } = await chrome.storage.local.get('cleanupWhitelistV2');
    await chrome.storage.local.set({ cleanupWhitelistV2: [...new Set([...cleanupWhitelistV2, domain])] });
    input.value = '';
    await renderCleanup();
    return;
  }
  if (action === 'apply-cleanup') {
    const ids = [...document.querySelectorAll('.cleanup-checkbox:checked')].map(input => Number(input.value)).filter(Number.isInteger);
    if (!ids.length) return;
    const operation = await operationService.close(ids, { source: 'cleanup-suggestions' });
    document.getElementById('cleanupOverlay').style.display = 'none';
    showCloseResult(operation, t('toast.allClosed'));
    await renderDashboard();
    return;
  }

  if (action === 'open-search-result') {
    const item = commandSearchItems.get(actionEl.dataset.searchId);
    if (!item) return;
    telemetry.record('search_completed', { source_filters: item.type || 'unknown', result_bucket: 'selected', action_type: 'open' }).catch(() => {});
    if (item.type === 'platform' && !item.url) {
      const input = document.getElementById('commandInput');
      input.value = `${item.platform.name} `;
      await renderCommandResults(input.value);
      input.focus();
      return;
    }
    try {
      if (item.url) await TabOutCore.activateSearchResult(item, chrome);
      else if (item.workspaceId) {
        await renderWorkspaces();
        document.getElementById('workspacesOverlay').style.display = 'flex';
      }
      closeCommandPalette();
    } catch (error) {
      showToast(t(error.message === 'search.stale' ? 'search.stale' : 'search.failed'));
      await openCommandPalette(document.getElementById('commandInput').value);
    }
    return;
  }
  if (action === 'restore-search-snapshot' || action === 'restore-search-group' || action === 'open-search-workspace' || action === 'move-search-entry') {
    const item = commandSearchItems.get(actionEl.dataset.searchId);
    if (!item) return;
    closeCommandPalette();
    if (action === 'restore-search-snapshot') await prepareSnapshotRestore(item.snapshotId);
    if (action === 'restore-search-group') await restoreTabGroup(item.groupId);
    if (action === 'open-search-workspace') {
      await renderWorkspaces();
      document.getElementById('workspacesOverlay').style.display = 'flex';
    }
    if (action === 'move-search-entry') {
      const workspaces = (await workspaceRepository.list()).filter(workspace => workspace.id !== item.workspaceId);
      if (!workspaces.length) { showToast(t('workspaces.noTarget')); return; }
      const selected = prompt(`${t('workspaces.chooseTarget')}\n${workspaces.map((workspace, index) => `${index + 1}. ${workspace.name}`).join('\n')}`);
      const target = workspaces[Number(selected) - 1];
      if (target) {
        await workspaceRepository.transferEntry(item.workspaceId, target.id, item.entryId);
        showToast(t('workspaces.moved'));
      }
    }
    return;
  }

  if (action === 'finish-onboarding') {
    await chrome.storage.local.set({ onboardingV1: true });
    document.getElementById('onboardingOverlay').style.display = 'none';
    return;
  }

  if (action === 'open-settings') {
    await renderSettings();
    document.getElementById('settingsOverlay').style.display = 'flex';
    return;
  }
  if (action === 'close-settings') {
    document.getElementById('settingsOverlay').style.display = 'none';
    return;
  }
  if (action === 'settings-export') { await exportConfig(); return; }
  if (action === 'settings-import') { document.getElementById('shortcutImportFile').click(); return; }
  if (action === 'cancel-import-preview') {
    importGeneration++;
    pendingImport = null;
    document.getElementById('importPreviewOverlay').style.display = 'none';
    return;
  }
  if (action === 'confirm-import-preview') {
    if (!pendingImport) return;
    const strategy = document.querySelector('input[name="importStrategy"]:checked')?.value || 'merge';
    const current = await chrome.storage.local.get(Object.keys(pendingImport.data));
    await chrome.storage.local.set({ importBackupV2: { createdAt: new Date().toISOString(), data: current } });
    await workspaceRepository.importData(pendingImport.data, { strategy });
    const count = pendingImport.itemCount;
    pendingImport = null;
    document.getElementById('importPreviewOverlay').style.display = 'none';
    await initShortcuts();
    await renderDashboard();
    showToast(tPlural('toast.imported', 'toast.importedPlural', count));
    return;
  }
  if (action === 'deactivate-license') {
    await entitlementService.deactivate();
    await chrome.storage.local.remove(['licenseSourceV1']);
    await renderSettings();
    await renderDashboard();
    return;
  }

  if (action === 'open-upgrade') {
    const entitlement = await entitlementService.current();
    telemetry.record('paywall_viewed', { feature: actionEl.dataset.feature || 'upgrade', plan: entitlement.plan }).catch(() => {});
    renderUpgradeStatus(entitlement.plan);
    document.getElementById('upgradeOverlay').style.display = 'flex';
    return;
  }
  if (action === 'close-upgrade') {
    document.getElementById('upgradeOverlay').style.display = 'none';
    return;
  }
  if (action === 'start-checkout') {
    const configuredUrl = globalThis.TAB_OUT_CHECKOUT_URLS?.[actionEl.dataset.plan] || globalThis.TAB_OUT_CHECKOUT_URL;
    if (actionEl.dataset.plan === 'sync') return;
    if (!configuredUrl || !/^https:\/\//i.test(configuredUrl)) { showToast(t('upgrade.checkoutUnavailable')); return; }
    const checkoutUrl = new URL(configuredUrl);
    if (!globalThis.TAB_OUT_CHECKOUT_URLS?.[actionEl.dataset.plan]) checkoutUrl.searchParams.set('plan', actionEl.dataset.plan);
    await chrome.tabs.create({ url: checkoutUrl.toString() });
    return;
  }
  if (action === 'activate-license') {
    try {
      const entitlement = await activateLicenseValue(document.getElementById('licenseTokenInput').value.trim());
      telemetry.record('purchase_completed', { plan: entitlement.plan }).catch(() => {});
      document.getElementById('upgradeOverlay').style.display = 'none';
      showToast(t('upgrade.activated'));
      await renderDashboard();
    } catch { showToast(t('upgrade.invalidLicense')); }
    return;
  }

  if (action === 'open-trash') {
    await renderTrash();
    document.getElementById('trashOverlay').style.display = 'flex';
    return;
  }
  if (action === 'open-history') {
    await renderHistory();
    document.getElementById('historyOverlay').style.display = 'flex';
    return;
  }
  if (action === 'open-workspaces') {
    await renderWorkspaces();
    document.getElementById('workspacesOverlay').style.display = 'flex';
    return;
  }
  if (action === 'close-workspaces') {
    document.getElementById('workspacesOverlay').style.display = 'none';
    return;
  }
  if (action === 'save-current-workspace') {
    document.getElementById('workspacesOverlay').style.display = 'none';
    const current = await chrome.windows.getCurrent();
    await openProjectSavePreview('save', (await chrome.tabs.query({ windowId: current.id })).filter(tab => TabOutCore.normalizeWebUrl(tab.pendingUrl || tab.url)), { windowId: current.id, acrossWindows: false });
    return;
  }
  if (action === 'open-workspace') {
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    if (!workspace) return;
    const allTabs = await chrome.tabs.query({});
    const openUrls = new Set(allTabs.map(tab => TabOutCore.normalizeWebUrl(tab.url)).filter(Boolean));
    const missing = workspace.entries.filter(entry => !openUrls.has(entry.url));
    for (const entry of missing) await chrome.tabs.create({ url: entry.url, active: false });
    showToast(t('toast.workspaceOpened'));
    return;
  }
  if (action === 'open-all-workspace') {
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    if (!workspace) return;
    for (const entry of workspace.entries) await chrome.tabs.create({ url: entry.url, active: false });
    showToast(t('toast.workspaceOpened'));
    return;
  }
  if (action === 'delete-workspace') {
    await deleteProject(actionEl.dataset.workspaceId);
    await renderWorkspaces();
    return;
  }
  if (action === 'rename-workspace') {
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    const name = prompt(t('workspaces.namePrompt'), workspace?.name || '')?.trim();
    if (name) {
      const description = prompt(t('workspaces.descriptionPrompt'), workspace?.description || '');
      const icon = prompt(t('workspaces.iconPrompt'), workspace?.icon || '');
      await workspaceRepository.update(workspace.id, { name, description: description ?? workspace.description, icon: icon ?? workspace.icon });
    }
    await renderWorkspaces();
    return;
  }
  if (action === 'move-workspace-up' || action === 'move-workspace-down') {
    const workspaces = await workspaceRepository.list();
    const index = workspaces.findIndex(item => item.id === actionEl.dataset.workspaceId);
    await workspaceRepository.move(actionEl.dataset.workspaceId, index + (action === 'move-workspace-up' ? -1 : 1));
    await renderWorkspaces();
    return;
  }
  if (['open-selected-entries', 'move-selected-entries', 'copy-selected-entries', 'delete-selected-entries'].includes(action)) {
    const card = actionEl.closest('.workspace-card');
    const entryIds = [...card.querySelectorAll('.workspace-entry-select:checked')].map(input => input.value);
    if (!entryIds.length) return;
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    if (action === 'open-selected-entries') {
      for (const entry of workspace.entries.filter(item => entryIds.includes(item.id))) await chrome.tabs.create({ url: entry.url, active: false });
    } else if (action === 'delete-selected-entries') {
      await workspaceRepository.removeEntries(workspace.id, entryIds);
    } else {
      const target = card.querySelector('.workspace-target-select')?.value || '';
      const separator = target.indexOf(':');
      const targetType = target.slice(0, separator), targetId = target.slice(separator + 1);
      if (targetType === 'workspace' && targetId) await workspaceRepository.transferEntries(workspace.id, targetId, entryIds, { copy: action === 'copy-selected-entries' });
    }
    await renderWorkspaces();
    return;
  }
  if (action === 'move-selected-collected' || action === 'copy-selected-collected') {
    const card = actionEl.closest('.workspace-collected-card');
    const indexes = [...card.querySelectorAll('.collected-entry-select:checked')].map(input => Number(input.value)).filter(Number.isInteger);
    const workspaceId = card.querySelector('.collected-target-select')?.value;
    if (!indexes.length || !workspaceId) return;
    await collectionTransferService.groupToWorkspace(actionEl.dataset.groupId, indexes, workspaceId, { copy: action === 'copy-selected-collected' });
    await renderWorkspaces();
    await renderTabGroups();
    return;
  }
  if (action === 'pin-workspace') {
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    if (workspace) {
      const workspaces = await workspaceRepository.list();
      await workspaceRepository.update(workspace.id, { pinned: !workspace.pinned, order: workspace.pinned ? workspaces.length : -1 });
    }
    await renderWorkspaces();
    return;
  }
  if (action === 'save-workspace-template') {
    if (!await entitlementService.has('templates.enabled')) { showToast(t('upgrade.proRequired')); return; }
    const workspace = await workspaceRepository.get(actionEl.dataset.workspaceId);
    if (!workspace) return;
    const includeUrls = confirm(t('workspaces.includeUrls'));
    const template = templateService.createFromWorkspace(workspace, { includeUrls });
    const { workspaceTemplatesV2 = [] } = await chrome.storage.local.get('workspaceTemplatesV2');
    await chrome.storage.local.set({ workspaceTemplatesV2: [...workspaceTemplatesV2, template] });
    await renderWorkspaces();
    showToast(t('toast.templateSaved'));
    return;
  }
  if (action === 'create-from-template') {
    if (!await entitlementService.has('templates.enabled')) { showToast(t('upgrade.proRequired')); return; }
    const workspaces = await workspaceRepository.list();
    if (workspaces.length >= await entitlementService.limit('workspaces.limit')) { showToast(t('workspaces.limit')); return; }
    const select = document.getElementById('workspaceTemplateSelect');
    const template = select._templates?.find(item => item.id === select.value);
    if (!template) return;
    await templateService.instantiate(template, { workspaceRepository, ruleRepository });
    await renderWorkspaces();
    showToast(t('toast.workspaceSaved'));
    return;
  }
  if (action === 'add-workspace-rule') {
    if (!await entitlementService.has('rules.enabled')) { showToast(t('upgrade.proRequired')); return; }
    const pattern = prompt(t('workspaces.rulePrompt'))?.trim();
    if (!pattern) return;
    try {
      const matcher = TabOutCore.compilePattern(pattern);
      const matches = openTabs.filter(tab => matcher(tab.url)).length;
      if (!confirm(t('workspaces.rulePreview', { n: matches }))) return;
      await ruleRepository.create({ workspaceId: actionEl.dataset.workspaceId, pattern, mode: 'suggest' });
      await renderWorkspaces();
      showToast(t('toast.ruleSaved'));
    } catch (error) {
      showToast(t('toast.invalidUrl'));
    }
    return;
  }
  if (action === 'add-rule-exclusion') {
    if (!await entitlementService.has('rules.enabled')) { showToast(t('upgrade.proRequired')); return; }
    const input = document.getElementById('workspaceRuleExclusionInput');
    const pattern = input.value.trim();
    try {
      TabOutCore.compilePattern(pattern);
      const { workspaceRuleExclusionsV2 = [] } = await chrome.storage.local.get('workspaceRuleExclusionsV2');
      await chrome.storage.local.set({ workspaceRuleExclusionsV2: [...new Set([...workspaceRuleExclusionsV2, pattern])] });
      input.value = '';
      await renderWorkspaces();
    } catch { showToast(t('toast.invalidUrl')); }
    return;
  }
  if (action === 'delete-rule-exclusion') {
    const { workspaceRuleExclusionsV2 = [] } = await chrome.storage.local.get('workspaceRuleExclusionsV2');
    workspaceRuleExclusionsV2.splice(Number(actionEl.dataset.exclusionIndex), 1);
    await chrome.storage.local.set({ workspaceRuleExclusionsV2 });
    await renderWorkspaces();
    return;
  }
  if (action === 'accept-workspace-suggestion' || action === 'dismiss-workspace-suggestion') {
    const { workspaceSuggestionsV2 = [] } = await chrome.storage.local.get('workspaceSuggestionsV2');
    const suggestion = workspaceSuggestionsV2.find(item => item.id === actionEl.dataset.suggestionId);
    if (suggestion && action === 'accept-workspace-suggestion') {
      await workspaceRepository.addEntries(suggestion.workspaceId, [{ url: suggestion.url, title: suggestion.title }]);
    }
    await chrome.storage.local.set({ workspaceSuggestionsV2: workspaceSuggestionsV2.filter(item => item.id !== actionEl.dataset.suggestionId) });
    await renderWorkspaces();
    return;
  }
  if (action === 'delete-workspace-rule') {
    await ruleRepository.remove(actionEl.dataset.ruleId);
    await renderWorkspaces();
    return;
  }
  if (action === 'close-history') {
    document.getElementById('historyOverlay').style.display = 'none';
    return;
  }
  if (action === 'save-snapshot') {
    const snapshots = await snapshotRepository.list();
    const manualCount = snapshots.filter(item => item.type === 'manual').length;
    if (manualCount >= await entitlementService.limit('manualSnapshots.limit')) { showToast(t('upgrade.proRequired')); return; }
    const note = prompt(t('history.notePrompt'), '') ?? '';
    const session = await sessionAdapter.captureAll('manual', { source: 'manual-history', note });
    try { await snapshotRepository.add(session); }
    catch { showToast(t('history.capacityError')); return; }
    telemetry.record('snapshot_created', { type: 'manual', tab_count_bucket: countBucket(session.tabCount || 0), result: 'success' }).catch(() => {});
    await renderHistory();
    showToast(t('toast.snapshotSaved'));
    return;
  }
  if (action === 'restore-snapshot') {
    await prepareSnapshotRestore(actionEl.dataset.snapshotId);
    return;
  }
  if (action === 'cancel-restore') {
    if (pendingRestoreJobId) await restoreJobRepository.update(pendingRestoreJobId, { status: 'cancelled' });
    pendingRestoreSessionId = null;
    pendingRetrySession = null;
    pendingRetryGroupFailures = [];
    pendingRestoreJobId = null;
    document.getElementById('restoreOverlay').style.display = 'none';
    return;
  }
  if (action === 'confirm-restore') {
    const session = pendingRetrySession || await snapshotRepository.get(pendingRestoreSessionId);
    if (!session) return;
    const mode = document.querySelector('input[name="restoreMode"]:checked')?.value || 'new-window';
    const skipDuplicates = document.getElementById('restoreSkipDuplicates').checked;
    await fetchOpenTabs();
    const plan = pendingRetrySession
      ? session
      : TabOutCore.planRestore(session, openTabs, { skipDuplicates });
    if (!pendingRestoreJobId) {
      const job = await restoreJobRepository.create(plan, { mode });
      pendingRestoreJobId = job.id;
    } else {
      await restoreJobRepository.update(pendingRestoreJobId, { status: 'running', mode, session: plan });
    }
    if (mode === 'replace-current') {
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      const removable = currentTabs.filter(tab => !tab.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`));
      if (removable.length) await operationService.close(removable.map(tab => tab.id), { source: 'restore-replace' });
    }
    telemetry.record('restore_started', { mode, tab_count_bucket: countBucket(plan.tabCount || plan.windows.reduce((sum, window) => sum + window.tabs.length, 0)) }).catch(() => {});
    const retryingGroups = pendingRetryGroupFailures;
    const result = await sessionAdapter.restoreSession(plan, { mode: mode === 'new-window' ? 'new-window' : 'merge' });
    const groupRetry = retryingGroups.length ? await sessionAdapter.retryGroupFailures(retryingGroups) : { succeeded: 0, failed: [] };
    const groupFailures = [...result.failed.filter(failure => failure.code === 'group_restore_failed'), ...groupRetry.failed];
    const failures = [...result.failed, ...groupRetry.failed];
    telemetry.record('restore_completed', { mode, result: failures.length ? 'partial' : 'success', tab_count_bucket: countBucket(result.succeeded) }).catch(() => {});
    const failedIds = new Set(result.failed.map(failure => failure.tabId).filter(Boolean));
    if (failures.length > 0) {
      pendingRetrySession = {
        ...plan,
        windows: plan.windows.map(window => ({
          ...window,
          tabs: window.tabs.filter(tab => failedIds.has(tab.id)),
          groups: [],
        })).filter(window => window.tabs.length > 0),
      };
      pendingRetryGroupFailures = groupFailures;
      document.getElementById('restoreSummary').textContent = t('restore.report', {
        succeeded: result.succeeded, failed: failures.length,
      });
      document.getElementById('restoreConfirmBtn').textContent = t('restore.retry');
      document.querySelector('input[name="restoreMode"][value="merge"]').checked = true;
      document.getElementById('restoreWarning').style.display = 'none';
      await restoreJobRepository.update(pendingRestoreJobId, { status: 'partially_failed', session: pendingRetrySession, groupFailures, result: { ...result, failed: failures, groupsRetried: groupRetry.succeeded } });
    } else {
      await restoreJobRepository.update(pendingRestoreJobId, { status: 'complete', groupFailures: [], result: { ...result, groupsRetried: groupRetry.succeeded } });
      pendingRestoreSessionId = null;
      pendingRetrySession = null;
      pendingRetryGroupFailures = [];
      pendingRestoreJobId = null;
      document.getElementById('restoreOverlay').style.display = 'none';
      showToast(t('restore.report', { succeeded: result.succeeded, failed: 0 }));
    }
    return;
  }
  if (action === 'delete-snapshot') {
    const session = await snapshotRepository.get(actionEl.dataset.snapshotId);
    if (!session) return;
    const trashItem = await trashRepository.add('session', session.id, session);
    await snapshotRepository.remove(session.id);
    await renderHistory();
    showToast(t('toast.movedToTrash'), { undoTrashId: trashItem.id });
    return;
  }
  if (action === 'close-trash') {
    document.getElementById('trashOverlay').style.display = 'none';
    return;
  }
  if (action === 'restore-trash') {
    await restoreTrashItem(actionEl.dataset.trashId);
    showToast(t('toast.restoredFromTrash'));
    return;
  }
  if (action === 'undo-trash') {
    const trashId = actionEl.dataset.trashId;
    if (!trashId) return;
    actionEl.disabled = true;
    try {
      await restoreTrashItem(trashId);
      showToast(t('toast.restoredFromTrash'));
    } catch {
      showToast(t('toast.undoFailed'));
    } finally {
      actionEl.disabled = false;
    }
    return;
  }
  if (action === 'delete-trash') {
    await trashRepository.remove(actionEl.dataset.trashId);
    await renderTrash();
    return;
  }
  if (action === 'clear-trash') {
    await trashRepository.clear();
    await renderTrash();
    showToast(t('toast.trashCleared'));
    return;
  }

  if (action === 'undo-last-operation' || action === 'undo-operation') {
    const operationId = action === 'undo-operation' ? actionEl.dataset.operationId : lastUndoOperationId;
    if (!operationId) return;
    actionEl.disabled = true;
    try {
      await undoTrackedOperation(operationId);
    } catch (error) {
      console.warn('[tab-out] Undo failed:', error);
      showToast(t('toast.undoFailed'));
    } finally {
      actionEl.disabled = false;
    }
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(t('toast.closedExtras'));
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  if (action === 'select-workspace-tab') {
    e.stopPropagation();
    const chip = actionEl.closest('.page-chip');
    const selected = !chip.classList.contains('selected-for-workspace');
    const id = Number(chip.dataset.tabId);
    if (!TabOutCore.normalizeWebUrl(chip.dataset.tabUrl)) return;
    if (selected) selectedSaveTabIds.add(id); else selectedSaveTabIds.delete(id);
    updateTabsSelectionToolbar();
    return;
  }
  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    const operation = match
      ? await operationService.close([match.id], { source: 'single-tab' })
      : null;
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast(t('toast.tabClosed'), { undoOperationId: operation?.id });
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    let deferredItem;
    try {
      deferredItem = await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(t('toast.failedToSave'));
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    const operation = match
      ? await operationService.close([match.id], { source: 'defer-single-tab', deferredId: deferredItem.id })
      : null;
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(t('toast.savedForLater'), { undoOperationId: operation?.id });
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    const { deferred = [] } = await chrome.storage.local.get('deferred');
    const deleted = deferred.find(item => item.id === id);
    const trashItem = deleted ? await trashRepository.add('deferred', id, deleted) : null;
    await dismissSavedTab(id);
    if (trashItem) showToast(t('toast.movedToTrash'), { undoTrashId: trashItem.id });

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // Saving and putting away uses the same explicit project preview.
  if (action === 'collect-domain-tabs') {
    const group = domainGroups.find(item => 'domain-' + item.domain.replace(/[^a-z0-9]/g, '-') === actionEl.dataset.domainId);
    if (group) await openProjectSavePreview('park', group.tabs);
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls = group.tabs.map(t => t.url);
    const tabIds = group.tabs.map(tab => tab.id).filter(Number.isInteger);
    const operation = tabIds.length
      ? await operationService.close(tabIds, { source: 'domain', domain: group.domain })
      : null;

    const groupLabel = group.domain === '__landing-pages__' ? t('label.homepages') : (group.label || friendlyDomain(group.domain));
    if (operation && showCloseResult(operation, tPlural('toast.closedFrom', 'toast.closedFromPlural', urls.length, { label: groupLabel }))) {
      await renderDashboard();
      return;
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast(t('toast.closedDupes'));
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const closableTabs = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .filter(t => Number.isInteger(t.id));
    const { closeAllPreviewSeenV1 = false } = await chrome.storage.local.get('closeAllPreviewSeenV1');
    if (!closeAllPreviewSeenV1) {
      if (!confirm(t('confirm.closeAllPreview', { n: closableTabs.length }))) return;
      await chrome.storage.local.set({ closeAllPreviewSeenV1: true });
    }
    const operation = closableTabs.length
      ? await operationService.close(closableTabs.map(tab => tab.id), { source: 'all-tabs' })
      : null;
    if (operation && showCloseResult(operation, t('toast.allClosed'))) {
      await renderDashboard();
      return;
    }
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id === 'commandInput') {
    renderCommandResults(e.target.value);
    return;
  }
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${t('empty.noResults')}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'settingsLanguageSelect') {
    const select = e.target;
    const hadFocus = document.activeElement === select;
    const status = document.getElementById('settingsLanguageStatus');
    select.disabled = true;
    status.textContent = '';
    status.classList.remove('is-error');
    try {
      await TabOutI18n.setLanguage(select.value);
      status.textContent = t('settings.languageSaved');
    } catch {
      select.value = TabOutI18n.preference;
      status.textContent = t('settings.languageFailed');
      status.classList.add('is-error');
    } finally {
      select.disabled = false;
      if (hadFocus && document.activeElement === document.body) select.focus({ preventScroll: true });
    }
    return;
  }
  if (e.target.dataset.setting) {
    await chrome.storage.local.set({ [e.target.dataset.setting]: e.target.checked });
    return;
  }
  if (e.target.dataset.action === 'change-workspace-color') {
    await workspaceRepository.update(e.target.dataset.workspaceId, { color: e.target.value });
    await renderWorkspaces();
    return;
  }
  if (e.target.dataset.action === 'change-rule-mode') {
    await ruleRepository.update(e.target.dataset.ruleId, { mode: e.target.value });
    await renderWorkspaces();
    return;
  }
  if (e.target.name === 'restoreMode') {
    const replace = e.target.value === 'replace-current' && e.target.checked;
    document.getElementById('restoreWarning').style.display = replace ? 'block' : 'none';
  }
  if (e.target.id === 'restoreSkipDuplicates' && pendingRestoreSessionId) {
    const session = await snapshotRepository.get(pendingRestoreSessionId);
    if (!session) return;
    const plan = TabOutCore.planRestore(session, openTabs, { skipDuplicates: e.target.checked });
    document.getElementById('restoreSummary').textContent = t('restore.summary', {
      open: plan.summary.toOpen, duplicates: plan.summary.duplicates, unsupported: plan.summary.unsupported,
    });
  }
});

document.addEventListener('dragstart', (e) => {
  const entry = e.target.closest('.workspace-entry-chip');
  if (!entry || !e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('application/x-tab-out-entry', JSON.stringify(entry.dataset.workspaceId ? {
    source: 'workspace', workspaceId: entry.dataset.workspaceId, entryId: entry.dataset.entryId,
  } : {
    source: 'group', groupId: entry.dataset.groupId, tabIndex: Number(entry.dataset.tabIdx),
  }));
  entry.classList.add('dragging');
});

document.addEventListener('dragend', (e) => {
  e.target.closest('.workspace-entry-chip')?.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(card => card.classList.remove('drag-over'));
});

document.addEventListener('dragover', (e) => {
  const card = e.target.closest('[data-workspace-drop], [data-group-drop]');
  if (!card) return;
  e.preventDefault();
  card.classList.add('drag-over');
  if (e.dataTransfer) e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
});

document.addEventListener('dragleave', (e) => {
  const card = e.target.closest('[data-workspace-drop], [data-group-drop]');
  if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
});

document.addEventListener('drop', async (e) => {
  const card = e.target.closest('[data-workspace-drop], [data-group-drop]');
  if (!card || !e.dataTransfer) return;
  e.preventDefault();
  card.classList.remove('drag-over');
  try {
    const data = JSON.parse(e.dataTransfer.getData('application/x-tab-out-entry'));
    if (data.source === 'workspace' && card.dataset.workspaceDrop) {
      await workspaceRepository.transferEntry(data.workspaceId, card.dataset.workspaceDrop, data.entryId, { copy: e.altKey });
    } else if (data.source === 'workspace' && card.dataset.groupDrop) {
      await collectionTransferService.workspaceToGroup(data.workspaceId, [data.entryId], card.dataset.groupDrop, { copy: e.altKey });
    } else if (data.source === 'group' && card.dataset.workspaceDrop) {
      await collectionTransferService.groupToWorkspace(data.groupId, [data.tabIndex], card.dataset.workspaceDrop, { copy: e.altKey });
    } else return;
    await renderWorkspaces();
    await renderTabGroups();
  } catch (error) {
    console.warn('[tab-out] Workspace drop failed:', error);
  }
});


/* ----------------------------------------------------------------
   TAB GROUPS (OneTab) — collect all tabs into a group, restore later
   Stored in chrome.storage.local under "tabGroups".
   ---------------------------------------------------------------- */

async function getTabGroups() {
  await workspaceRepository.list();
  return []; // Legacy records are normalized into projects before any consumer reads.
}
async function saveTabGroups(groups) { await workspaceRepository.importLegacyGroups(groups); }
async function collectAllTabs() {
  const current = await chrome.windows.getCurrent();
  const tabs = (await chrome.tabs.query({ windowId: current.id })).filter(tab => TabOutCore.normalizeWebUrl(tab.pendingUrl || tab.url));
  await openProjectSavePreview('park', tabs, { windowId: current.id, acrossWindows: false });
}

async function legacyProject(groupId) {
  return (await workspaceRepository.list()).find(project => project.legacyGroupId === groupId || project.id === groupId);
}
async function restoreTabGroup(groupId) {
  const project = await legacyProject(groupId);
  if (!project) return;
  globalThis.tabOutDashboardNavigation?.show('projects');
  return globalThis.tabOutProjectWorkbench?.begin('resume', project.id);
}
async function deleteTabGroup(groupId) {
  const project = await legacyProject(groupId);
  if (project) { await deleteProject(project.id); await globalThis.tabOutProjectWorkbench?.refresh(); }
}
async function restoreSingleGroupTab(groupId, tabIdx) {
  const project = await legacyProject(groupId);
  const entry = project?.entries[tabIdx];
  if (entry) await TabOutCore.activateSearchResult({ type: 'workspace', url: entry.url }, chrome);
}

async function renderTabGroups() { await globalThis.tabOutProjectWorkbench?.refresh(); }

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-saved-action="continue"]');
  if (!button || button.disabled) return;
  button.disabled = true;
  const card = button.closest('.project-card');
  try {
    if (button.dataset.savedKind === 'collected') {
      const result = await restoreTabGroup(button.dataset.savedId);
      if (result) {
        const current = [...document.querySelectorAll('.project-card[data-saved-id]')].find(node => node.dataset.savedId === button.dataset.savedId);
        if (current) { current.querySelector('.saved-continue-status').textContent = t('saved.continueResult', result); current.querySelector('[data-saved-action]').textContent = t(result.failed ? 'project.retry' : 'saved.continue'); }
      }
    } else {
      const { deferred = [] } = await chrome.storage.local.get('deferred');
      const item = deferred.find(item => item.id === button.dataset.savedId);
      if (item) { await TabOutCore.activateSearchResult({ type: 'deferred', url: item.url }, chrome); card.querySelector('.saved-continue-status').textContent = t('saved.assetKept'); }
    }
  } catch { card.querySelector('.saved-continue-status').textContent = t('search.failed'); }
  finally { button.disabled = false; }
});

// ---- Tab Groups event handlers ----
document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'collect-all-tabs') {
    await collectAllTabs();
    return;
  }

  if (action === 'toggle-group') {
    const card = document.querySelector(`.tab-group-card[data-group-id="${actionEl.dataset.groupId}"]`);
    if (card) card.classList.toggle('expanded');
    return;
  }

  if (action === 'restore-group') {
    e.stopPropagation();
    await restoreTabGroup(actionEl.dataset.groupId);
    return;
  }

  if (action === 'delete-group') {
    e.stopPropagation();
    await deleteTabGroup(actionEl.dataset.groupId);
    return;
  }

  if (action === 'restore-group-tab') {
    const idx = parseInt(actionEl.dataset.tabIdx, 10);
    await restoreSingleGroupTab(actionEl.dataset.groupId, idx);
    return;
  }

  if (action === 'remove-group-tab') {
    e.stopPropagation();
    const groups = await getTabGroups();
    const group = groups.find(g => g.id === actionEl.dataset.groupId);
    if (!group) return;
    const idx = parseInt(actionEl.dataset.tabIdx, 10);
    group.tabs.splice(idx, 1);
    delete group.session;
    if (group.tabs.length === 0) {
      const gIdx = groups.indexOf(group);
      if (gIdx !== -1) groups.splice(gIdx, 1);
    }
    await saveTabGroups(groups);
    await renderTabGroups();
    return;
  }
});


/* ----------------------------------------------------------------
   SHORTCUTS SIDEBAR
   Custom bookmarks stored in chrome.storage.local under "shortcuts".
   Right-click context menu for edit/delete. Click "+" to add.
   ---------------------------------------------------------------- */

let _shortcuts = [];
let _ctxTargetId = null; // shortcut ID that the context menu is acting on

async function getShortcuts() {
  const { shortcuts = [] } = await chrome.storage.local.get('shortcuts');
  return shortcuts;
}

async function saveShortcuts(list) {
  await chrome.storage.local.set({ shortcuts: list });
  _shortcuts = list;
}

function renderShortcuts() {
  const listEl = document.getElementById('shortcutsList');
  if (!listEl) return;

  listEl.innerHTML = _shortcuts.map(sc => {
    let domain = '';
    try { domain = new URL(sc.url).hostname; } catch {}
    const letter = escapeHtml((sc.name || sc.url || '?').charAt(0));
    const safeUrl = escapeHtml(sc.url);
    const safeId = escapeHtml(sc.id);
    const safeName = escapeHtml(sc.name || domain || sc.url);
    // Use Chrome's built-in favicon cache (works for intranet sites too)
    const chromeFavicon = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(sc.url)}&size=64`;
    return `<a class="shortcut-item" href="${safeUrl}" data-shortcut-id="${safeId}" title="${escapeHtml(sc.name || '')}">
      <div class="shortcut-favicon">
        <img src="${chromeFavicon}" data-letter="${letter}" alt="">
      </div>
      <span class="shortcut-name">${safeName}</span>
    </a>`;
  }).join('');

  // Fallback to letter on error (CSP blocks inline onerror)
  listEl.querySelectorAll('.shortcut-favicon img').forEach(img => {
    img.addEventListener('error', function() {
      const letter = this.dataset.letter || '?';
      this.parentElement.innerHTML = `<span class="shortcut-favicon-letter">${letter}</span>`;
    }, { once: true });
  });
}

async function initShortcuts() {
  _shortcuts = await getShortcuts();
  renderShortcuts();

  // Localize static elements
  const addBtn = document.getElementById('shortcutAddBtn');
  if (addBtn) addBtn.title = t('shortcuts.add');
  const ctxEdit = document.getElementById('ctxEdit');
  if (ctxEdit) ctxEdit.textContent = t('shortcuts.edit');
  const ctxDelete = document.getElementById('ctxDelete');
  if (ctxDelete) ctxDelete.textContent = t('shortcuts.delete');
  const dialogNameLabel = document.getElementById('dialogNameLabel');
  if (dialogNameLabel) dialogNameLabel.textContent = t('shortcuts.name');
  const dialogUrlLabel = document.getElementById('dialogUrlLabel');
  if (dialogUrlLabel) dialogUrlLabel.textContent = t('shortcuts.url');
  const dialogCancel = document.getElementById('dialogCancel');
  if (dialogCancel) dialogCancel.textContent = t('shortcuts.cancel');
  const dialogSave = document.getElementById('dialogSave');
  if (dialogSave) dialogSave.textContent = t('shortcuts.save');
  const exportBtn = document.getElementById('shortcutExportBtn');
  if (exportBtn) exportBtn.title = t('shortcuts.export');
  const importBtn = document.getElementById('shortcutImportBtn');
  if (importBtn) importBtn.title = t('shortcuts.import');
}

/* ----------------------------------------------------------------
   EXPORT / IMPORT  —  portable, versioned backup of user assets/settings
   Chrome's sandbox can't write to arbitrary paths, so export is a
   download (lands in ~/Downloads) and import reads via <input type=file>.
   ---------------------------------------------------------------- */

async function exportConfig() {
  const state = await chrome.storage.local.get(null);
  const payload = TabOutCore.createPortableBackup(state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tab-out.config';
  document.body.appendChild(a);
  a.click();
  a.remove();
  try {
    await chrome.storage.local.set({ projectBackupStateV1: { requestedAt: new Date().toISOString() } });
    await globalThis.tabOutProjectWorkbench?.refresh();
  } catch { /* export was requested; a reminder update must not turn it into a failed export */ }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('toast.exported'));
}

async function importConfig(file) {
  const generation = ++importGeneration;
  // Selecting a new file invalidates the previous confirmation, including when
  // the replacement file is malformed, too large, or fails session validation.
  pendingImport = null;
  document.getElementById('importPreviewOverlay').style.display = 'none';
  if (file.size > 10 * 1024 * 1024) { showToast(t('toast.importFailed')); return; }
  let data;
  try {
    const text = await file.text();
    if (generation !== importGeneration) return;
    data = JSON.parse(text);
  } catch {
    if (generation !== importGeneration) return;
    showToast(t('toast.importFailed'));
    return;
  }

  const fullBackup = data?.version === 2 && data?.data;
  const validation = fullBackup
    ? TabOutCore.validatePortableBackup(data)
    : TabOutCore.validateImportPayload(data);
  if (!validation.ok) {
    showToast(t('toast.importFailed'));
    return;
  }
  const importData = fullBackup ? validation.data : Object.fromEntries(
    ['shortcuts', 'deferred', 'tabGroups'].filter(key => Array.isArray(data[key])).map(key => [key, validation.data[key]])
  );
  const current = await chrome.storage.local.get(Object.keys(importData));
  if (generation !== importGeneration) return;
  const preview = TabOutCore.mergePortableData(current, importData);
  const itemCount = fullBackup
    ? validation.report?.items || Object.keys(importData).length
    : Object.values(importData).reduce((sum, items) => sum + items.length, 0);
  pendingImport = { data: importData, itemCount, conflicts: preview.conflicts };
  document.getElementById('importPreviewSummary').textContent = t('import.summary', {
    collections: Object.keys(importData).length, items: itemCount, conflicts: preview.conflicts,
  });
  document.getElementById('importPreviewOverlay').style.display = 'flex';
}

// ---- Dialog helpers ----
let _editingId = null; // null = adding new, string = editing existing

function openShortcutDialog(id) {
  _editingId = id || null;
  const overlay = document.getElementById('shortcutDialogOverlay');
  const nameInput = document.getElementById('dialogName');
  const urlInput = document.getElementById('dialogUrl');

  if (_editingId) {
    const sc = _shortcuts.find(s => s.id === _editingId);
    nameInput.value = sc ? sc.name : '';
    urlInput.value = sc ? sc.url : '';
  } else {
    nameInput.value = '';
    urlInput.value = '';
  }

  overlay.style.display = 'flex';
  nameInput.focus();
}

function closeShortcutDialog() {
  document.getElementById('shortcutDialogOverlay').style.display = 'none';
  _editingId = null;
}

async function saveShortcutFromDialog() {
  const name = document.getElementById('dialogName').value.trim();
  let url = document.getElementById('dialogUrl').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = TabOutCore.normalizeWebUrl(url);
  if (!url) {
    showToast(t('toast.invalidUrl'));
    return;
  }

  if (_editingId) {
    const sc = _shortcuts.find(s => s.id === _editingId);
    if (sc) { sc.name = name; sc.url = url; }
  } else {
    _shortcuts.push({ id: crypto.randomUUID(), name, url });
  }

  await saveShortcuts(_shortcuts);
  renderShortcuts();
  closeShortcutDialog();
}

// ---- Context menu ----
function showCtxMenu(x, y, shortcutId) {
  _ctxTargetId = shortcutId;
  const menu = document.getElementById('shortcutCtxMenu');
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  // Keep menu within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
}

function hideCtxMenu() {
  document.getElementById('shortcutCtxMenu').style.display = 'none';
  _ctxTargetId = null;
}

// ---- Event listeners for shortcuts ----

// Right-click on shortcut item → context menu
document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.shortcut-item');
  if (!item) { hideCtxMenu(); return; }
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, item.dataset.shortcutId);
});

// Click anywhere → hide context menu
document.addEventListener('click', async (e) => {
  const menu = document.getElementById('shortcutCtxMenu');
  if (menu.style.display === 'none') return;

  const ctxAction = e.target.closest('[data-ctx-action]');
  if (ctxAction) {
    const action = ctxAction.dataset.ctxAction;
    if (action === 'edit' && _ctxTargetId) {
      openShortcutDialog(_ctxTargetId);
    } else if (action === 'delete' && _ctxTargetId) {
      const deleted = _shortcuts.find(s => s.id === _ctxTargetId);
      const trashItem = deleted ? await trashRepository.add('shortcut', deleted.id, deleted) : null;
      _shortcuts = _shortcuts.filter(s => s.id !== _ctxTargetId);
      await saveShortcuts(_shortcuts);
      renderShortcuts();
      if (trashItem) showToast(t('toast.movedToTrash'), { undoTrashId: trashItem.id });
    }
  }
  hideCtxMenu();
});

// Add button
document.getElementById('shortcutAddBtn')?.addEventListener('click', () => {
  openShortcutDialog(null);
});

// Export / import buttons
document.getElementById('shortcutExportBtn')?.addEventListener('click', exportConfig);
document.getElementById('shortcutImportBtn')?.addEventListener('click', () => {
  document.getElementById('shortcutImportFile')?.click();
});
document.getElementById('shortcutImportFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // reset so picking the same file twice still fires
  if (file) await importConfig(file);
});

// Dialog cancel
document.getElementById('dialogCancel')?.addEventListener('click', closeShortcutDialog);

// Dialog save
document.getElementById('dialogSave')?.addEventListener('click', saveShortcutFromDialog);

// Dialog overlay click → cancel
document.getElementById('shortcutDialogOverlay')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeShortcutDialog();
});

// Enter key in dialog → save
document.getElementById('dialogUrl')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveShortcutFromDialog();
});
document.getElementById('dialogName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('dialogUrl').focus();
});

// Menus belong to the current surface; Escape returns to their own summary.
function closeOpenDashboardMenu(event, doc = document) {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return false;
  if (doc.activeElement?.closest?.('.modal-overlay, .command-overlay')) return false;
  const selector = 'details.tabs-card-menu[open], details.tabs-bulk-menu[open], details.project-card-menu[open], #projectDetail details[open]';
  const focused = doc.activeElement?.closest?.(selector);
  const menu = focused || [...doc.querySelectorAll(selector)].find(item => item.getClientRects().length > 0);
  if (!menu) return false;
  menu.open = false;
  menu.querySelector(':scope > summary')?.focus({ preventScroll: true });
  event.preventDefault();
  event.stopPropagation();
  return true;
}

// Escape key → close dialog or context menu
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }
  if (document.getElementById('commandOverlay').style.display !== 'none') {
    const results = [...document.querySelectorAll('.command-result')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      commandSelectedIndex = Math.max(0, Math.min(results.length - 1,
        commandSelectedIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      results.forEach((result, index) => result.classList.toggle('selected', index === commandSelectedIndex));
      results[commandSelectedIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && results[commandSelectedIndex]) {
      e.preventDefault();
      results[commandSelectedIndex].click();
      return;
    }
  }
  if (e.key === 'Escape') {
    if (document.getElementById('commandOverlay').style.display !== 'none') { closeCommandPalette(); return; }
    const overlay = document.getElementById('shortcutDialogOverlay');
    if (overlay.style.display !== 'none') { closeShortcutDialog(); return; }
    const visibleModal = [...document.querySelectorAll('.modal-overlay')].reverse().find(item => item.style.display !== 'none');
    const closeButton = visibleModal?.querySelector('[data-action^="close-"], [data-action="cancel-restore"]');
    if (closeButton) { closeButton.click(); return; }
    if (closeOpenDashboardMenu(e)) return;
    hideCtxMenu();
  }
  if (e.key === 'Tab') {
    const visibleDialog = [...document.querySelectorAll('[role="dialog"]')].reverse().find(item => item.offsetParent !== null);
    if (!visibleDialog) return;
    const focusable = [...visibleDialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(item => item.offsetParent !== null);
    if (!focusable.length) return;
    if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0].focus(); }
  }
});

const modalFocusObserver = new MutationObserver(records => {
  for (const record of records) {
    const overlay = record.target;
    if (!(overlay instanceof HTMLElement) || !overlay.matches('.modal-overlay, .command-overlay')) continue;
    if (overlay.style.display !== 'none') {
      // Some dialogs focus synchronously before this observer's microtask runs.
      if (!overlay.contains(document.activeElement)) overlay._returnFocus = document.activeElement;
      queueMicrotask(() => {
        if (overlay.style.display !== 'none') overlay.querySelector('input:not([type="hidden"]), button, select')?.focus({ preventScroll: true });
      });
    } else if (overlay._returnFocus instanceof HTMLElement) {
      const previous = overlay._returnFocus;
      overlay._returnFocus = null;
      if (previous.isConnected && !previous.disabled && !overlay.contains(previous) && !previous.closest('[hidden]') && previous.getClientRects().length) previous.focus({ preventScroll: true });
    }
  }
});
document.querySelectorAll('.modal-overlay, .command-overlay').forEach(overlay => modalFocusObserver.observe(overlay, { attributes: true, attributeFilter: ['style'] }));


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'open-command') openCommandPalette();
});
TabOutI18n.ready.then(async () => {
  initializeProjectWorkbench();
  await initShortcuts();
  await renderDashboard();
});

TabOutI18n.onChange(async () => {
  const selectedUrls = new Set([...document.querySelectorAll('#openTabsMissions .selected-for-workspace')].map(node => node.dataset.tabUrl));
  const expanded = new Set([...document.querySelectorAll('#openTabsMissions .page-chips-overflow')].filter(node => node.style.display === 'contents').map(node => node.closest('.mission-card').id));
  const expandedGroups = new Set([...document.querySelectorAll('.tab-group-card.expanded')].map(node => node.dataset.groupId));
  const restoreSummary = document.getElementById('restoreSummary');
  const restoreCopy = TabOutI18n.describeTranslation(restoreSummary.textContent);
  const retrying = Boolean(pendingRetrySession);
  localizeDashboardChrome();
  renderUpgradeStatus();
  if (restoreCopy) restoreSummary.textContent = TabOutI18n.translateDescriptor(restoreCopy);
  if (retrying) document.getElementById('restoreConfirmBtn').textContent = t('restore.retry');
  if (pendingImport) document.getElementById('importPreviewSummary').textContent = t('import.summary', { collections: Object.keys(pendingImport.data).length, items: pendingImport.itemCount, conflicts: pendingImport.conflicts });
  await initShortcuts();
  await renderStaticDashboard();
  for (const node of document.querySelectorAll('#openTabsMissions .page-chip')) if (selectedUrls.has(node.dataset.tabUrl)) {
    node.classList.add('selected-for-workspace'); node.querySelector('.chip-select')?.setAttribute('aria-pressed', 'true');
  }
  for (const node of document.querySelectorAll('#openTabsMissions .page-chips-overflow')) if (expanded.has(node.closest('.mission-card').id)) {
    node.style.display = 'contents'; node.parentElement.querySelector('[data-action="expand-chips"]')?.remove();
  }
  for (const node of document.querySelectorAll('.tab-group-card')) if (expandedGroups.has(node.dataset.groupId)) node.classList.add('expanded');
  const archiveSearch = document.getElementById('archiveSearch');
  if (archiveSearch.value) archiveSearch.dispatchEvent(new Event('input', { bubbles: true }));
  if (document.getElementById('historyOverlay').style.display !== 'none') await renderHistory();
  if (document.getElementById('trashOverlay').style.display !== 'none') await renderTrash({ purge: false });
  if (document.getElementById('workspacesOverlay').style.display !== 'none') {
    const selected = [...document.querySelectorAll('#workspacesOverlay input[type=checkbox]')].map(input => input.checked);
    const choices = [...document.querySelectorAll('#workspacesOverlay select')].map(input => input.value);
    await renderWorkspaces();
    document.querySelectorAll('#workspacesOverlay input[type=checkbox]').forEach((input, index) => { input.checked = selected[index] || false; });
    document.querySelectorAll('#workspacesOverlay select').forEach((input, index) => { if (choices[index] !== undefined) input.value = choices[index]; });
  }
  if (document.getElementById('cleanupOverlay').style.display !== 'none') {
    const checks = new Map([...document.querySelectorAll('.cleanup-checkbox')].map(input => [input.value, input.checked]));
    await renderCleanup();
    document.querySelectorAll('.cleanup-checkbox').forEach(input => { if (checks.has(input.value)) input.checked = checks.get(input.value); });
  }
  if (document.getElementById('settingsOverlay').style.display !== 'none') await renderSettings();
  if (document.getElementById('commandOverlay').style.display !== 'none') { await buildCommandSearchIndex(); renderCommandResults(document.getElementById('commandInput').value); }
  const toastAction = document.getElementById('toastAction');
  if (toastDescriptor) document.getElementById('toastText').textContent = TabOutI18n.translateDescriptor(toastDescriptor);
  if (toastAction.style.display !== 'none') toastAction.textContent = t('btn.undo');
  globalThis.tabOutDashboardNavigation?.restoreLanguageScroll();
});

let commandRefreshTimer;
function refreshVisibleCommandSearch() {
  clearTimeout(commandRefreshTimer);
  commandRefreshTimer = setTimeout(() => {
    if (document.getElementById('commandOverlay').style.display === 'none') return;
    buildCommandSearchIndex().then(() => renderCommandResults(document.getElementById('commandInput').value))
      .catch(() => showToast(t('search.failed')));
  }, 120);
}
chrome.tabs.onCreated.addListener(refreshVisibleCommandSearch);
chrome.tabs.onRemoved.addListener(refreshVisibleCommandSearch);
chrome.tabs.onUpdated.addListener(refreshVisibleCommandSearch);
chrome.storage.onChanged.addListener(refreshVisibleCommandSearch);

let dashboardRefreshTimer;
let dashboardRefreshRunning = false;
let dashboardRefreshPending = false;
function refreshOpenTabDashboard() {
  dashboardRefreshPending = true;
  clearTimeout(dashboardRefreshTimer);
  dashboardRefreshTimer = setTimeout(async () => {
    if (dashboardRefreshRunning) return;
    dashboardRefreshRunning = true;
    try {
      while (dashboardRefreshPending) {
        dashboardRefreshPending = false;
        const selectedUrls = new Set([...document.querySelectorAll('#openTabsMissions .selected-for-workspace')]
          .map(chip => chip.dataset.tabUrl));
        const expandedCards = new Set([...document.querySelectorAll('#openTabsMissions .page-chips-overflow')]
          .filter(overflow => overflow.style.display === 'contents')
          .map(overflow => overflow.closest('.mission-card').id));
        await renderStaticDashboard();
        document.querySelectorAll('#openTabsMissions .page-chip[data-action="focus-tab"]').forEach(chip => {
          if (!selectedUrls.has(chip.dataset.tabUrl)) return;
          chip.classList.add('selected-for-workspace');
          chip.querySelector('.chip-select')?.setAttribute('aria-pressed', 'true');
        });
        document.querySelectorAll('#openTabsMissions .page-chips-overflow').forEach(overflow => {
          if (!expandedCards.has(overflow.closest('.mission-card').id)) return;
          overflow.style.display = 'contents';
          overflow.parentElement.querySelector('[data-action="expand-chips"]')?.remove();
        });
      }
    } catch (error) {
      console.warn('[tab-out] Dashboard refresh failed:', error);
    } finally {
      dashboardRefreshRunning = false;
    }
  }, 120);
}
chrome.tabs.onCreated.addListener(refreshOpenTabDashboard);
chrome.tabs.onRemoved.addListener(refreshOpenTabDashboard);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === 'complete') {
    refreshOpenTabDashboard();
  }
});

async function consumeProjectCaptureRequest() {
  const current = await chrome.tabs.getCurrent();
  let request;
  await TabOutCore.withProjectStorageLock(chrome.storage.local, async () => {
    const stored = await chrome.storage.local.get('projectCaptureRequestV1');
    if (stored.projectCaptureRequestV1?.targetTabId !== current?.id) return;
    request = stored.projectCaptureRequestV1;
    await chrome.storage.local.set({ projectCaptureRequestV1: null });
  });
  if (!request) return;
  const tabs = (await chrome.tabs.query({})).filter(tab => request.tabIds.includes(tab.id));
  await openProjectSavePreview('park', tabs, { windowId: request.windowId, acrossWindows: false });
}
chrome.storage.onChanged.addListener(changes => {
  if (changes.projectCaptureRequestV1?.newValue && globalThis.tabOutProjectWorkbench) consumeProjectCaptureRequest().catch(() => showToast(t('project.error.unknown')));
});
