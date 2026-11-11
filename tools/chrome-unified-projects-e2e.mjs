#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionURL = `chrome-extension://${process.env.TAB_OUT_EXTENSION_ID}/index.html`;
const directory = process.env.TAB_OUT_E2E_SCREENSHOT_DIR;
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<title>Unified project ${request.url}</title><main>Disposable unified-project fixture.</main>`);
});
let page, second;
let promptText = '';
const errors = [];
const observations = [];
async function evaluateBackground(expression) {
  const targets = await (await fetch(origin + '/json/list')).json();
  const worker = targets.find(target => target.type === 'service_worker' && target.url === extensionURL.replace('index.html', 'background.js'));
  assert.ok(worker, 'isolated extension service worker must be running');
  const socket = new WebSocket(worker.webSocketDebuggerUrl);
  try {
    await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('background evaluation timed out')), 15000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data); if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else done(message.result?.result?.value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  } finally { socket.close(); }
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://localhost:${server.address().port}`;
  page = await connectPage(origin, extensionURL);
  const { evaluate, waitFor, click, fill, screenshot } = page;
  page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true, promptText }).catch(error => errors.push(error.message)));
  const ready = 'globalThis.tabOutProjectWorkbench && globalThis.tabOutDashboardNavigation && globalThis.tabOutBrowsingMemory && chrome.storage.local.get("storageMeta").then(s=>s.storageMeta?.schemaVersion>=2)';
  await waitFor(ready, 'initialized dashboard');
  await evaluate('chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false,interfaceLanguageV1:"zh-CN"})');
  await page.send('Page.reload'); await waitFor(ready, 'localized fixture dashboard');
  const fixture = await evaluate(`(async()=>{
    const current=await chrome.tabs.getCurrent();const tabs=[];
    for(const suffix of ['one','two','pinned'])tabs.push(await chrome.tabs.create({url:${JSON.stringify(base)}+'/'+suffix,windowId:current.windowId,active:false,pinned:suffix==='pinned'}));
    const groupId=await chrome.tabs.group({tabIds:tabs.slice(0,2).map(t=>t.id)});await chrome.tabGroups.update(groupId,{title:'Original native layout',color:'blue',collapsed:true});
    const session=await sessionAdapter.captureTabs(tabs.map(t=>t.id));
    const live=await chrome.tabs.query({windowId:current.windowId});const actualTabs=tabs.map(tab=>live.find(item=>item.id===tab.id));
    for(let i=0;i<3;i++)await workspaceRepository.create({name:'Existing '+i,entries:[{url:${JSON.stringify(base)}+'/existing-'+i,title:'Existing '+i}]});
    const groups=Array.from({length:6},(_,i)=>({id:'legacy-'+i,name:i===0?'Legacy named project':undefined,savedAt:'2025-01-02T03:04:05.000Z',tabs:i===0?actualTabs.map(t=>({url:t.pendingUrl||t.url,title:t.title||t.pendingUrl||t.url})):[{url:${JSON.stringify(base)}+'/same-page',title:'Separate saved record '+i}],...(i===0?{session}:{})}));
    await chrome.storage.local.set({tabGroups:groups});await renderDashboard();
    const other=await chrome.windows.create({url:${JSON.stringify(base)}+'/one',focused:false});
    return {groups,tabs:actualTabs,session,windowId:current.windowId,otherWindowId:other.id,otherTabId:other.tabs[0].id};
  })()`);
  await click('#dashboardNavProjects');
  await waitFor('document.querySelectorAll("#projectList .project-card[data-project-id]").length===9', 'all nine old and new projects');
  assert.equal(await evaluate('document.querySelector("#savedCollections") || document.querySelector("#tabGroupsColumn")'), null);
  let projects = await evaluate('workspaceRepository.list()');
  const migrated = projects.find(item => item.name === 'Legacy named project');
  assert.ok(migrated);
  assert.deepEqual(migrated.session, fixture.session);
  assert.equal(projects.filter(item => item.entries.some(entry => entry.url === base + '/same-page')).length, 5, 'separate saved records sharing a URL stay separate');
  assert.equal(await evaluate('chrome.storage.local.get("tabGroups").then(s=>(s.tabGroups||[]).length)'), 0);
  assert.ok(await evaluate('chrome.storage.local.get("projectMigrationBackupV1").then(s=>s.projectMigrationBackupV1)'), 'original migration backup retained locally');
  await screenshot('01-nine-unified-projects');
  observations.push({ journey: 'mixed migration', projects: projects.length, originalSessionPreserved: true });

  // Two real extension documents compete under the same browser storage lock.
  second = await connectPage(origin, extensionURL); await second.waitFor(ready, 'second dashboard');
  const beforeConcurrent = projects.length;
  await Promise.all([
    evaluate('workspaceRepository.create({name:"Concurrent first",entries:[]})'),
    second.evaluate('workspaceRepository.create({name:"Concurrent second",entries:[]})'),
  ]);
  assert.equal((await evaluate('workspaceRepository.list()')).length, beforeConcurrent + 2, 'concurrent contexts cannot overwrite saved projects');
  if(await evaluate('Boolean(document.querySelector("#projectDetailBackBtn")?.getClientRects().length)'))await click('#projectDetailBackBtn');
  await evaluate(`workspaceRepository.importLegacyGroups(${JSON.stringify(fixture.groups)})`);
  assert.equal((await evaluate('workspaceRepository.list()')).length, beforeConcurrent + 2, 'repeated historical import does not duplicate projects');
  await second.send('Page.close'); second.close(); second = null;
  console.log('PASS mixed migration retains six records/native layout; real concurrent documents and repeated old imports preserve one canonical project list');

  await click('#dashboardNavTabs');
  const tabsBeforePreview = await evaluate('chrome.tabs.query({}).then(t=>t.map(({id,windowId,groupId,pinned,url})=>({id,windowId,groupId,pinned,url})).sort((a,b)=>a.id-b.id))');
  await click('[data-action="switch-tabs-view"][data-view="domain"]');
  await click('details.tabs-card-menu > summary');
  await click('[data-action="select-domain-tabs"]');
  await click('#tabsSelectionSaveBtn');
  await waitFor('document.querySelector("#projectDialogOverlay").style.display!=="none" && !tabOutProjectWorkbench.controller.state.previewBusy', 'domain shortcut opens common preview');
  const across = await evaluate('({ids:tabOutProjectWorkbench.controller.state.preview.tabIds,scope:document.querySelector("#projectScope").textContent})');
  assert.deepEqual(across.ids.toSorted(), [...fixture.tabs.map(tab => tab.id), fixture.otherTabId].toSorted(), 'domain shortcut selects exact tabs across both windows');
  assert.ok(across.scope.includes('跨窗口'), 'preview explicitly describes its cross-window range');
  await click('#projectCancelBtn');
  assert.deepEqual(await evaluate('chrome.tabs.query({}).then(t=>t.map(({id,windowId,groupId,pinned,url})=>({id,windowId,groupId,pinned,url})).sort((a,b)=>a.id-b.id))'), tabsBeforePreview, 'cancelling preview cannot change pages');

  // Exercise the actual registered command handler function in the isolated worker;
  // native OS shortcut delivery is outside this headless check.
  await click('#dashboardNavTabs'); await page.send('Page.bringToFront');
  await evaluateBackground('collectCurrentWindow().then(()=>true)');
  await waitFor('document.querySelector("#projectDialogOverlay").style.display!=="none" && !tabOutProjectWorkbench.controller.state.previewBusy', 'background command opens preview instead of closing pages');
  assert.deepEqual(await evaluate('tabOutProjectWorkbench.controller.state.preview.tabIds.toSorted()'), fixture.tabs.map(tab => tab.id).toSorted(), 'background command scopes exact current-window tabs');
  assert.ok(!(await evaluate('document.querySelector("#projectScope").textContent')).includes(String(fixture.windowId)), 'preview never exposes the internal Chrome window identifier');
  assert.deepEqual(await evaluate('chrome.tabs.query({}).then(t=>t.map(({id,windowId,groupId,pinned,url})=>({id,windowId,groupId,pinned,url})).sort((a,b)=>a.id-b.id))'), tabsBeforePreview, 'background shortcut does not close even pinned pages before confirmation');
  await screenshot('02-command-save-preview'); await click('#projectCancelBtn');
  console.log('PASS real domain shortcut uses exact IDs across windows; background command opens a current-window preview with no automatic closure');

  await click('#dashboardNavProjects');
  promptText = 'Renamed unified project';
  await click(`[data-project-action="rename"][data-project-id="${migrated.id}"]`);
  await waitFor(`workspaceRepository.get(${JSON.stringify(migrated.id)}).then(w=>w.name==="Renamed unified project")`, 'migrated project renamed');
  await click(`[data-project-action="replace"][data-project-id="${migrated.id}"]`);
  await waitFor('document.querySelector("#projectDialogOverlay").style.display!=="none" && !tabOutProjectWorkbench.controller.state.previewBusy', 'migrated update uses common preview');
  const updateState = await evaluate('({source:tabOutProjectWorkbench.controller.state.sourceWorkspaceId,ids:tabOutProjectWorkbench.controller.state.preview.tabIds})');
  assert.equal(updateState.source, migrated.id);
  assert.deepEqual(updateState.ids.toSorted(), fixture.tabs.map(tab => tab.id).toSorted(), 'same-URL page in another window is not selected');
  const beforeUpdateTabs = await evaluate('chrome.tabs.query({}).then(t=>t.map(({id,windowId,groupId,pinned,url})=>({id,windowId,groupId,pinned,url})).sort((a,b)=>a.id-b.id))');
  await click('#projectSaveOnlyBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.status==="complete" && !tabOutProjectWorkbench.controller.state.busy', 'same project updated');
  assert.equal((await evaluate('workspaceRepository.list()')).length, 11, 'update does not create another project');
  const updatedSession = (await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`)).session;
  assert.deepEqual(await evaluate('chrome.tabs.query({}).then(t=>t.map(({id,windowId,groupId,pinned,url})=>({id,windowId,groupId,pinned,url})).sort((a,b)=>a.id-b.id))'), beforeUpdateTabs, 'save-only cannot close, move, repin or create a page');
  assert.ok(await evaluate('document.querySelector("#projectViewBtn").getClientRects().length'), 'result exposes View project');
  await click('#projectViewBtn');
  await waitFor('document.querySelector("#projectDialogOverlay").style.display==="none"', 'view project closes result');
  assert.equal(await evaluate('document.querySelector("#projectList .project-card[data-project-id]").dataset.projectId'), migrated.id, 'updated project sorts first');
  await waitFor('Boolean(document.querySelector("#projectDetailBackBtn")?.getClientRects().length)','view result enters saved detail');
  await click('#projectDetailBackBtn');
  await evaluate(`workspaceRepository.importLegacyGroups(${JSON.stringify(fixture.groups)})`);
  assert.equal((await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`)).name, 'Renamed unified project', 'reimporting old source must not reset later edits');
  console.log('PASS migrated project can rename/update its same identity; cross-window duplicate is untouched; result links to newest project');

  await click(`[data-project-action="delete"][data-project-id="${migrated.id}"]`);
  await waitFor(`workspaceRepository.get(${JSON.stringify(migrated.id)}).then(w=>!w)`, 'project goes to trash');
  await click('#trashOpenBtn');
  const trash = await evaluate(`trashRepository.list().then(items=>items.find(item=>item.entityId===${JSON.stringify(migrated.id)}))`);
  assert.ok(trash);
  await click(`[data-action="restore-trash"][data-trash-id="${trash.id}"]`);
  await waitFor(`workspaceRepository.get(${JSON.stringify(migrated.id)}).then(w=>!!w)`, 'unified project restored');
  await click('[data-action="close-trash"]');
  assert.deepEqual((await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`)).session, updatedSession, 'trash roundtrip keeps the updated native layout exactly');

  // Both sides of a switch must support migrated identities, including a failed target.
  const migratedTarget = await evaluate('workspaceRepository.list().then(items=>items.find(w=>w.legacyGroupId==="legacy-1"))');
  await evaluate(`globalThis.__unifiedSwitchInjected=0;globalThis.__unifiedCreate=chrome.tabs.create.bind(chrome.tabs);globalThis.__unifiedWindowCreate=chrome.windows.create.bind(chrome.windows);chrome.tabs.create=async value=>{if(value.url===${JSON.stringify(base + '/same-page')}){__unifiedSwitchInjected++;throw new Error('Injected migrated tab failure')}return __unifiedCreate(value)};chrome.windows.create=async value=>{if([].concat(value.url||[]).includes(${JSON.stringify(base + '/same-page')})){__unifiedSwitchInjected++;throw new Error('Injected migrated window failure')}return __unifiedWindowCreate(value)}`);
  await click(`[data-project-action="switch"][data-project-id="${migratedTarget.id}"]`);
  await waitFor('document.querySelector("#projectSourceSelect").getClientRects().length', 'migrated switch source chooser');
  await fill('#projectSourceSelect', migrated.id);
  await waitFor('!tabOutProjectWorkbench.controller.state.previewBusy && !document.querySelector("#projectExecuteBtn").disabled', 'migrated source selected');
  await click('#projectExecuteBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.counts.failed>0 && !tabOutProjectWorkbench.controller.state.busy', 'failed destination reported');
  assert.ok(await evaluate('__unifiedSwitchInjected>0'), 'injected failure must reach the actual window/tab creation path');
  assert.equal(await evaluate('tabOutProjectWorkbench.controller.state.result.counts.closed'), 0, 'failed migrated target cannot close source');
  for (const tab of fixture.tabs) assert.equal(await evaluate(`chrome.tabs.get(${tab.id}).then(t=>t.windowId)`), fixture.windowId);
  await screenshot('04-migrated-switch-source-kept');
  await evaluate('chrome.tabs.create=__unifiedCreate;chrome.windows.create=__unifiedWindowCreate'); await click('#projectRetryBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.status==="complete" && !tabOutProjectWorkbench.controller.state.busy', 'migrated destination retries safely');
  await click('#projectDoneBtn');
  await click(`[data-project-action="switch"][data-project-id="${migratedTarget.id}"]`);
  await waitFor('document.querySelector("#projectSourceSelect").getClientRects().length', 'repeat switch preview');
  await fill('#projectSourceSelect', migrated.id);
  await waitFor('!tabOutProjectWorkbench.controller.state.previewBusy && !document.querySelector("#projectExecuteBtn").disabled', 'repeat migrated source selected');
  await click('#projectExecuteBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.status==="complete" && !tabOutProjectWorkbench.controller.state.busy', 'complete migrated switch');
  assert.equal(await evaluate('tabOutProjectWorkbench.controller.state.result.counts.closed'), 2, 'only two selected ordinary source pages close');
  assert.equal(await evaluate(`chrome.tabs.get(${fixture.tabs.find(tab=>tab.pinned).id}).then(t=>t.pinned)`), true, 'fixed source page stays open');
  assert.equal(await evaluate(`chrome.tabs.get(${fixture.otherTabId}).then(t=>t.windowId)`), fixture.otherWindowId, 'same-URL unrelated window stays untouched');
  await click('#projectUndoBtn');
  await waitFor('tabOutProjectWorkbench.controller.state.result?.undoAttempt && !document.querySelector("#projectUndoBtn").disabled', 'switch Undo settles');
  assert.ok(await evaluate(`workspaceRepository.get(${JSON.stringify(migrated.id)})`), 'Undo keeps migrated source project');
  await click('#projectDoneBtn');
  console.log('PASS migrated source/target switch keeps source on failure, retries, protects fixed/unrelated pages and retains projects after Undo');

  await evaluate(`chrome.runtime.sendMessage({type:'browsing-memory',action:'import',payload:{preview:false,backup:{format:'tab-out-memory',version:1,exportedAt:new Date().toISOString(),records:[{url:${JSON.stringify(base + '/memory-saved')},title:'Remembered research',text:'unifiedmemoryfixture saved reading evidence',visitedAt:Date.now(),capturedAt:Date.now(),source:'import'}]}}}).then(r=>{if(!r.ok)throw new Error(r.error?.code)})`);
  await click('#dashboardNavMemory'); await fill('#memoryQuery', 'unifiedmemoryfixture'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length===1', 'remembered page found');
  await click('#memoryResults input[data-memory-id]'); promptText = 'Memory saved project'; await click('#memorySaveBtn');
  await waitFor(`workspaceRepository.list().then(items=>items.length===12&&items.some(w=>w.entries.some(e=>e.url===${JSON.stringify(base + '/memory-saved')})))`, 'Free memory save also creates a project beyond the old limit');
  await click('#dashboardNavProjects');
  console.log('PASS Free memory result saves into the same project library when already above the former three-project limit');

  const imported = await evaluate(`(async()=>{
    const before=await workspaceRepository.list();const portable=TabOutCore.createPortableBackup(await chrome.storage.local.get(null));
    if((portable.data.tabGroups||[]).length)throw new Error('modern export duplicated legacy batches');
    const valid=TabOutCore.validatePortableBackup(portable);if(!valid.ok)throw new Error(valid.error);
    await workspaceRepository.importData(valid.data,{strategy:'merge'});await workspaceRepository.importData(valid.data,{strategy:'merge'});
    return {before:before.length,after:(await workspaceRepository.list()).length,portable};
  })()`);
  assert.equal(imported.before, imported.after);
  await writeFile(join(directory, 'portable-fixture.json'), JSON.stringify(imported.portable, null, 2));
  await screenshot('03-restored-unified-project');
  console.log('PASS project delete/restore and repeated modern backup merge preserve all project identities without duplicate legacy records');

  // Use the actual File -> validator -> preview -> confirmation chain, not a repository shortcut.
  async function importViaUI(payload, strategy) {
    await evaluate(`importConfig(new File([${JSON.stringify(JSON.stringify(payload))}],'historical-tab-out.config',{type:'application/json'}))`);
    await waitFor('getComputedStyle(document.querySelector("#importPreviewOverlay")).display!=="none"', 'actual file import preview');
    await click(`input[name="importStrategy"][value="${strategy}"]`);
    await click('[data-action="confirm-import-preview"]');
    await waitFor('getComputedStyle(document.querySelector("#importPreviewOverlay")).display==="none"', 'actual file import completes');
    await evaluate('tabOutProjectWorkbench.refresh()');
  }
  const legacyGroup = {
    name: 'Legacy UI named project', savedAt: '2025-02-03T04:05:06.000Z', session: fixture.session,
    tabs: fixture.session.windows.flatMap(window => window.tabs).map(({ url, title, pinned }) => ({ url, title, pinned })),
  };
  const legacyFile = { tabGroups: [legacyGroup, structuredClone(legacyGroup)] };
  await importViaUI(legacyFile, 'merge');
  const firstLegacy = (await evaluate('workspaceRepository.list()')).filter(item => item.name === legacyGroup.name);
  assert.equal(firstLegacy.length, 2, 'two identical anonymous records in one legacy file stay distinct');
  assert.equal(new Set(firstLegacy.map(item => item.legacyGroupId)).size, 2, 'anonymous identities distinguish source positions');
  for (const item of firstLegacy) {
    assert.equal(item.createdAt, legacyGroup.savedAt); assert.deepEqual(item.session, fixture.session);
    assert.ok(item.entries.some(entry => entry.pinned), 'legacy pinned page survives validation');
  }
  await importViaUI(legacyFile, 'merge');
  assert.equal((await evaluate('workspaceRepository.list()')).length, 14, 'same anonymous file merged twice cannot add duplicates');
  promptText = 'Edited after legacy UI import';
  await click(`[data-project-action="rename"][data-project-id="${firstLegacy[0].id}"]`);
  await waitFor(`workspaceRepository.get(${JSON.stringify(firstLegacy[0].id)}).then(w=>w.name===${JSON.stringify(promptText)})`, 'imported project renamed through UI');
  await importViaUI(legacyFile, 'merge');
  assert.equal((await evaluate(`workspaceRepository.get(${JSON.stringify(firstLegacy[0].id)})`)).name, promptText, 'legacy reimport retains later user edits');
  await importViaUI(legacyFile, 'replace');
  const replaced = await evaluate('workspaceRepository.list()'); assert.equal(replaced.length, 2);
  for (const item of replaced) { assert.equal(item.name, legacyGroup.name); assert.deepEqual(item.session, fixture.session); }
  await screenshot('05-legacy-file-replaced-projects');
  await importViaUI(imported.portable, 'replace');
  assert.equal((await evaluate('workspaceRepository.list()')).length, 12, 'modern backup restores the original unified library after explicit replacement');
  console.log('PASS real legacy file UI merge/repeat/replace retains names/dates/native layouts/pins and stable distinct anonymous identities');

  const goodPage = { url: base + '/validated-page', title: 'Valid flat page' };
  const invalidSessions = [
    { windows: [{ tabs: [null], groups: [] }] },
    { windows: [{ tabs: ['invalid page'], groups: [] }] },
    { windows: [{ tabs: [{ title: 'Missing URL' }], groups: [] }] },
    { windows: [{ tabs: [{ url: 'javascript:alert(1)' }], groups: [] }] },
    { windows: [null] },
    { windows: [{ tabs: [goodPage], groups: [null] }] },
    { windows: [{ tabs: [goodPage], groups: [{ tabIds: [{}] }] }] },
  ];
  const badFiles = invalidSessions.map(session => ({ tabGroups: [{ id: 'bad-session', name: 'Do not import', tabs: [goodPage], session }] }));
  badFiles.push(
    { version: 2, data: { workspacesV2: [{ id: 'bad-workspace', entries: [goodPage], session: invalidSessions[0] }] } },
    { version: 2, data: { tabGroups: [{ id: 'bad-modern-group', tabs: [goodPage], session: invalidSessions[0] }] } },
    { version: 2, data: { snapshotsV2: [invalidSessions[0]] } },
  );
  const beforeRejectedFiles = await evaluate('chrome.storage.local.get(null)');
  for (let index = 0; index < badFiles.length; index++) {
    // A new invalid file must also clear the previous valid but unconfirmed draft.
    await evaluate(`importConfig(new File([${JSON.stringify(JSON.stringify(legacyFile))}],'valid-unconfirmed.config',{type:'application/json'}))`);
    assert.equal(await evaluate('!!pendingImport && getComputedStyle(document.querySelector("#importPreviewOverlay")).display!=="none"'), true);
    await evaluate(`importConfig(new File([${JSON.stringify(JSON.stringify(badFiles[index]))}],'invalid-session-${index}.config',{type:'application/json'}))`);
    assert.equal(await evaluate('pendingImport===null && getComputedStyle(document.querySelector("#importPreviewOverlay")).display==="none"'), true, `malformed file ${index} leaves no confirmable draft`);
    assert.deepEqual(await evaluate('chrome.storage.local.get(null)'), beforeRejectedFiles, `malformed file ${index} cannot change existing assets or settings`);
  }
  await screenshot('06-malformed-file-rejected-library-kept');
  console.log('PASS actual legacy/portable file rejection matrix clears stale previews and preserves all existing storage');

  // Existing paid rules must recover exactly once even if the user has since downgraded.
  await evaluate(`(async()=>{await ruleRepository.create({workspaceId:${JSON.stringify(migrated.id)},pattern:${JSON.stringify(base + '/*')},mode:'suggest'});await ruleRepository.create({workspaceId:${JSON.stringify(migrated.id)},pattern:'example.invalid',mode:'auto',enabled:false});})()`);
  for (const scenario of ['final-trash-write', 'second-rule-write']) {
    await click(`[data-project-action="delete"][data-project-id="${migrated.id}"]`);
    await waitFor(`workspaceRepository.get(${JSON.stringify(migrated.id)}).then(w=>!w)`, 'rule-bearing project deleted');
    const item = await evaluate(`trashRepository.list().then(items=>items.find(item=>item.entityId===${JSON.stringify(migrated.id)}))`);
    assert.equal(item.payload.rules.length, 2, 'both original rules are in the recovery payload');
    const failedRestore = await evaluate(`(async()=>{
      const original=chrome.storage.local.set.bind(chrome.storage.local);let ruleWrites=0,injected=0,rejected=false;
      chrome.storage.local.set=async value=>{if((${JSON.stringify(scenario)}==='final-trash-write'&&Object.hasOwn(value,'trashV2'))||(${JSON.stringify(scenario)}==='second-rule-write'&&Object.hasOwn(value,'workspaceRulesV2')&&++ruleWrites===2)){injected++;throw new Error('Injected recovery commit failure')}return original(value)};
      try{await restoreTrashItem(${JSON.stringify(item.id)})}catch{rejected=true}finally{chrome.storage.local.set=original}
      return {injected,rejected,projects:(await workspaceRepository.list()).filter(w=>w.id===${JSON.stringify(migrated.id)}),rules:(await ruleRepository.list()).filter(r=>r.workspaceId===${JSON.stringify(migrated.id)}),trash:await trashRepository.list()};
    })()`);
    assert.ok(failedRestore.injected > 0 && failedRestore.rejected, 'fault injection reaches the actual app recovery function');
    assert.equal(failedRestore.projects.length, 1); assert.ok(failedRestore.trash.some(record => record.id === item.id));
    assert.equal(failedRestore.rules.length, scenario === 'final-trash-write' ? 2 : 1);
    await click('#trashOpenBtn'); await click(`[data-action="restore-trash"][data-trash-id="${item.id}"]`);
    await waitFor(`trashRepository.list().then(items=>!items.some(record=>record.id===${JSON.stringify(item.id)}))`, 'actual user retry finishes recovery');
    const recoveredRules = await evaluate(`ruleRepository.list().then(rules=>rules.filter(r=>r.workspaceId===${JSON.stringify(migrated.id)}))`);
    assert.equal(recoveredRules.length, 2, 'retry restores each rule exactly once');
    assert.ok(failedRestore.rules.every(rule => recoveredRules.some(next => next.id === rule.id)), 'successful first-attempt rules keep their identities');
    assert.ok(recoveredRules.some(rule => rule.mode === 'auto' && !rule.enabled), 'disabled auto rule retains its state');
    await click('[data-action="close-trash"]');
  }
  console.log('PASS actual project recovery retries after final trash write or second rule write without duplicate/lost rules');

  // Fault injection at the storage commit boundary must leave source recoverable.
  const fault = await evaluate(`(async()=>{
    globalThis.__unifiedOriginalSet=chrome.storage.local.set.bind(chrome.storage.local);let failures=0;
    chrome.storage.local.set=async value=>{if(Object.hasOwn(value,'workspacesV2')&&Object.hasOwn(value,'tabGroups')){failures++;throw new Error('Injected migration commit failure')}return __unifiedOriginalSet(value)};
    await chrome.storage.local.set({tabGroups:[{id:'fault-project',name:'Fault survives',savedAt:'2025-01-01T00:00:00.000Z',tabs:[{url:${JSON.stringify(base)}+'/fault',title:'Fault survives'}]}]});
    let rejected=false;try{await workspaceRepository.list()}catch{rejected=true}
    const during=await chrome.storage.local.get(['tabGroups','workspacesV2']);chrome.storage.local.set=__unifiedOriginalSet;
    const after=await workspaceRepository.list();return {failures,rejected,source:during.tabGroups,after:after.filter(w=>w.name==='Fault survives').length};
  })()`);
  assert.ok(fault.failures > 0 && fault.rejected, 'injected commit failure actually reached migration');
  assert.equal(fault.source.length, 1, 'failed commit leaves legacy source');
  assert.equal(fault.after, 1, 'retry creates exactly one project');
  console.log('PASS failed migration commit keeps source intact and succeeds once on retry');

  assert.deepEqual(errors, [], 'no uncaught dashboard errors');
  await writeFile(join(directory, 'journeys.json'), JSON.stringify({ ok: true, observations, fault }, null, 2));
} catch (error) {
  try { await page?.screenshot('failure'); } catch { /* retain original failure */ }
  process.stderr.write((error.stack || error) + '\n'); process.exitCode = 1;
} finally {
  page?.close(); second?.close(); server.closeAllConnections();
  if (server.listening) await new Promise(done => server.close(done));
}
