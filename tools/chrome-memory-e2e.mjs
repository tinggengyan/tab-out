#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionId = process.env.TAB_OUT_EXTENSION_ID;
const directory = process.env.TAB_OUT_E2E_SCREENSHOT_DIR;
const requests = [];
let responseMode = 'ok';
let dashboard, publicPage, privatePage;
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/chat/completions')) {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push({ path: request.url, body, authorization: request.headers.authorization });
    if (responseMode === '429') { response.writeHead(429); response.end('rate limited'); return; }
    if (responseMode === 'invalid') { response.writeHead(200); response.end('not json'); return; }
    if (responseMode === 'slow') await new Promise(done => setTimeout(done, 1000));
    const system = body.messages.find(item => item.role === 'system')?.content || '';
    let content = 'OK';
    if (system.includes('"terms"')) content = JSON.stringify({ terms: ['混合检索', '向量', '稀疏'] });
    if (system.includes('"rankings"')) {
      const payload = JSON.parse(body.messages.at(-1).content);
      content = JSON.stringify({ rankings: [{ id: 'fabricated-record', reason: 'must never display' }, ...payload.candidates.map(item => ({ id: item.id, reason: '正文包含相关检索方法' }))] });
    }
    if (system.includes('"items"')) {
      const payload = JSON.parse(body.messages.at(-1).content);
      const source = payload.sources[0];
      content = JSON.stringify({ items: [{ text: '混合检索结合词法匹配与向量方法。', sourceIds: [source.id], quote: source.text.slice(0, 45) },
        { text: 'Invented statement', sourceIds: ['fabricated-record'], quote: 'not in evidence' }] });
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); return;
  }
  const authenticated = request.headers.cookie?.includes('memory_session=fixture');
  const privateRoute = request.url.startsWith('/private');
  const text = privateRoute ? authenticated ? '内网资料：混合检索结合词法匹配和向量召回。模型重排可以改善相关性，但每条结论都要附上原始出处。' : '请登录后查看文档。'
    : '混合检索将稀疏词法与稠密向量融合，既保留精确关键词匹配，又能理解相近含义。评估时应核对真实来源，记录延迟和召回效果。';
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><meta charset="utf-8"><title>${privateRoute ? 'Team Notes' : 'Field Notes'}</title><form><article>nested-draft-secret</article></form><main><h1>${privateRoute ? 'Team Notes' : 'Field Notes'}</h1><p>${text}</p><nav>navigation-secret</nav><form><input value="password-secret"><textarea>draft-sensitive</textarea></form><div contenteditable="true">editable-draft-secret</div><p hidden>hidden-private-secret</p></main>`);
});

const command = (action, payload = {}) => dashboard.evaluate(`(async()=>{
  const result=await chrome.runtime.sendMessage({type:'browsing-memory',action:${JSON.stringify(action)},payload:${JSON.stringify(payload)}});
  if(!result?.ok) throw new Error(result?.error?.code || 'bridge failed');return result.data;
})()`);

async function main() {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port, base = `http://127.0.0.1:${port}`, privateURL = `http://localhost:${port}/private`;
  dashboard = await connectPage(origin, `chrome-extension://${extensionId}/index.html`);
  const { evaluate, click, fill, waitFor, screenshot } = dashboard;
  await waitFor('globalThis.tabOutBrowsingMemory && document.readyState === "complete"', 'memory UI initialized');
  await command('clear');
  await evaluate('chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false})');
  await dashboard.send('Page.reload');
  await waitFor('globalThis.tabOutBrowsingMemory && document.readyState === "complete"', 'clean dashboard');
  const initial = await command('status');
  assert.equal(initial.settings.recording, false); assert.equal(initial.stats.total, 0); assert.equal(requests.length, 0);
  await click('#dashboardNavMemory');
  await screenshot('01-memory-empty');
  await click('#memorySettingsToggle');
  await fill('#memoryBaseUrl', base + '/v1'); await fill('#memoryModel', 'fixture-compatible-chat'); await fill('#memoryApiKey', 'fixture-key');
  await click('#memorySaveSettingsBtn');
  await waitFor('tabOutBrowsingMemory.controller.state.settings.apiKeyConfigured', 'model settings saved');
  assert.equal(await evaluate('document.querySelector("#memoryApiKey").value'), '');
  await click('#memoryTestBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.busy', 'connection test complete');
  assert.ok(requests.some(item => item.path === '/v1/chat/completions' && item.authorization === 'Bearer fixture-key'));
  console.log('PASS custom Chat Completions path, model, auth header and masked persisted settings');
  await click('#memoryRecordingBtn');
  await waitFor('tabOutBrowsingMemory.controller.state.settings.recording', 'opt-in capture active');
  publicPage = await connectPage(origin, base + '/article');
  await waitFor(`chrome.runtime.sendMessage({type:'browsing-memory',action:'status'}).then(r=>r.data?.stats.withContent>=1)`, 'public article captured');
  privatePage = await connectPage(origin, 'about:blank');
  await privatePage.send('Network.setCookie', { name: 'memory_session', value: 'fixture', url: privateURL });
  await privatePage.send('Page.navigate', { url: privateURL });
  await waitFor(`chrome.runtime.sendMessage({type:'browsing-memory',action:'status'}).then(r=>r.data?.stats.withContent>=2)`, 'authenticated article captured');
  let backup = await command('export');
  const privateRecord = backup.records.find(item => item.url === privateURL);
  assert.ok(privateRecord.text.includes('内网资料'));
  assert.ok(!JSON.stringify(backup).includes('fixture-key'));
  for (const forbidden of ['navigation-secret', 'password-secret', 'draft-sensitive', 'editable-draft-secret', 'hidden-private-secret', 'nested-draft-secret']) assert.ok(!JSON.stringify(backup).includes(forbidden), `captured ${forbidden}`);
  await publicPage.evaluate(`history.pushState({},'', '/article#/next');document.querySelector('main').innerHTML='<h1>Next Notes</h1><p>本地小模型量化可以降低内存占用，适合离线试验。修改页面后仍应保存正确的网址。</p>'`);
  await publicPage.send('Page.bringToFront');
  await waitFor(`chrome.runtime.sendMessage({type:'browsing-memory',action:'export'}).then(r=>r.data?.records.some(x=>x.url.endsWith('#/next')&&x.text.includes('量化')))`, 'hash-route dynamic content captured');
  console.log('PASS actual public/authenticated DOM capture, sensitive inputs excluded, hash-route navigation');
  await evaluate(`chrome.history.addUrl({url:${JSON.stringify(base + '/metadata-only')}})`);
  await click('#memoryHistoryBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.busy', 'actual browser history import');
  backup = await command('export');
  assert.ok(backup.records.some(item => item.source === 'history' && !item.text));
  assert.ok(backup.records.find(item => item.url === privateURL).text.includes('内网资料'));
  await click('#memoryRecordingBtn'); await waitFor('!tabOutBrowsingMemory.controller.state.settings.recording', 'capture paused for search snapshot');
  await fill('#memoryQuery', '混合检索'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length>=2', 'local body search');
  const beforeAI = requests.length;
  await fill('#memoryUseAI', 'ai'); await fill('#memoryQuery', '帮我找既理解意思又保留精确匹配的资料'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.mode==="expanded"', 'query-only expansion');
  const queryRequests = requests.slice(beforeAI);
  assert.ok(queryRequests.length > 0);
  assert.ok(queryRequests.every(item => !JSON.stringify(item.body).includes('Field Notes') && !JSON.stringify(item.body).includes('内网资料')));
  assert.ok((await evaluate('tabOutBrowsingMemory.controller.state.results')).some(item => item.url === privateURL));
  console.log('PASS real history import, captured content preserved, local body search and query-only AI disclosure');
  // Switching back to local must cancel query-only AI too, before any body consent was given.
  responseMode = 'slow';
  const queryOnlyStart = requests.length;
  await click('#memorySearchBtn');
  for (let i = 0; i < 40 && requests.length === queryOnlyStart; i++) await new Promise(done => setTimeout(done, 30));
  assert.ok(requests.length > queryOnlyStart, 'slow query-only AI request started');
  await fill('#memoryUseAI', 'local');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && !tabOutBrowsingMemory.controller.state.includeContent', 'switching to local cancels query-only AI');
  await fill('#memoryQuery', '混合检索'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.mode==="local" && tabOutBrowsingMemory.controller.state.results.length>=2', 'new local results');
  const localAfterSwitch = await evaluate('tabOutBrowsingMemory.controller.state.results');
  await new Promise(done => setTimeout(done, 1200));
  assert.deepEqual(await evaluate('tabOutBrowsingMemory.controller.state.results'), localAfterSwitch, 'late AI response must not replace local results');
  assert.ok(requests.slice(queryOnlyStart).every(item => !JSON.stringify(item.body).includes('"candidates"')), 'switching modes cannot approve page content');
  responseMode = 'ok'; await fill('#memoryUseAI', 'ai');
  console.log('PASS query-only AI mode switch cancels old request and preserves newer local results');
  await click('#memoryIncludeContent'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.mode==="reranked"', 'content-approved reranking');
  assert.ok((await evaluate('tabOutBrowsingMemory.controller.state.results')).every(item => item.id !== 'fabricated-record'));
  const record = (await evaluate('tabOutBrowsingMemory.controller.state.results')).find(item => item.url === privateURL);
  await click(`#memoryResults input[data-memory-id="${record.id}"]`);
  await click('#memorySummaryBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.busy && tabOutBrowsingMemory.controller.state.summary?.items.length===1', 'cited summary');
  assert.equal(await evaluate('document.querySelectorAll("#memorySummaryList li").length'), 1);
  assert.ok(!await evaluate('document.querySelector("#memorySummary").textContent.includes("Invented statement")'));
  await screenshot('02-memory-search-summary');
  const beforeOpen = await evaluate('chrome.tabs.query({}).then(t=>t.length)');
  await click('#memoryOpenBtn'); await waitFor('!tabOutBrowsingMemory.controller.state.busy', 'reuse selected open page');
  assert.equal(await evaluate('chrome.tabs.query({}).then(t=>t.length)'), beforeOpen);
  await click('#memorySaveBtn'); await waitFor('!tabOutBrowsingMemory.controller.state.busy', 'save selected results');
  assert.ok(await evaluate(`workspaceRepository.list().then(ws=>ws.some(w=>w.entries.some(x=>x.url===${JSON.stringify(privateURL)})))`));
  console.log('PASS bounded reranking, fabricated IDs/citations rejected, cited summary, reuse and save collection');
  responseMode = '429';
  await fill('#memoryQuery', '混合检索'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching', '429 fallback');
  assert.ok((await evaluate('tabOutBrowsingMemory.controller.state.results')).length >= 2);
  assert.ok((await evaluate('tabOutBrowsingMemory.controller.state.warnings')).includes('model_http_429'));
  responseMode = 'invalid'; await click('#memorySearchBtn'); await waitFor('!tabOutBrowsingMemory.controller.state.searching', 'invalid JSON fallback');
  assert.ok((await evaluate('tabOutBrowsingMemory.controller.state.warnings')).includes('invalid_model_response'));
  responseMode = 'ok';
  console.log('PASS actual HTTP429 and malformed model response retain local search');
  const beforeCancel = requests.length;
  responseMode = 'slow';
  await click('#memorySearchBtn');
  for (let i = 0; i < 30 && requests.length === beforeCancel; i++) await new Promise(done => setTimeout(done, 30));
  assert.ok(requests.length > beforeCancel, 'delayed query expansion started');
  await click('#memoryIncludeContent');
  await waitFor('!tabOutBrowsingMemory.controller.state.includeContent && !tabOutBrowsingMemory.controller.state.searching', 'content permission revoked');
  await new Promise(done => setTimeout(done, 1200));
  assert.ok(requests.slice(beforeCancel).every(item => !JSON.stringify(item.body).includes('"candidates"')), 'revoked content was sent to reranking');
  assert.deepEqual(await evaluate('tabOutBrowsingMemory.controller.state.results'), []);
  responseMode = 'ok';
  console.log('PASS withdrawing content consent aborts pending expansion and prevents later evidence upload');
  const downloadDir = resolve(directory, 'downloads');
  await rm(downloadDir, { recursive: true, force: true });
  await mkdir(downloadDir, { recursive: true });
  await dashboard.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await click('#memoryExportBtn'); await waitFor('!tabOutBrowsingMemory.controller.state.busy', 'memory export requested');
  let download;
  for (let i = 0; i < 50; i++) { download = (await readdir(downloadDir)).find(name => name.endsWith('.json')); if (download) break; await new Promise(done => setTimeout(done, 100)); }
  assert.ok(download, 'actual memory export downloaded');
  const exported = JSON.parse(await readFile(join(downloadDir, download), 'utf8'));
  assert.equal(exported.format, 'tab-out-memory'); assert.ok(exported.records.length >= 3); assert.ok(!JSON.stringify(exported).includes('fixture-key'));
  await click('#memoryClearBtn'); await click('#memoryConfirmYes'); await waitFor('tabOutBrowsingMemory.controller.state.stats.total===0', 'clear confirmed');
  await dashboard.send('DOM.enable'); const document = await dashboard.send('DOM.getDocument');
  const input = await dashboard.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#memoryImportFile' });
  await dashboard.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [join(downloadDir, download)] });
  await waitFor('!document.querySelector("#memoryImportPreview").hidden', 'file preview shown');
  assert.equal((await command('status')).stats.total, 0);
  await click('#memoryImportConfirmBtn'); await waitFor('tabOutBrowsingMemory.controller.state.stats.total>0', 'confirmed import persisted');
  assert.equal((await command('status')).stats.total, exported.records.length);
  const beforeRestart = await command('export');
  const workerTargets = async () => (await (await fetch(origin + '/json/list')).json())
    .filter(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
  const previousWorker = (await workerTargets())[0];
  assert.ok(previousWorker, 'extension service worker is running before restart');
  await dashboard.send('ServiceWorker.enable');
  await dashboard.send('ServiceWorker.stopAllWorkers');
  for (let i = 0; i < 30 && (await workerTargets()).some(target => target.id === previousWorker.id); i++) {
    await new Promise(done => setTimeout(done, 30));
  }
  assert.ok(!(await workerTargets()).some(target => target.id === previousWorker.id), 'original worker must actually stop');
  const afterRestart = await command('export');
  assert.deepEqual(afterRestart.records, beforeRestart.records, 'actual IndexedDB contents survive worker termination and reopening');
  const reopenedWorker = (await workerTargets())[0];
  assert.ok(reopenedWorker && reopenedWorker.id !== previousWorker.id, 'runtime message started a new service worker target');
  console.log('PASS actual service-worker termination/restart preserves all IndexedDB records and page bodies');
  await dashboard.send('Page.reload'); await waitFor('globalThis.tabOutBrowsingMemory', 'UI reloaded');
  assert.equal((await command('status')).stats.total, exported.records.length);
  await click('#dashboardNavMemory');
  console.log('PASS actual file download, clear-and-pause, file import preview/confirmation and IndexedDB persistence');
  for (const width of [1440, 768, 390]) {
    await dashboard.send('Emulation.setDeviceMetricsOverride', { width, height: 1024, deviceScaleFactor: 1, mobile: width < 500 });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `horizontal overflow ${width}`);
    await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
    await screenshot(`03-memory-${width}`);
  }
  responseMode = 'slow';
  const pending = command('search', { query: '混合检索', days: 30, useAI: true, includeContent: true }).then(() => 'unexpected').catch(error => error.message);
  await new Promise(done => setTimeout(done, 150)); await command('clear');
  const cancelled = await pending;
  assert.match(cancelled, /stale_result|model_cancelled/, `late search was not rejected: ${cancelled}`);
  assert.equal((await command('status')).stats.total, 0);
  console.log('PASS mobile widths and delete/clear invalidates late actual model response');
  console.log('NOTE native optional-permission prompts are not exercised: this isolated copy has pre-granted permissions. Real user provider/actual private sites remain for later integration.');
}

try { await main(); }
finally { dashboard?.close(); publicPage?.close(); privatePage?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
