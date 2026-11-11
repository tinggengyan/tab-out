#!/usr/bin/env node
/* Home guard: proves in a real (headless) Chrome that the dashboard keeps its soul —
   site cards, one-click close / stash / dedupe, undo, restore — and loads nothing from
   the network. Run through tools/run-chrome-e2e.mjs, which provides a disposable
   profile and sets TAB_OUT_CDP_ORIGIN, TAB_OUT_EXTENSION_ID, TAB_OUT_TEST_LOCALE.
   Each numbered check matches design.md §5. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionId = process.env.TAB_OUT_EXTENSION_ID;
const locale = process.env.TAB_OUT_TEST_LOCALE || 'en-US';
assert.ok(origin && extensionId, 'run through tools/run-chrome-e2e.mjs');
const dashboardUrl = `chrome-extension://${extensionId}/index.html`;
const XSS_TITLE = '<img src=x id=pwn>';

// Fixture pages: http://<site>.localhost:<port>/<path>, titled "<site> /<path>".
const server = createServer((request, response) => {
  const host = (request.headers.host || '').split('.')[0];
  const title = request.url === '/xss' ? XSS_TITLE : `${host} ${request.url}`;
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<title>${title.replace(/</g, '&lt;')}</title><main>fixture</main>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const url = (site, path) => `http://${site}.localhost:${port}/${path}`;
// 5 sites, 15 tabs, 3 exact duplicates (docs ×2, news ×1)
const FIXTURE = [
  url('docs', 'guide'), url('docs', 'api'), url('docs', 'api'), url('docs', 'faq'), url('docs', 'faq'),
  url('news', 'today'), url('news', 'today'), url('news', 'tech'),
  url('mail', 'inbox'), url('mail', 'thread-1'),
  url('shop', 'cart'), url('shop', 'item-1'), url('shop', 'item-2'),
  url('video', 'watch-1'), url('video', 'watch-2'),
];

const page = await connectPage(origin, dashboardUrl);
const { send, evaluate, waitFor, click, screenshot } = page;
const requests = [];
const dialogs = [];
page.on('Network.requestWillBeSent', ({ request }) => requests.push(request.url));
page.on('Page.javascriptDialogOpening', ({ message }) => {
  dialogs.push(message);
  send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
});
await send('Network.enable');

const pause = ms => new Promise(done => setTimeout(done, ms));
const pass = label => process.stdout.write(`PASS ${label} [${locale}]\n`);
const storage = key => evaluate(`chrome.storage.local.get(${JSON.stringify(key)}).then(state => state[${JSON.stringify(key)}])`);
const fixtureTabs = () => evaluate(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).map(tab => ({ id: tab.id, url: tab.url || tab.pendingUrl, windowId: tab.windowId, pinned: tab.pinned })))`);
const countSite = async site => (await fixtureTabs()).filter(tab => tab.url.startsWith(`http://${site}.localhost`)).length;
const card = site => `.mission-card[data-domain-id="domain-${site}-localhost"]`;
async function reloadDashboard(minCards = 5) {
  await send('Page.reload');
  await pause(300);
  await waitFor(`document.querySelectorAll('#openTabsMissions .mission-card').length >= ${minCards}`, `${minCards} site cards`);
  await evaluate('document.fonts.ready');
  await pause(300);
}
async function waitForSite(site, count) {
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').startsWith('http://${site}.localhost')).length === ${count})`, `${site} has ${count} tabs`);
}
// Row buttons only appear while the row is hovered, so move the mouse onto the
// row first, then onto the button, and press it there — like a person would.
async function hoverClick(rowSelector, buttonSelector) {
  const center = selector => evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).scrollIntoView({ block: 'center' })`);
  const row = await center(rowSelector);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y });
  await pause(150);
  const { x, y } = await center(buttonSelector);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  assert.equal(await evaluate(`document.elementFromPoint(${x}, ${y})?.closest(${JSON.stringify(buttonSelector)}) !== null`), true, `${buttonSelector} is not under the mouse`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const undoOffered = () => evaluate(`getComputedStyle(document.getElementById('toastAction')).display !== 'none'
  && document.getElementById('toast').classList.contains('visible')`);
async function undo() {
  await click('#toastAction');
  await waitFor(`document.getElementById('toastText').textContent.length > 0`, 'undo toast');
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---- Fixture: 15 tabs in this window, 3 saved-for-later, 1 stash record ----
  const savedAt = new Date().toISOString();
  await evaluate(`chrome.storage.local.set(${JSON.stringify({
    deferred: [0, 1, 2].map(index => ({ id: `d${index}`, url: url('blog', `post-${index}`), title: `Read later ${index + 1}`, savedAt, completed: false, dismissed: false })),
    collectedGroupsV3: [{ id: 'seed', savedAt, name: 'Seed stash', tabs: [{ url: url('seed', 'a'), title: 'Seed A' }] }],
  })})`);
  await evaluate(`(async () => { const current = await chrome.tabs.getCurrent();
    for (const url of ${JSON.stringify(FIXTURE)}) await chrome.tabs.create({ url, windowId: current.windowId, active: false }); })()`);
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.status === 'complete' && tab.url.includes('.localhost:${port}/')).length === ${FIXTURE.length})`, 'fixture tabs loaded', 20000);
  requests.length = 0;
  await reloadDashboard();
  await screenshot('01-home-1440');

  // 1. first card top
  const firstTop = await evaluate(`document.querySelector('#openTabsMissions .mission-card').getBoundingClientRect().top`);
  assert.ok(firstTop <= 100, `first card top is ${firstTop}px`);
  pass(`1 first card top ${Math.round(firstTop)}px <= 100px`);

  // 2. always-visible controls on the first screen
  const controls = await evaluate(`[...document.querySelectorAll('button, a, summary, input')].filter(element => {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
  }).length`);
  assert.ok(controls <= 30, `${controls} visible controls`);
  pass(`2 ${controls} visible controls <= 30`);

  // 3. card buttons stay on one row (1440 and 1366), no menus inside cards
  const oneRow = `[...document.querySelectorAll('#openTabsMissions .actions')].every(row => {
    const tops = [...row.children].map(button => Math.round(button.getBoundingClientRect().top));
    return tops.length > 0 && tops.every(top => top === tops[0]) && row.scrollWidth <= row.clientWidth + 1;
  }) && !document.querySelector('#openTabsMissions details')`;
  assert.equal(await evaluate(oneRow), true, 'card buttons on one row at 1440');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  assert.equal(await evaluate(oneRow), true, 'card buttons on one row at 1366');
  await screenshot('02-home-1366');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  pass('3 card buttons on one row at 1440 and 1366');

  // 8. nothing but extension and data: resources were requested by the dashboard
  const external = requests.filter(request => !request.startsWith('chrome-extension://') && !request.startsWith('data:'));
  assert.deepEqual(external, [], 'dashboard made network requests');
  pass(`8 ${requests.length} requests, all chrome-extension:// or data:`);

  // 4 + global dedupe: one click closes the 3 extra copies; undo brings them back
  assert.equal((await fixtureTabs()).length, 15);
  await click('[data-action="dedup-all"]');
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url.includes('.localhost:${port}/')).length === 12)`, '12 tabs after dedupe');
  await undo();
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).length === 15)`, '15 tabs after undo');
  pass('4 global dedupe in 1 click, undone');

  // 4 + site dedupe
  await reloadDashboard();
  await click(`${card('docs')} [data-action="dedup-keep-one"]`);
  await waitForSite('docs', 3);
  pass('4 site dedupe in 1 click');

  // 4 + 5. close a site in one click, then undo back into the same window
  await reloadDashboard();
  const newsBefore = (await fixtureTabs()).filter(tab => tab.url.startsWith('http://news.localhost'));
  await click(`${card('news')} [data-action="close-domain-tabs"]`);
  await waitForSite('news', 0);
  assert.equal(dialogs.length, 0, 'closing a site must not ask');
  await undo();
  await waitForSite('news', 3);
  const newsAfter = (await fixtureTabs()).filter(tab => tab.url.startsWith('http://news.localhost'));
  assert.deepEqual(newsAfter.map(tab => tab.url).sort(), newsBefore.map(tab => tab.url).sort());
  assert.ok(newsAfter.every(tab => tab.windowId === newsBefore[0].windowId), 'undo reopens in the original window');
  pass('5 close site in 1 click, undo restores the same URLs in the same window');

  // 4 + 6. stash a site in one click; a pinned page stays open and out of the record; undo removes the record
  const cart = (await fixtureTabs()).find(tab => tab.url === url('shop', 'cart'));
  await evaluate(`chrome.tabs.update(${cart.id}, { pinned: true })`);
  await reloadDashboard();
  const stashBefore = (await storage('collectedGroupsV3')).length;
  await click(`${card('shop')} [data-action="collect-domain-tabs"]`);
  await waitForSite('shop', 1);
  const stashed = await storage('collectedGroupsV3');
  assert.equal(stashed.length, stashBefore + 1);
  assert.deepEqual(stashed[0].tabs.map(tab => tab.url).sort(), [url('shop', 'item-1'), url('shop', 'item-2')]);
  assert.equal(stashed[0].name, 'Shop Localhost', 'a site stash is named after the site');
  assert.equal((await fixtureTabs()).find(tab => tab.url === url('shop', 'cart'))?.pinned, true, 'pinned page stays open');
  await undo();
  await waitForSite('shop', 3);
  assert.equal((await storage('collectedGroupsV3')).length, stashBefore, 'undo deletes the new stash record');
  await evaluate(`chrome.tabs.update(${cart.id}, { pinned: false })`);
  pass('6 stash site in 1 click (pinned stays), undo reopens and deletes the record');

  // 4 + 7. restore a whole record in one click (record disappears), then restore a single page
  await reloadDashboard();
  await click(`${card('video')} [data-action="collect-domain-tabs"]`);
  await waitForSite('video', 0);
  const videoRecord = (await storage('collectedGroupsV3'))[0];
  await waitFor(`document.querySelector('[data-action="restore-group"][data-group-id="${videoRecord.id}"]')`, 'stash record rendered');
  await click(`[data-action="restore-group"][data-group-id="${videoRecord.id}"]`);
  await waitForSite('video', 2);
  assert.equal((await storage('collectedGroupsV3')).some(record => record.id === videoRecord.id), false, 'restored record is removed');

  await reloadDashboard();
  await click(`${card('mail')} [data-action="collect-domain-tabs"]`);
  await waitForSite('mail', 0);
  const mailRecord = (await storage('collectedGroupsV3'))[0];
  await click(`.tab-group-header[data-group-id="${mailRecord.id}"]`);
  await click(`.tab-group-tab[data-group-id="${mailRecord.id}"][data-tab-idx="0"]`);
  await waitForSite('mail', 1);
  const mailLeft = (await storage('collectedGroupsV3')).find(record => record.id === mailRecord.id);
  assert.equal(mailLeft.tabs.length, 1, 'single restore removes that page from the record');
  await click(`[data-action="restore-group"][data-group-id="${mailRecord.id}"]`);
  await waitForSite('mail', 2);
  pass('7 restore-all removes the record; single restore removes one page');

  // 4. stash everything in one click, then undo
  await reloadDashboard();
  await click('[data-action="collect-all-tabs"]');
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url.includes('.localhost:${port}/')).length === 0)`, 'all fixture tabs stashed');
  await undo();
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).length === 13)`, 'stash-all undone');
  pass('4 stash all in 1 click, undone');

  // close all: confirms only the first time, undo restores
  await reloadDashboard();
  await click('[data-action="close-all-open-tabs"]');
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url.includes('.localhost:${port}/')).length === 0)`, 'all closed');
  assert.equal(dialogs.length, 1, 'close-all asks once the first time');
  await undo();
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).length === 13)`, 'close-all undone');
  await reloadDashboard();
  await click('[data-action="close-all-open-tabs"]');
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url.includes('.localhost:${port}/')).length === 0)`, 'all closed again');
  assert.equal(dialogs.length, 1, 'close-all does not ask a second time');
  await undo();
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).length === 13)`, 'close-all undone again');
  pass('4 close all: one confirm ever, undo restores');

  // 9. a page title containing markup is shown as text
  await evaluate(`chrome.tabs.create({ url: ${JSON.stringify(url('evil', 'xss'))}, active: false })`);
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.title === ${JSON.stringify(XSS_TITLE)}))`, 'xss fixture loaded');
  await reloadDashboard();
  assert.equal(await evaluate(`document.getElementById('pwn') === null`), true, 'title markup was parsed into an element');
  assert.equal(await evaluate(`document.getElementById('openTabsMissions').textContent.includes(${JSON.stringify(XSS_TITLE)})`), true);
  pass('9 markup in a tab title renders as text');
  await screenshot('03-after-actions');

  // 10. v2.3 projects become stash records once; old key untouched; no duplicates on re-run
  const workspaces = [
    { id: 'w1', name: 'Payments', entries: [{ id: 'e1', url: url('pay', 'a'), title: 'Pay A' }] },
    { id: 'w2', name: '', entries: [{ id: 'e2', url: url('docs', 'old'), title: 'Old doc' }] },
  ];
  await evaluate(`chrome.storage.local.set({ workspacesV2: ${JSON.stringify(workspaces)} }).then(() => chrome.storage.local.remove('soulMigrationV1'))`);
  const before = (await storage('collectedGroupsV3')).length;
  await reloadDashboard();
  await waitFor(`chrome.storage.local.get('soulMigrationV1').then(state => Boolean(state.soulMigrationV1))`, 'migration flag');
  const migrated = await storage('collectedGroupsV3');
  assert.equal(migrated.length, before + 2);
  assert.deepEqual(migrated.filter(record => record.sourceId?.startsWith('workspace:')).map(record => record.sourceId).sort(), ['workspace:w1', 'workspace:w2']);
  assert.deepEqual(await storage('workspacesV2'), workspaces, 'workspacesV2 untouched');
  await evaluate(`chrome.storage.local.remove('soulMigrationV1')`);
  await reloadDashboard();
  await waitFor(`chrome.storage.local.get('soulMigrationV1').then(state => Boolean(state.soulMigrationV1))`, 'migration flag again');
  assert.equal((await storage('collectedGroupsV3')).length, before + 2, 'second migration adds nothing');
  pass('10 v2.3 projects migrated once into stash records');
  await screenshot('04-migrated');

  // 11. a page that cannot be reopened stays in its stash record instead of being lost
  await evaluate(`chrome.storage.local.get('collectedGroupsV3').then(({ collectedGroupsV3 }) => chrome.storage.local.set({ collectedGroupsV3: [
    { id: 'mixed', savedAt: new Date().toISOString(), name: 'Mixed', tabs: [{ url: ${JSON.stringify(url('ok', 'page'))}, title: 'OK' }, { url: 'javascript:void(0)', title: 'Broken' }] },
    ...collectedGroupsV3] }))`);
  await reloadDashboard();
  await click('[data-action="restore-group"][data-group-id="mixed"]');
  await waitForSite('ok', 1);
  await pause(300);
  const mixed = (await storage('collectedGroupsV3')).find(record => record.id === 'mixed');
  assert.deepEqual(mixed?.tabs.map(tab => tab.url), ['javascript:void(0)'], 'unopenable page stays in the record');
  pass('11 restore keeps pages that could not be opened');

  // 12. saving a pinned page for later closes nothing, so it must not take over the undo:
  //     the toast keeps describing the previous close, and undo still reverts that close.
  await reloadDashboard();
  await click(`${card('mail')} [data-action="close-domain-tabs"]`);
  await waitForSite('mail', 0);
  const mailToast = await evaluate(`document.getElementById('toastText').textContent`);
  const tech = (await fixtureTabs()).find(tab => tab.url === url('news', 'tech'));
  await evaluate(`chrome.tabs.update(${tech.id}, { pinned: true })`);
  const techChip = `${card('news')} .page-chip[data-tab-url="${url('news', 'tech')}"]`;
  await hoverClick(techChip, `${techChip} [data-action="defer-single-tab"]`);
  await waitFor(`chrome.storage.local.get('deferred').then(({ deferred }) => deferred.some(item => item.url === ${JSON.stringify(url('news', 'tech'))}))`, 'pinned page saved for later');
  await pause(300);
  assert.equal(await evaluate(`document.getElementById('toastText').textContent`), mailToast, 'toast still describes the previous close');
  assert.equal((await fixtureTabs()).some(tab => tab.id === tech.id), true, 'pinned page stays open');
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(techChip)}))`), true, 'its row stays on the card');
  await undo();
  await waitForSite('mail', 2);
  assert.equal((await storage('deferred')).some(item => item.url === url('news', 'tech')), true, 'undo of the close keeps the saved item');
  await evaluate(`chrome.tabs.update(${tech.id}, { pinned: false })`);
  pass('12 saving a pinned page for later leaves the previous undo intact');

  // 13. a double click on "close all" keeps the undo available and closes once
  await reloadDashboard();
  const openBefore = (await fixtureTabs()).length;
  // A real double click: the second press lands ~150ms later, while the cards are still animating out.
  await evaluate(`document.querySelector('[data-action="close-all-open-tabs"]').click()`);
  await pause(150);
  await evaluate(`document.querySelector('[data-action="close-all-open-tabs"]')?.click()`);
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => tab.url.includes('.localhost:${port}/')).length === 0)`, 'all closed by double click');
  await pause(1000); // long enough for the live refresh that follows our own closes
  assert.equal(await undoOffered(), true, 'undo is still offered after a double click');
  assert.equal(await evaluate(`Boolean(document.querySelector('#openTabsMissions .missions-empty-state')?.getClientRects().length)`), true,
    'the "inbox zero" state stays on screen after closing everything');
  await undo();
  await waitFor(`chrome.tabs.query({}).then(tabs => tabs.filter(tab => (tab.url || tab.pendingUrl || '').includes('.localhost:${port}/')).length === ${openBefore})`, 'double-click close-all undone');
  pass('13 double-clicking close all keeps one undo for everything');

  // 14. pages opened, retitled or closed in another window show up without a reload,
  //     and the re-render keeps an expanded card expanded and the keyboard focus in place
  await reloadDashboard();
  const live = Array.from({ length: 10 }, (_, index) => url('live', `p${index}`));
  const liveWindow = await evaluate(`chrome.windows.create({ url: ${JSON.stringify(live)}, focused: false }).then(win => win.id)`);
  const liveChips = `${card('live')} .page-chip[data-action="focus-tab"]`;
  await waitFor(`document.querySelectorAll(${JSON.stringify(liveChips)}).length === 10`, 'pages opened in another window appear');
  await waitFor(`document.querySelector(${JSON.stringify(card('live'))}).textContent.includes('live /p0')`, 'their titles arrive');
  await click(`${card('live')} [data-action="expand-chips"]`);
  await evaluate(`document.querySelector(${JSON.stringify(`${liveChips}[data-tab-url="${live[0]}"]`)}).focus()`);
  await evaluate(`chrome.tabs.create({ windowId: ${liveWindow}, url: ${JSON.stringify(url('live', 'p10'))}, active: false })`);
  await waitFor(`document.querySelectorAll(${JSON.stringify(liveChips)}).length === 11`, 'one more page in that window appears');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${card('live')} .page-chips-overflow`)}).style.display`), 'contents', 'expanded card stays expanded');
  assert.equal(await evaluate(`document.activeElement?.dataset.tabUrl`), live[0], 'keyboard focus stays on the same page');
  await evaluate(`chrome.windows.remove(${liveWindow})`);
  await waitFor(`!document.querySelector(${JSON.stringify(card('live'))})`, 'closing that window removes its card');
  pass('14 tabs changed in another window appear without a reload');

  process.stdout.write(`PASS home guard [${locale}]\n`);
} finally {
  page.close();
  server.close();
}
