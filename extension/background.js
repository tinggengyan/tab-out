importScripts(
  'entitlement-config.js',
  'src/shared/sanitize.js',
  'src/domain/session.js',
  'src/domain/rule-engine.js',
  'src/storage/snapshot-repository.js',
  'src/storage/operation-repository.js',
  'src/storage/workspace-repository.js',
  'src/storage/rule-repository.js',
  'src/api/chrome-session-adapter.js',
  'src/services/snapshot-service.js',
  'src/services/operation-service.js',
  'src/services/entitlement-service.js',
  'src/services/search-service.js',
  'src/services/platform-search-service.js',
  'src/storage/search-platform-repository.js',
  'src/services/unified-search-service.js',
  'src/services/omnibox-search-service.js',
  'src/services/telemetry-service.js'
);

const backgroundSessionAdapter = TabOutCore.createChromeSessionAdapter(chrome, { deviceId: 'local' });
const backgroundEntitlementService = TabOutCore.createEntitlementService({
  storage: chrome.storage.local,
  publicKeyJwk: self.TAB_OUT_PUBLIC_KEY_JWK,
});
const backgroundSnapshotRepository = TabOutCore.createSnapshotRepository(chrome.storage.local, {
  automaticLimit: Infinity,
});
const backgroundOperationRepository = TabOutCore.createOperationRepository(chrome.storage.local);
const backgroundOperationService = TabOutCore.createOperationService({
  captureTabs: backgroundSessionAdapter.captureTabs,
  removeTabs: tabIds => chrome.tabs.remove(tabIds),
  getExistingTabIds: async tabIds => {
    const wanted = new Set(tabIds);
    return (await chrome.tabs.query({})).map(tab => tab.id).filter(id => wanted.has(id));
  },
  restoreSession: backgroundSessionAdapter.restoreSession,
  repository: backgroundOperationRepository,
});
const backgroundTelemetry = TabOutCore.createTelemetryService(chrome.storage.local);
function snapshotCountBucket(count) {
  if (count <= 10) return '0-10';
  if (count <= 50) return '11-50';
  if (count <= 100) return '51-100';
  return '101+';
}
const backgroundSnapshotService = TabOutCore.createSnapshotService({
  captureAll: backgroundSessionAdapter.captureAll,
  repository: backgroundSnapshotRepository,
  onCaptured: session => backgroundTelemetry.record('snapshot_created', {
    type: session.type || 'automatic',
    tab_count_bucket: snapshotCountBucket(session.stats?.tabCount || 0),
    result: 'success',
  }).catch(() => {}),
});
const backgroundWorkspaceRepository = TabOutCore.createWorkspaceRepository(chrome.storage.local);
const backgroundRuleRepository = TabOutCore.createRuleRepository(chrome.storage.local);

async function handleWorkspaceRules(tabId, url) {
  const { workspaceAutomationEnabledV1 = true } = await chrome.storage.local.get('workspaceAutomationEnabledV1');
  if (!workspaceAutomationEnabledV1) return;
  if (!await backgroundEntitlementService.has('rules.enabled')) return;
  if (!TabOutCore.normalizeWebUrl(url)) return;
  const rules = await backgroundRuleRepository.list();
  const { workspaceRuleExclusionsV2 = [] } = await chrome.storage.local.get('workspaceRuleExclusionsV2');
  const matches = TabOutCore.matchWorkspaceRules(url, rules, workspaceRuleExclusionsV2);
  if (matches.length === 0) return;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  for (const rule of matches) {
    if (rule.mode === 'auto') {
      try {
        await backgroundWorkspaceRepository.addEntries(rule.workspaceId, [{
          url, title: tab.title || url, pinned: tab.pinned,
        }]);
      } catch { /* workspace may have been deleted */ }
    } else {
      const { workspaceSuggestionsV2 = [] } = await chrome.storage.local.get('workspaceSuggestionsV2');
      const suggestion = { id: `${rule.id}:${url}`, ruleId: rule.id, workspaceId: rule.workspaceId, url, title: tab.title || url, createdAt: new Date().toISOString() };
      const next = [suggestion, ...workspaceSuggestionsV2.filter(item => item.id !== suggestion.id)].slice(0, 50);
      await chrome.storage.local.set({ workspaceSuggestionsV2: next });
    }
  }
}

