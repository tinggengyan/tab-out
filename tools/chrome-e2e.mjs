#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const debuggerOrigin = process.env.TAB_OUT_CDP_ORIGIN || 'http://127.0.0.1:9333';
const extensionId = process.env.TAB_OUT_EXTENSION_ID || 'gbbakbpcbbcilmggnkcahkemicknngbo';
let activeCdp;
let fixtureServer;

async function json(path, options) {
  const response = await fetch(`${debuggerOrigin}${path}`, options);
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${path}`);
  return response.json();
}

async function createTarget(url) {
  return json(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) || []), listener]);
    },
    close() { socket.close(); },
  };
}

async function main() {
  await json('/json/version');
  fixtureServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<title>${request.url.slice(1) || 'fixture'}</title><main>Tab Out isolated fixture</main>`);
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
  await Promise.all([
    createTarget(`${fixtureOrigin}/e2e-one`),
    createTarget(`${fixtureOrigin}/e2e-two`),
    createTarget(`${fixtureOrigin}/e2e-three`),
  ]);
  const dashboard = await createTarget(`chrome-extension://${extensionId}/index.html`);
  const cdp = connect(dashboard.webSocketDebuggerUrl);
  activeCdp = cdp;
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);

  let promptText = '';
  cdp.on('Page.javascriptDialogOpening', ({ type }) => {
    cdp.send('Page.handleJavaScriptDialog', {
      accept: true,
      ...(type === 'prompt' ? { promptText } : {}),
    }).catch(() => {});
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result.value;
  }
  async function waitFor(expression, message, timeout = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`(async () => Boolean(await (${expression})))()`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${message}`);
  }
  async function click(selector) {
    const clicked = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
    assert.equal(clicked, true, `missing control ${selector}`);
  }
  async function extensionState(expression) {
    return evaluate(`(async () => { const state = await chrome.storage.local.get(null); return (${expression}); })()`);
  }

  await waitFor("document.readyState === 'complete' && document.querySelector('#onboardingOverlay')", 'dashboard load');
  await evaluate(`(async () => { await chrome.storage.local.clear(); location.reload(); })()`);
  await waitFor("document.readyState === 'complete' && document.querySelector('#onboardingOverlay')", 'clean dashboard reload');
  await waitFor("getComputedStyle(document.querySelector('#onboardingOverlay')).display !== 'none'", 'first-run onboarding');
  await click('[data-action="finish-onboarding"]');
  await waitFor(`openTabs.filter(tab => tab.url?.startsWith(${JSON.stringify(fixtureOrigin)})).length === 3`, 'fixture URLs to commit');
  await waitFor("document.querySelectorAll('#openTabsMissions .mission-card').length > 0", 'open-tab dashboard');

  await click('[data-action="collect-all-tabs"]');
  await waitFor("document.querySelector('#toastAction').style.display !== 'none'", 'collect undo action');
  assert.equal(await extensionState("state.tabGroups?.length"), 1, 'collection was not persisted');
  await waitFor("document.querySelectorAll('#openTabsMissions .mission-card').length === 0", 'collected tabs to close');
  await click('#toastAction');
  await waitFor("document.querySelectorAll('#openTabsMissions .mission-card').length > 0", 'undo to restore tabs');
  assert.equal(await extensionState("state.tabGroups?.length || 0"), 0, 'undo left a stale collected group');

  const dashboardWindowId = await evaluate(`chrome.windows.getCurrent().then(window => window.id)`);
  const auxiliaryWindowId = await evaluate(`chrome.windows.create({
    url: [${JSON.stringify(`${fixtureOrigin}/window-two-a`)}, ${JSON.stringify(`${fixtureOrigin}/window-two-b`)}],
    focused: false,
  }).then(window => window.id)`);
  await waitFor(`chrome.storage.local.get('snapshotsV2').then(({ snapshotsV2 = [] }) => snapshotsV2.some(snapshot => snapshot.type === 'automatic' && snapshot.stats?.windowCount >= 2))`, 'automatic multi-window snapshot', 30000);
  const multiWindowSnapshotId = await extensionState("state.snapshotsV2.find(snapshot => snapshot.type === 'automatic' && snapshot.stats?.windowCount >= 2)?.id");
  assert.ok(multiWindowSnapshotId, 'automatic multi-window snapshot missing');
  await evaluate(`chrome.windows.remove(${JSON.stringify(auxiliaryWindowId)})`);
  await click('[data-action="open-history"]');
  await waitFor("getComputedStyle(document.querySelector('#historyOverlay')).display !== 'none'", 'history dialog for automatic restore');
  await click(`[data-action="restore-snapshot"][data-snapshot-id="${multiWindowSnapshotId}"]`);
  await waitFor("getComputedStyle(document.querySelector('#restoreOverlay')).display !== 'none'", 'automatic restore preview');
  await click('[data-action="confirm-restore"]');
  await waitFor("chrome.windows.getAll().then(windows => windows.length >= 2)", 'automatic snapshot to restore windows');
  await evaluate(`chrome.windows.getAll().then(windows => Promise.all(windows.filter(window => window.id !== ${JSON.stringify(dashboardWindowId)}).map(window => chrome.windows.remove(window.id))))`);
  await waitFor("chrome.windows.getAll().then(windows => windows.length === 1)", 'auxiliary restore windows to close');
  await click('[data-action="close-history"]');

  await click('[data-action="open-history"]');
  await waitFor("getComputedStyle(document.querySelector('#historyOverlay')).display !== 'none'", 'history dialog');
  promptText = 'Isolated Chrome E2E';
  await click('[data-action="save-snapshot"]');
  await waitFor("document.querySelector('#historyList').textContent.includes('Isolated Chrome E2E')", 'manual snapshot note');
  assert.ok(await extensionState("state.snapshotsV2?.some(item => item.type === 'manual')"));
  await click('[data-action="close-history"]');

  await click('[data-action="open-workspaces"]');
  await waitFor("getComputedStyle(document.querySelector('#workspacesOverlay')).display !== 'none'", 'workspaces dialog');
  promptText = 'E2E Workspace';
  await click('[data-action="save-current-workspace"]');
  await waitFor("document.querySelector('#workspaceList').textContent.includes('E2E Workspace')", 'workspace creation');
  assert.ok(await extensionState("state.workspacesV2?.some(item => item.name === 'E2E Workspace')"));
  for (const name of ['E2E Workspace 2', 'E2E Workspace 3']) {
    promptText = name;
    await click('[data-action="save-current-workspace"]');
    await waitFor(`document.querySelector('#workspaceList').textContent.includes(${JSON.stringify(name)})`, `workspace creation: ${name}`);
  }
  promptText = 'Blocked Workspace';
  await click('[data-action="save-current-workspace"]');
  assert.equal(await extensionState("state.workspacesV2?.length"), 3, 'Free workspace limit was not enforced');
  await click('[data-action="close-workspaces"]');

  await click('[data-action="open-upgrade"]');
  await waitFor("getComputedStyle(document.querySelector('#upgradeOverlay')).display !== 'none'", 'upgrade dialog');
  await evaluate(`entitlementService.activate = async () => {
    const paid = { plan: 'pro_lifetime', status: 'active', features: ['search.advanced'], limits: { 'workspaces.limit': 999 } };
    entitlementService.current = async () => paid;
    entitlementService.limit = async name => name === 'workspaces.limit' ? 999 : 999;
    entitlementService.has = async () => true;
    return paid;
  }`);
  await evaluate(`document.querySelector('#licenseTokenInput').value = 'isolated.mock-token'`);
  await click('[data-action="activate-license"]');
  await waitFor("getComputedStyle(document.querySelector('#upgradeOverlay')).display === 'none'", 'simulated activation');
  await click('[data-action="open-workspaces"]');
  promptText = 'Unlocked Workspace';
  await click('[data-action="save-current-workspace"]');
  await waitFor("document.querySelector('#workspaceList').textContent.includes('Unlocked Workspace')", 'immediate Pro unlock');
  assert.equal(await extensionState("state.workspacesV2?.length"), 4, 'simulated purchase did not unlock the fourth workspace');
  await click('[data-action="close-workspaces"]');

  await click('[data-action="open-command"]');
  await waitFor("getComputedStyle(document.querySelector('#commandOverlay')).display !== 'none'", 'command search');
  await evaluate(`(() => { const input = document.querySelector('#commandInput'); input.value = 'e2e'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor("document.querySelectorAll('#commandResults [data-action]').length > 0", 'cross-asset search results');
  await evaluate(`closeCommandPalette()`);

  await evaluate(`(async () => {
    const state = await chrome.storage.local.get(null);
    globalThis.__tabOutE2EBackup = JSON.stringify(TabOutCore.createPortableBackup(state));
    await chrome.storage.local.remove(['workspacesV2', 'snapshotsV2', 'tabGroups', 'deferred', 'shortcuts']);
    const file = new File([globalThis.__tabOutE2EBackup], 'tab-out.config', { type: 'application/json' });
    await importConfig(file);
  })()`);
  await waitFor("getComputedStyle(document.querySelector('#importPreviewOverlay')).display !== 'none'", 'import preview');
  await click('[data-action="confirm-import-preview"]');
  await waitFor("document.querySelector('#importPreviewOverlay').style.display === 'none'", 'import completion');
  assert.ok(await extensionState("state.workspacesV2?.some(item => item.name === 'E2E Workspace')"));
  assert.ok(await extensionState("state.snapshotsV2?.some(item => item.note === 'Isolated Chrome E2E')"));

  await evaluate(`(async () => {
    const tabs = await chrome.tabs.query({});
    const fixtureIds = tabs.filter(tab => tab.url?.startsWith(${JSON.stringify(fixtureOrigin)})).map(tab => tab.id);
    if (fixtureIds.length) await chrome.tabs.remove(fixtureIds);
    await fetchOpenTabs();
  })()`);
  await evaluate(`(async () => {
    const session = (await snapshotRepository.list()).find(item => item.note === 'Isolated Chrome E2E');
    const plan = TabOutCore.planRestore(session, openTabs, { skipDuplicates: true });
    await restoreJobRepository.create(plan, { mode: 'new-window' });
    location.reload();
  })()`);
  await waitFor("document.readyState === 'complete' && pendingRestoreJobId && getComputedStyle(document.querySelector('#restoreOverlay')).display !== 'none'", 'interrupted restore job to resume');
  await evaluate(`(() => {
    const originalRestore = sessionAdapter.restoreSession.bind(sessionAdapter);
    let injectFailure = true;
    sessionAdapter.restoreSession = async (plan, options) => {
      if (!injectFailure) return originalRestore(plan, options);
      injectFailure = false;
      const tab = plan.windows.flatMap(window => window.tabs)[0];
      return { succeeded: 0, failed: [{ tabId: tab.id, url: tab.url, code: 'tab_create_failed' }], createdWindows: [] };
    };
  })()`);
  await click('[data-action="confirm-restore"]');
  await waitFor("pendingRetrySession !== null", 'partial restore report');
  assert.match(await evaluate("document.querySelector('#restoreSummary').textContent"), /1/);
  await click('[data-action="confirm-restore"]');
  await waitFor("getComputedStyle(document.querySelector('#restoreOverlay')).display === 'none'", 'restore retry completion');
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.url?.startsWith(${JSON.stringify(fixtureOrigin)})))`, 'retried tab to reopen');

  const operations = await extensionState("state.operationsV2 || []");
  assert.ok(operations.some(item => item.status === 'undone'), 'undo operation was not persisted');
  cdp.close();
  activeCdp = null;
  fixtureServer.closeAllConnections();
  await new Promise(resolve => fixtureServer.close(resolve));
  fixtureServer = null;
  process.stdout.write(JSON.stringify({
    ok: true,
    journeys: ['onboarding-collect-undo', 'automatic-snapshot-window-restore', 'manual-snapshot', 'free-limit-purchase-unlock', 'workspace-search', 'backup-import', 'interrupted-partial-restore-report-retry'],
    operationCount: operations.length,
  }, null, 2) + '\n');
}

main().catch(error => {
  activeCdp?.close();
  fixtureServer?.closeAllConnections();
  fixtureServer?.close();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
