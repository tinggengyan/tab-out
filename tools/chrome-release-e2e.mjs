#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const directory = process.env.TAB_OUT_E2E_SCREENSHOT_DIR;
const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionId = process.env.TAB_OUT_EXTENSION_ID;
let page;
const errors = [];
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<title>Reading ${request.url}</title><main><p>Disposable release convergence fixture.</p></main>`);
});
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://localhost:${server.address().port}`;
  const urls = { one: base + '/one', two: base + '/two', three: base + '/three', saved: base + '/saved', later: base + '/later', archived: base + '/archived', memory: base + '/memory' };
  page = await connectPage(origin, `chrome-extension://${extensionId}/index.html`);
  const { evaluate, waitFor, click, fill, screenshot } = page;
  page.on('Runtime.exceptionThrown', data => errors.push(data.exceptionDetails?.exception?.description || data.exceptionDetails?.text));
  await waitFor('globalThis.tabOutBrowsingMemory && globalThis.tabOutProjectWorkbench && typeof renderDashboard==="function"', 'initialization');
  await waitFor('chrome.storage.local.get("storageMeta").then(s=>s.storageMeta?.schemaVersion>=2)', 'migration before seeding');
  await evaluate('chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false,interfaceLanguageV1:"zh-CN"})');
  await page.send('Page.reload');
  await waitFor('globalThis.tabOutBrowsingMemory && TabOutI18n.locale==="zh-CN"', 'localized clean dashboard');
  const fixture = await evaluate(`(async()=>{
    const tabs=[];for(const url of ${JSON.stringify([urls.one, urls.two, urls.three])})tabs.push(await chrome.tabs.create({url,active:false}));
    const groupId=await chrome.tabs.group({tabIds:tabs.map(t=>t.id)});await chrome.tabGroups.update(groupId,{title:'Reading source',color:'green'});
    const session=await sessionAdapter.captureTabs(tabs.map(t=>t.id));
    const group={id:'release-legacy',name:'Migrated reading',savedAt:new Date().toISOString(),tabs:tabs.map((t,i)=>({title:'Legacy reading '+(i+1),url:t.url})),session};
    const deferred=[{id:'release-later',title:'Later reading',url:${JSON.stringify(urls.later)},savedAt:new Date().toISOString(),completed:false,dismissed:false},
      {id:'release-archived',title:'Archived reading',url:${JSON.stringify(urls.archived)},savedAt:new Date().toISOString(),completed:true,dismissed:false}];
    await chrome.storage.local.set({tabGroups:[group],deferred});
    const workspace=await workspaceRepository.create({name:'Saved reading',entries:[{title:'Saved reading',url:${JSON.stringify(urls.saved)}}]});
    await workspaceRepository.create({name:'Existing project 2',entries:[]});await workspaceRepository.create({name:'Existing project 3',entries:[]});
    await chrome.tabs.remove(tabs.slice(1).map(t=>t.id));await renderDashboard();
    return {group,deferred,workspace,originalOpen:await chrome.tabs.get(tabs[0].id)};
  })()`);
  const command = (action, payload = {}) => evaluate(`(async()=>{const r=await chrome.runtime.sendMessage({type:'browsing-memory',action:${JSON.stringify(action)},payload:${JSON.stringify(payload)}});if(!r?.ok)throw new Error(r?.error?.code);return r.data})()`);
  await command('import', { preview: false, backup: { format: 'tab-out-memory', version: 1, exportedAt: new Date().toISOString(), records: [
    { url: urls.memory, title: 'Orbital mechanics notebook', text: 'Orbital mechanics describes satellite tracking. AI can assist with a simulation.', visitedAt: Date.now(), capturedAt: Date.now(), source: 'import' },
    { url: 'https://baike.baidu.com/item/release-fixture', title: '山水古诗', text: '雨后山水与古诗。', visitedAt: Date.now(), capturedAt: Date.now(), source: 'import' }
  ] } });
  assert.equal(await evaluate('tabOutDashboardNavigation.currentView'), 'tabs', 'reload still defaults to tab management');
  await click('#dashboardNavProjects');
  await waitFor('tabOutDashboardNavigation.currentView==="projects"', 'Saved navigation opens the saved library');
  await click('#dashboardNavTabs');
  await click('#dashboardNavProjects');
  await waitFor('document.querySelectorAll("#projectList .project-card[data-project-id]").length===4 && document.querySelector("#savedLater [data-saved-kind=deferred]")', 'old saved batch and three existing projects share a single list');
  assert.equal(await evaluate('document.querySelector("#dashboardNavProjects").textContent'), await evaluate('t("dashboard.projects")'));
  assert.equal(await evaluate('document.querySelector("#tabGroupsColumn") || document.querySelector("#savedCollections")'), null, 'no second batch library');
  assert.equal(await evaluate('document.querySelector("#projectListCount").textContent'), await evaluate('t("project.projectCount",{n:4})'));
  assert.equal(await evaluate('chrome.storage.local.get("tabGroups").then(s=>(s.tabGroups||[]).length)'), 0, 'legacy records normalized');
  const migrated = await evaluate('workspaceRepository.list().then(items=>items.find(w=>w.name==="Migrated reading"))');
  assert.deepEqual(migrated.session, fixture.group.session, 'migration preserves original native session exactly');
  assert.equal(await evaluate('document.querySelector("#savedLaterTitle").textContent'), await evaluate('t("saved.later",{n:2})'));
  await click('#savedLater > summary'); await click('#savedArchive > summary');
  assert.ok(await evaluate('document.querySelector("#savedArchive").textContent.includes("Archived reading")'));
  await evaluate('tabOutProjectWorkbench.refresh()');
  assert.equal(await evaluate('document.querySelector("#savedLater").open && document.querySelector("#savedArchive").open'), true, 'refresh preserves read-later/archive expansion');
  await screenshot('01-unified-projects');

  // A migrated batch now uses the real project dialog and the same safe continuation path.
  await evaluate(`globalThis.__originalReleaseCreate=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async p=>{if(p.url===${JSON.stringify(urls.three)})throw new Error('Injected fixture failure');return __originalReleaseCreate(p)};globalThis.__originalReleaseGroup=chrome.tabs.group.bind(chrome.tabs);globalThis.__releaseGroupFailure=true;chrome.tabs.group=async p=>{if(__releaseGroupFailure){__releaseGroupFailure=false;throw new Error('Injected native grouping failure')}return __originalReleaseGroup(p)}`);
  const continueSelector = `[data-project-action="resume"][data-project-id="${migrated.id}"]`;
  await click(continueSelector); await waitFor('tabOutProjectWorkbench.controller.state.mode==="resume" && document.querySelector("#projectExecuteBtn").getClientRects().length', 'migrated project preview');
  await click('#projectExecuteBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.status==="partial" && !tabOutProjectWorkbench.controller.state.busy', 'combined page/group failure reported');
  assert.deepEqual((await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`)).session, fixture.group.session, 'partial failure retains saved project');
  assert.equal(await evaluate(`chrome.tabs.query({}).then(t=>t.filter(x=>x.url===${JSON.stringify(urls.one)}).length)`), 1, 'already open page reused');
  await screenshot('02-migrated-project-partial-failure');
  await evaluate('chrome.tabs.create=__originalReleaseCreate');
  await click('#projectRetryBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.status==="complete" && !tabOutProjectWorkbench.controller.state.busy', 'project retry completes');
  for (const url of [urls.one, urls.two, urls.three]) assert.equal(await evaluate(`chrome.tabs.query({}).then(t=>t.filter(x=>x.url===${JSON.stringify(url)}).length)`), 1, 'retry cannot duplicate success');
  const restoredLayout = await evaluate(`(async()=>{const tabs=(await chrome.tabs.query({})).filter(t=>[${JSON.stringify(urls.two)},${JSON.stringify(urls.three)}].includes(t.url));return {windows:[...new Set(tabs.map(t=>t.windowId))],groups:[...new Set(tabs.map(t=>t.groupId))],metadata:await chrome.tabGroups.get(tabs[0].groupId)}})()`);
  assert.equal(restoredLayout.windows.length, 1, 'retry retains its target window');
  assert.equal(restoredLayout.groups.length, 1, 'retry merges old successes and new missing page into one native group');
  assert.equal(restoredLayout.metadata.title, 'Reading source'); assert.equal(restoredLayout.metadata.color, 'green');
  const reusedOriginal = await evaluate(`chrome.tabs.get(${fixture.originalOpen.id})`);
  assert.equal(reusedOriginal.windowId, fixture.originalOpen.windowId, 'pre-existing reused page stays in its window');
  assert.equal(reusedOriginal.groupId, fixture.originalOpen.groupId, 'pre-existing reused page stays in its native group');
  await evaluate('chrome.tabs.group=__originalReleaseGroup');
  await click('#projectDoneBtn');
  assert.deepEqual((await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`)).session, fixture.group.session, 'successful continue retains saved project');
  console.log('PASS old and new projects share one list and real continuation; combined page/group retry preserves native layout and pre-existing pages');

  // Chrome actually destroys an empty native group/window. Retrying must discard its old mapping.
  const staleTargets = await evaluate(`(async()=>{
    async function scenario(kind){
      let failCreate=kind==='group',failMetadata=kind==='metadata';
      const names=kind==='group'?['a','b','c']:['a'];
      const addresses=names.map(name=>${JSON.stringify(base)}+'/stale-'+kind+'-'+name);
      const api={tabs:{query:chrome.tabs.query.bind(chrome.tabs),create:async p=>{if(failCreate&&p.url===addresses[2]){failCreate=false;throw new Error('Injected stale-group create failure')}return chrome.tabs.create(p)},update:async(id,p)=>{if(failMetadata&&'pinned'in p){failMetadata=false;throw new Error('Injected stale metadata failure')}return chrome.tabs.update(id,p)},group:chrome.tabs.group.bind(chrome.tabs)},windows:chrome.windows,tabGroups:chrome.tabGroups};
      const session=TabOutCore.buildSession({windows:[{id:991,tabs:addresses.map((url,index)=>({id:index+1,index,url,pinned:kind==='metadata',...(kind==='group'?{groupId:8}:{})}))}],groups:kind==='group'?[{id:8,title:'Stale group',color:'purple'}]:[]});
      const repo=TabOutCore.createWorkspaceRepository(chrome.storage.local);const source=await repo.saveSession({name:'Stale '+kind,session});
      const service=TabOutCore.createProjectService({chromeApi:api,workspaceRepository:repo,sessionAdapter:TabOutCore.createChromeSessionAdapter(api),operationService:{}});
      const first=await service.resume({preview:await service.previewResume({workspaceId:source.id})});
      const owned=(await chrome.tabs.query({})).filter(t=>addresses.includes(t.pendingUrl||t.url));
      const oldGroupId=owned[0].groupId;await chrome.tabs.remove(owned.map(t=>t.id));
      let groupReallyGone=true;if(kind==='group')try{await chrome.tabGroups.get(oldGroupId);groupReallyGone=false}catch{}
      const second=await service.resume({preview:first.retryPreview}),third=await service.resume({preview:await service.previewResume({workspaceId:source.id})});
      const after=(await chrome.tabs.query({})).filter(t=>addresses.includes(t.pendingUrl||t.url));
      return {kind,first,second,third,groupReallyGone,urls:addresses,tabs:after.map(({url,groupId,pinned})=>({url,groupId,pinned}))};
    }
    return [await scenario('group'),await scenario('metadata')];
  })()`);
  await writeFile(join(directory, 'stale-targets.json'), JSON.stringify(staleTargets, null, 2));
  for (const result of staleTargets) {
    assert.ok(result.first.counts.failed > 0, `${result.kind} injected failure must actually happen`);
    assert.equal(result.second.counts.failed, 0, `${result.kind} retry discards removed target IDs`);
    assert.equal(result.third.counts.failed, 0, `${result.kind} repeated continue remains complete`);
    assert.equal(result.tabs.length, result.urls.length, `${result.kind} retry cannot duplicate pages`);
    if (result.kind === 'group') {
      assert.equal(result.groupReallyGone, true, 'Chrome actually deleted the old group');
      assert.equal(new Set(result.tabs.map(tab => tab.groupId)).size, 1, 'reopened pages form one new group');
      assert.ok(result.tabs.every(tab => tab.groupId >= 0));
    } else assert.equal(result.tabs[0].pinned, true, 'new page receives original pinned metadata');
  }
  console.log('PASS removed native group and closed metadata target do not keep retries permanently partial');

  // Saving without a name still uses the existing explicit selection / preview flow.
  await click('#projectSaveBtn');
  await waitFor('document.querySelector("#projectNameInput").getClientRects().length', 'save preview');
  await fill('#projectNameInput', '');
  const firstCandidate = '#projectCandidates input[data-tab-id]:not(:disabled)';
  await click(firstCandidate);
  await waitFor('!tabOutProjectWorkbench.controller.state.previewBusy && !document.querySelector("#projectSaveOnlyBtn").disabled', 'unnamed selected save enabled');
  await click('#projectSaveOnlyBtn');
  await waitFor('document.querySelector("#projectDoneBtn").getClientRects().length', 'unnamed save result');
  const saved = await evaluate('workspaceRepository.list()');
  assert.equal(saved.length, 7); assert.ok(saved.find(item => item.id !== fixture.workspace.id).name.trim());
  await click('#projectDoneBtn');
  console.log('PASS no-name save generates readable name while retaining explicit page selection');

  // Free query spans existing memory without sending a model request or exporting bodies to the UI.
  await click('#searchOpenBtn');
  await fill('#commandInput', 'orbital');
  await waitFor('Array.from(document.querySelectorAll(".command-result")).some(n=>commandSearchItems.get(n.dataset.searchId)?.url?.endsWith("/memory"))', 'Free memory result actually rendered');
  const memoryResult = await evaluate('Array.from(document.querySelectorAll(".command-result")).map(n=>commandSearchItems.get(n.dataset.searchId)).find(x=>x.url?.endsWith("/memory"))');
  await click(`[data-search-id="${memoryResult.id}"]`);
  await waitFor(`chrome.tabs.query({}).then(t=>t.some(x=>x.url===${JSON.stringify(urls.memory)}))`, 'open memory result');
  await click('#searchOpenBtn'); await fill('#commandInput', 'Saved reading');
  await waitFor('Array.from(document.querySelectorAll(".command-result")).some(n=>commandSearchItems.get(n.dataset.searchId)?.url?.endsWith("/saved"))', 'Free saved result actually rendered');
  await evaluate(`globalThis.__originalReleaseMessage=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async(m,...rest)=>{const r=await __originalReleaseMessage(m,...rest);if(m?.type==='browsing-memory'&&m.action==='search'&&m.payload.query==='orbital')await new Promise(done=>setTimeout(done,500));return r}`);
  await fill('#commandInput', 'orbital'); await fill('#commandInput', 'Saved reading');
  await waitFor('Array.from(document.querySelectorAll(".command-result")).some(n=>commandSearchItems.get(n.dataset.searchId)?.url?.endsWith("/saved"))', 'newer query renders before delayed previous memory response');
  await new Promise(done => setTimeout(done, 650));
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".command-result")).some(n=>commandSearchItems.get(n.dataset.searchId)?.type==="memory")'), false, 'late old-query memory cannot replace newer query');
  await evaluate('chrome.runtime.sendMessage=__originalReleaseMessage');
  await evaluate('closeCommandPalette()');
  await click('#dashboardNavMemory');
  await click('#memoryRefreshBtn');
  await waitFor('tabOutBrowsingMemory.controller.state.stats.total===2', 'memory counts refreshed');
  assert.ok(!await evaluate('document.querySelector("#memoryResults").textContent.includes("从下一次浏览")'), 'existing memory must not get starting-from-zero copy');
  assert.equal(await evaluate('(()=>{const n=document.querySelector("#memoryIncludeContent");return !!n.getClientRects().length&&!n.closest("[hidden]")})()'), false, 'local search hides content-upload consent');
  await fill('#memoryQuery', 'AI'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length===1', 'AI token boundary filters baidu URL');
  assert.ok(await evaluate('document.querySelector("#memoryResults mark")'), 'search highlight shown');
  await screenshot('03-memory-compact-result');
  console.log('PASS Free command search spans saved + memory; local memory has compact highlighted result and no unrelated upload control');

  await click('#settingsOpenBtn');
  assert.equal(await evaluate('document.querySelector("#buySyncBtn").getClientRects().length'), 0, 'unimplemented sync cannot be purchased');
  assert.equal(await evaluate('document.querySelector("#buyLifetimeBtn").getClientRects().length'), 0, 'unconfigured checkout cannot be purchased');
  const settingsText = await evaluate('document.querySelector("#settingsOverlay").textContent');
  assert.ok(settingsText.includes('浏览记忆') && (settingsText.includes('不含') || settingsText.includes('不包含')), 'backup scope explains memory exclusion');
  await screenshot('04-data-settings');
  await click('#settingsMemoryBtn');
  await waitFor('tabOutDashboardNavigation.currentView==="memory" && document.querySelector("#memorySettings").open', 'global settings leads to model controls');

  const downloads = join(directory, 'downloads'); await mkdir(downloads, { recursive: true });
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await click('#settingsOpenBtn'); await click('#settingsMemoryExportBtn');
  let filename;
  for (let i = 0; i < 60; i++) { filename = (await readdir(downloads)).find(name => name.endsWith('.json')); if (filename) break; await new Promise(done => setTimeout(done, 80)); }
  assert.ok(filename, 'independent memory backup produces a real download');
  const exported = JSON.parse(await readFile(join(downloads, filename), 'utf8'));
  assert.equal(exported.format, 'tab-out-memory'); assert.equal(exported.records.length, 2);
  assert.ok(!JSON.stringify(exported).includes('apiKey'));
  assert.deepEqual(errors, [], 'no uncaught page errors');
  await writeFile(join(directory, 'journeys.json'), JSON.stringify({ ok: true, journeys: ['unified-old-assets', 'safe-legacy-partial-retry', 'optional-name-save', 'free-saved-memory-search', 'compact-local-result', 'settings-model-memory-export', 'unavailable-sales-hidden'], errors }, null, 2));
  console.log('PASS truthful settings and sales visibility, discoverable model controls and independent downloaded memory backup');
} catch (error) { await page?.screenshot('failure').catch(() => {}); throw error; }
finally { page?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