async function markSnapshotDirty(reason) {
  try {
    const { automaticSnapshotsEnabledV1 = true } = await chrome.storage.local.get('automaticSnapshotsEnabledV1');
    if (automaticSnapshotsEnabledV1) backgroundSnapshotService.markDirty(reason);
  } catch { backgroundTelemetry.error('snapshot', 'event_capture_failed').catch(() => {}); }
}

async function captureBaselineIfEnabled() {
  const { automaticSnapshotsEnabledV1 = true } = await chrome.storage.local.get('automaticSnapshotsEnabledV1');
  if (automaticSnapshotsEnabledV1) {
    try { await backgroundSnapshotService.flush('automatic'); }
    catch { await backgroundTelemetry.error('snapshot', 'baseline_capture_failed'); }
  }
}

async function refreshCommercialEntitlement() {
  if (!self.TAB_OUT_REDEMPTION_URL || !/^https:\/\//i.test(self.TAB_OUT_REDEMPTION_URL)) return;
  const { licenseSourceV1 } = await chrome.storage.local.get('licenseSourceV1');
  if (!licenseSourceV1?.licenseKey || !licenseSourceV1.instanceId) return;
  if (Date.now() - Date.parse(licenseSourceV1.refreshedAt || 0) < 86400000) return;
  try {
    const response = await fetch(self.TAB_OUT_REDEMPTION_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: licenseSourceV1.licenseKey, deviceId: licenseSourceV1.deviceId, instanceId: licenseSourceV1.instanceId }),
    });
    if (response.status === 403) { await backgroundEntitlementService.deactivate(); return; }
    if (!response.ok) return;
    const result = await response.json();
    await backgroundEntitlementService.activate(result.token);
    await chrome.storage.local.set({ licenseSourceV1: { ...licenseSourceV1, refreshedAt: new Date().toISOString() } });
  } catch { /* offline: retain the last locally verified entitlement */ }
}

/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Tab Out.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  chrome.alarms.create('tab-out-maintenance', { periodInMinutes: 360 });
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  chrome.alarms.create('tab-out-maintenance', { periodInMinutes: 360 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'tab-out-maintenance') return;
  backgroundEntitlementService.limit('history.days')
    .then(days => backgroundSnapshotRepository.prune({ automaticDays: days }))
    .catch(() => {});
  refreshCommercialEntitlement().catch(() => {});
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
  markSnapshotDirty('tab-created');
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
  markSnapshotDirty('tab-removed');
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  updateBadge();
  if (changeInfo.url || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) {
    markSnapshotDirty('tab-updated');
  }
  if (changeInfo.url) handleWorkspaceRules(_tabId, changeInfo.url).catch(() => {});
});

chrome.tabs.onMoved.addListener(() => markSnapshotDirty('tab-moved'));
chrome.tabs.onAttached.addListener(() => markSnapshotDirty('tab-attached'));
chrome.tabs.onDetached.addListener(() => markSnapshotDirty('tab-detached'));
chrome.windows.onCreated.addListener(() => markSnapshotDirty('window-created'));
chrome.windows.onRemoved.addListener(() => markSnapshotDirty('window-removed'));

