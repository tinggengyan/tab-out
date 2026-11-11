#!/usr/bin/env node
/* Search with bookmarks and history turned on. A headless browser cannot click Chrome's
   permission prompt, so tools/run-chrome-e2e.mjs loads a copy of the extension whose optional
   permissions are granted up front (same key, same extension ID) and sets TAB_OUT_CDP_ORIGIN,
   TAB_OUT_EXTENSION_ID and TAB_OUT_TEST_LOCALE. The prompt itself is checked by hand. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionId = process.env.TAB_OUT_EXTENSION_ID;
const locale = process.env.TAB_OUT_TEST_LOCALE || 'en-US';
assert.ok(origin && extensionId, 'run through tools/run-chrome-e2e.mjs');
const dashboardUrl = `chrome-extension://${extensionId}/index.html`;

// Fixture pages: http://<site>.localhost:<port>/<path>, titled "<site> /<path>".
const server = createServer((request, response) => {
  const host = (request.headers.host || '').split('.')[0];
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<title>${host} ${request.url}</title><main>fixture</main>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const url = (site, path) => `http://${site}.localhost:${port}/${path}`;

const page = await connectPage(origin, dashboardUrl);
const { send, evaluate, waitFor, click, screenshot } = page;
const requests = [];
page.on('Network.requestWillBeSent', ({ request }) => requests.push(request.url));
await send('Network.enable');

const pause = ms => new Promise(done => setTimeout(done, ms));
const pass = label => process.stdout.write(`PASS ${label} [${locale}]\n`);
const key = async (keyName, code, keyCode) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode });
};
const typeQuery = async text => {
  await evaluate(`(() => { const input = document.getElementById('searchInput'); input.value = ''; input.dispatchEvent(new Event('input')); })()`);
  await send('Input.insertText', { text });
};
const groupText = group => evaluate(`document.querySelector('[data-search-group="${group}"]')?.textContent || ''`);

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`chrome.permissions.contains({ permissions: ['history', 'bookmarks'] })`), true, 'this suite needs the granted copy');

  // ---- Fixture: two pages only in history, one open page (also in history), bookmarks ----
  const ancient = url('hist', 'quokka-ancient');
  const older = url('hist', 'quokka-facts');
  const newer = url('hist', 'quokka-old');
  const openPage = url('live', 'quokka-open');
  for (const visited of [ancient]) {
    const id = await evaluate(`chrome.tabs.create({ url: ${JSON.stringify(visited)}, active: false }).then(tab => tab.id)`);
    await waitFor(`chrome.tabs.get(${id}).then(tab => tab.status === 'complete' && tab.title.includes('quokka'))`, `${visited} loaded`);
    await pause(200);
    await evaluate(`chrome.tabs.remove(${id})`);
  }
  // 3000 newer visits push that first one out of the recent history the overlay loads on open.
  await evaluate(`Promise.all(Array.from({ length: 3000 }, (_, index) => chrome.history.addUrl({ url: 'https://filler.example/' + index })))`);
  for (const visited of [older, newer]) {
    const id = await evaluate(`chrome.tabs.create({ url: ${JSON.stringify(visited)}, active: false }).then(tab => tab.id)`);
    await waitFor(`chrome.tabs.get(${id}).then(tab => tab.status === 'complete' && tab.title.includes('quokka'))`, `${visited} loaded`);
    await pause(200);
    await evaluate(`chrome.tabs.remove(${id})`);
  }
  await evaluate(`chrome.tabs.create({ url: ${JSON.stringify(openPage)}, active: false })`);
  await waitFor(`chrome.history.search({ text: '', startTime: 0, maxResults: 100 }).then(items =>
    [${JSON.stringify(older)}, ${JSON.stringify(newer)}, ${JSON.stringify(openPage)}].every(address => items.some(item => item.url === address)))`, 'visits recorded');
  const barTitle = await evaluate(`(async () => {
    const [root] = await chrome.bookmarks.getTree();
    const bar = root.children[0];
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: 'Animals' });
    await chrome.bookmarks.create({ parentId: folder.id, title: 'Quokka bookmark', url: ${JSON.stringify(url('mark', 'quokka'))} });
    await chrome.bookmarks.create({ parentId: bar.id, title: 'quokka bookmarklet', url: 'javascript:alert(1)' });
    await chrome.bookmarks.create({ parentId: bar.id, title: 'Quokka local file', url: 'file:///tmp/quokka.html' });
    return bar.title;
  })()`);
  await send('Page.reload');
  await waitFor(`document.getElementById('searchTrigger').getBoundingClientRect().width > 0`, 'dashboard rendered');
  requests.length = 0;

  // 1. once granted there is no grant card, and one query reaches bookmarks and history
  await click('#searchTrigger');
  await waitFor(`!document.getElementById('searchOverlay').hidden && document.activeElement?.id === 'searchInput'`, 'overlay open');
  await typeQuery('quokka');
  await waitFor(`document.querySelector('[data-search-group="history"]') !== null`, 'history results');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#searchResults [data-search-group]')].map(group => group.dataset.searchGroup)`),
    ['tabs', 'bookmarks', 'history']);
  assert.equal(await evaluate(`document.getElementById('searchGrant').hidden`), true, 'no grant card once granted');
  await screenshot('search-granted');
  pass('1 bookmarks and history join the results once granted');

  // 2. a bookmark shows its folder; a bookmarklet never appears
  const bookmarks = await groupText('bookmarks');
  assert.ok(bookmarks.includes('Quokka bookmark') && bookmarks.includes(`${barTitle} › Animals`), `bookmark with its folder: ${bookmarks}`);
  assert.ok(!bookmarks.includes('bookmarklet'), 'javascript: bookmarks are left out');
  const fileAccess = await evaluate(`chrome.extension.isAllowedFileSchemeAccess()`);
  assert.equal(bookmarks.includes('Quokka local file'), fileAccess, `file: bookmarks appear only when Chrome lets Tab Out open them (file access ${fileAccess})`);
  pass(`2 bookmarks show their folder; bookmarklets are left out; file: only with file access (${fileAccess})`);

  // 3. history leaves out the page that is already open and lists the newest visit first
  const historyRows = await evaluate(`[...document.querySelectorAll('[data-search-group="history"] [data-search-kind="history"]')].map(row => row.querySelector('.search-title').textContent)`);
  assert.deepEqual(historyRows, ['hist /quokka-old', 'hist /quokka-facts', 'hist /quokka-ancient']);
  assert.ok(!(await groupText('history')).includes('quokka-open'), 'an open page is not repeated under history');
  pass('3 history skips pages shown above, puts the newest visit first, and reaches visits older than the recent 3000');

  // 4. typing on: the results match the last words typed
  await typeQuery('quokka');
  await typeQuery('quokka facts');
  await pause(500);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#searchResults [data-search-kind]')].map(row => row.dataset.searchKind)`), ['history']);
  assert.equal(await evaluate(`document.querySelector('[data-search-kind="history"] .search-title').textContent`), 'hist /quokka-facts');
  pass('4 results follow the last query');

  const outside = requests.filter(request => !/^(chrome-extension|data):/.test(request));
  assert.deepEqual(outside, [], 'search loaded nothing from the network');
  pass('5 no network requests while searching bookmarks and history');

  // 6. Enter on a history result opens it in place of this new-tab page
  await key('Enter', 'Enter', 13);
  const target = url('hist', 'quokka-facts');
  let replaced = false;
  for (let attempt = 0; attempt < 60 && !replaced; attempt++) {
    const targets = await (await fetch(`${origin}/json/list`)).json();
    replaced = targets.some(item => item.type === 'page' && item.url === target)
      && !targets.some(item => item.type === 'page' && item.url === dashboardUrl);
    if (!replaced) await pause(100);
  }
  assert.ok(replaced, 'the dashboard tab now shows the history page');
  pass('6 Enter on a history result replaces this page');

  process.stdout.write(`PASS search granted [${locale}]\n`);
} finally {
  page.close();
  server.close();
}