if (chrome.tabGroups) {
  chrome.tabGroups.onCreated.addListener(() => markSnapshotDirty('group-created'));
  chrome.tabGroups.onUpdated.addListener(() => markSnapshotDirty('group-updated'));
  chrome.tabGroups.onRemoved.addListener(() => markSnapshotDirty('group-removed'));
  chrome.tabGroups.onMoved.addListener(() => markSnapshotDirty('group-moved'));
}

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
chrome.alarms.create('tab-out-maintenance', { periodInMinutes: 360 });
captureBaselineIfEnabled().catch(() => {});
refreshCommercialEntitlement().catch(() => {});

async function buildOmniboxAdvancedItems() {
  if (!await backgroundEntitlementService.has('search.advanced')) return [];
  const stored = await chrome.storage.local.get(['workspacesV2', 'deferred', 'tabGroups', 'snapshotsV2']);
  const items = [];
  (stored.workspacesV2 || []).forEach(workspace => workspace.entries.forEach(entry => items.push({ id: `workspace:${entry.id}`, type: 'workspace', title: entry.title, subtitle: workspace.name, url: entry.url })));
  (stored.deferred || []).filter(item => !item.dismissed).forEach(item => items.push({ id: `deferred:${item.id}`, type: 'deferred', title: item.title, url: item.url }));
  (stored.tabGroups || []).forEach(group => group.tabs.forEach((tab, index) => items.push({ id: `group:${group.id}:${index}`, type: 'collected', title: tab.title, url: tab.url })));
  (stored.snapshotsV2 || []).forEach(snapshot => (snapshot.windows || []).forEach(window => (window.tabs || []).forEach(tab => {
    if (tab.restorable && TabOutCore.normalizeWebUrl(tab.url)) items.push({ id: `history:${snapshot.id}:${tab.id}`, type: 'history', title: tab.title, subtitle: snapshot.capturedAt, url: tab.url });
  })));
  return items;
}

TabOutCore.installOmniboxSearch(chrome, {
  platforms: TabOutCore.createSearchPlatformRepository(chrome.storage.local),
  advancedItems: buildOmniboxAdvancedItems,
  async openDashboard(query, error) {
    const hash = new URLSearchParams({ search: query, ...(error ? { error } : {}) });
    await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + '#' + hash.toString() });
  },
});

async function openTabOut(openSearch = false) {
  if (openSearch) await chrome.storage.local.set({ openCommandOnLoad: true });
  const url = chrome.runtime.getURL('index.html');
  const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
    if (openSearch) chrome.runtime.sendMessage({ type: 'open-command' }).catch(() => {});
  } else await chrome.tabs.create({ url });
}

async function collectCurrentWindow() {
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(tab => {
    const url = tab.url || '';
    return !/^(chrome|chrome-extension|edge|brave|about):/i.test(url);
  });
  const tabIds = tabs.map(tab => tab.id).filter(Number.isInteger);
  if (!tabIds.length) return openTabOut(false);
  const session = await backgroundSessionAdapter.captureTabs(tabIds);
  const group = {
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    tabs: tabs.map(tab => ({ url: tab.url, title: tab.title || tab.url })),
    session,
  };
  const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
  await chrome.storage.local.set({ tabGroups: [group, ...tabGroups] });
  try {
    await backgroundOperationService.close(tabIds, { source: 'command-collect-window', collectedGroupId: group.id });
  } catch (error) {
    await backgroundTelemetry.error('collect', 'command_close_failed');
    throw error;
  }
  await openTabOut(false);
}

chrome.action.onClicked.addListener(() => openTabOut(false));
chrome.commands.onCommand.addListener(async command => {
  if (command === 'open-tab-out') await openTabOut(false);
  if (command === 'search-tab-out') await openTabOut(true);
  if (command === 'save-session') {
    const snapshots = await backgroundSnapshotRepository.list();
    const manualCount = snapshots.filter(item => item.type === 'manual').length;
    if (manualCount < await backgroundEntitlementService.limit('manualSnapshots.limit')) {
      await backgroundSnapshotService.flush('manual').catch(() => {});
    }
  }
  if (command === 'collect-current-window') await collectCurrentWindow();
});
