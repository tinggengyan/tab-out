#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const directory = process.env.TAB_OUT_E2E_SCREENSHOT_DIR;
const extensionURL = `chrome-extension://${process.env.TAB_OUT_EXTENSION_ID}/index.html`;
const measurements = [];
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>Original title 原始標題</title><main>Local language fixture</main>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let page;
let second;
const exceptions = [];

try {
  page = await connectPage(process.env.TAB_OUT_CDP_ORIGIN, extensionURL);
  const { evaluate, waitFor, click, fill, screenshot, send } = page;
  page.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails?.text || 'Runtime exception'));
  const ready = 'globalThis.TabOutI18n && globalThis.tabOutBrowsingMemory && globalThis.tabOutDashboardNavigation && document.querySelector("#settingsOpenBtn").textContent && chrome.storage.local.get("storageMeta").then(s=>s.storageMeta?.schemaVersion>=2)';
  await waitFor(ready, 'initialized dashboard');
  const savedAt = new Date().toISOString();
  const url = `http://reading.localhost:${server.address().port}/article`;
  const title = 'Original title 原始標題 ' + 'LongContinuousTitleWithoutSpaces'.repeat(12);
  await evaluate(`(async()=>{
    await chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false,
      deferred:[{id:'language-deferred',title:${JSON.stringify(title)},url:${JSON.stringify(url)},savedAt:${JSON.stringify(savedAt)},completed:false,dismissed:false}],
      tabGroups:[{id:'language-group',savedAt:${JSON.stringify(savedAt)},tabs:[{url:${JSON.stringify(url)},title:${JSON.stringify(title)}}]}]});
  })()`);
  await send('Page.reload');
  await waitFor(ready, 'dashboard after fixture setup');
  await evaluate(`(async()=>{
    const current=await chrome.tabs.getCurrent();
    await chrome.tabs.create({url:${JSON.stringify(url)},windowId:current.windowId,active:false});
    await workspaceRepository.create({name:'My original project 原始名稱',entries:[{url:${JSON.stringify(url)},title:${JSON.stringify(title)}}]});
    await snapshotRepository.add(await sessionAdapter.captureAll('manual',{source:'language-test',note:'Original note 原始備註'}));
    await renderDashboard();
  })()`);
  await waitFor('document.querySelector("#openTabsMissions .mission-card") && document.querySelector("#projectList .project-card")', 'live and saved fixtures');
  const command = (action, payload = {}) => evaluate(`(async()=>{
    const reply=await chrome.runtime.sendMessage({type:'browsing-memory',action:${JSON.stringify(action)},payload:${JSON.stringify(payload)}});
    if(!reply?.ok)throw new Error(reply?.error?.code||'memory bridge failed');return reply.data;
  })()`);
  await command('import', { preview: false, backup: { format: 'tab-out-memory', version: 1, exportedAt: savedAt,
    records: [{ url, title, text: 'languagefixture Original body 原始正文。'.repeat(8), visitedAt: Date.now(), capturedAt: Date.now(), source: 'import' }] } });
  await click('#dashboardNavMemory');
  await click('#memoryRefreshBtn');
  await fill('#memoryQuery', 'languagefixture');
  await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length===1', 'local memory search');
  await click('#memoryResults input[type=checkbox]');
  await evaluate('document.querySelector("#memorySettings").open=true');
  await fill('#memoryBaseUrl', 'https://draft.invalid/v1');
  await fill('#memoryModel', 'unsaved-model');
  await fill('#memoryApiKey', 'synthetic-unsaved-key');
  await fill('#memoryExclusions', 'draft.invalid');
  await fill('#memoryRetention', '180');
  // Keep model output as user data: changing the interface language must not rewrite it.
  await evaluate(`(() => {
    const state=tabOutBrowsingMemory.controller.state;
    state.summary={items:[{text:'Original model output 原始模型內容',quote:'Original body',sourceIds:[state.results[0].id]}],sources:[{id:state.results[0].id,url:state.results[0].url,title:state.results[0].title}]};
    tabOutBrowsingMemory.renderResults();
    globalThis.__languageDocumentToken=crypto.randomUUID();
    globalThis.__languageCalls={permission:0,model:0,search:0};
    const request=chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request=(...args)=>{__languageCalls.permission++;return request(...args);};
    const message=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=(value,...args)=>{
      if(value?.type==='browsing-memory'){
        if(['testConnection','summarize'].includes(value.action))__languageCalls.model++;
        if(value.action==='search')__languageCalls.search++;
      }
      return message(value,...args);
    };
  })()`);
  const stateSnapshot = `(() => ({token:__languageDocumentToken,view:tabOutDashboardNavigation.currentView,
    query:document.querySelector('#memoryQuery').value,days:document.querySelector('#memoryDays').value,
    selected:[...tabOutBrowsingMemory.controller.state.selected],results:tabOutBrowsingMemory.controller.state.results,
    summary:tabOutBrowsingMemory.controller.state.summary,
    fields:['memoryBaseUrl','memoryModel','memoryApiKey','memoryRetention','memoryExclusions'].map(id=>document.getElementById(id).value),
    details:document.querySelector('#memorySettings').open,calls:__languageCalls}))()`;
  const before = await evaluate(stateSnapshot);
  const businessKeys = ['deferred','tabGroups','workspacesV2','snapshotsV2','browsingMemorySettingsV1','browsingMemorySecretV1'];
  const beforeStore = await evaluate(`chrome.storage.local.get(${JSON.stringify(businessKeys)})`);
  const beforeRecords = (await command('export')).records;
  await click('#settingsOpenBtn');
  await waitFor('getComputedStyle(document.querySelector("#settingsOverlay")).display!=="none"', 'settings opens');
  assert.deepEqual(await evaluate('[...document.querySelector("#settingsLanguageSelect").options].map(o=>o.textContent).slice(1)'), ['English','简体中文','繁體中文','日本語']);

  async function key(key, modifiers = 0) {
    const code = { ArrowDown: 40, Home: 36, End: 35, Enter: 13, Escape: 27, Tab: 9 }[key];
    for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,modifiers});
  }
  async function settled(locale) {
    await waitFor(`TabOutI18n.locale===${JSON.stringify(locale)} && document.querySelector('#dashboardNavTabs').textContent===t('dashboard.tabs') && document.querySelector('#memoryHeading').textContent===t('memory.heading') && document.querySelector('#projectHeading').textContent===t('project.heading') && !document.querySelector('#settingsLanguageSelect').disabled`, `all surfaces localized to ${locale}`);
  }
  async function chooseWithKeyboard(index, locale) {
    await evaluate('document.querySelector("#settingsLanguageSelect").focus()');
    // Native closed-select typeahead avoids macOS popup menus outside CDP's page target.
    const character=index ? ['','e','简','繁','日'][index] : await evaluate('document.querySelector("#settingsLanguageSelect").options[0].textContent[0]');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:character,text:character,unmodifiedText:character,windowsVirtualKeyCode:character==='e'?69:character==='f'?70:0});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:character,windowsVirtualKeyCode:character==='e'?69:character==='f'?70:0});
    await waitFor(`TabOutI18n.preference===${JSON.stringify(index ? locales[index-1] : 'auto')}`,'native keyboard selection saved');
    await settled(locale);
  }
  const locales = ['en','zh-CN','zh-TW','ja'];
  for (let index = 0; index < locales.length; index++) {
    const locale = locales[index];
    await chooseWithKeyboard(index + 1, locale);
    assert.equal(await evaluate('document.documentElement.lang'),locale);
    assert.equal(await evaluate('chrome.storage.local.get("interfaceLanguageV1").then(s=>s.interfaceLanguageV1)'),locale);
    assert.deepEqual(await evaluate(stateSnapshot),before,'changing language preserves view, query, results, model drafts and does not invoke model/permissions');
    assert.deepEqual(await evaluate(`chrome.storage.local.get(${JSON.stringify(businessKeys)})`), beforeStore, 'interface selection leaves business storage unchanged');
    assert.deepEqual((await command('export')).records,beforeRecords,'captured text unchanged');
    assert.equal(await evaluate('document.querySelector("#settingsLanguageTitle").textContent'),await evaluate('t("settings.languageTitle")'));
    assert.equal(await evaluate('document.querySelector("#dashboardNavProjects").textContent'), {en:'Saved','zh-CN':'已保存','zh-TW':'已儲存',ja:'保存済み'}[locale], 'saved content remains a distinct navigation item');
    assert.equal(await evaluate('document.querySelector("#tabGroupsColumn") || document.querySelector("#savedCollections")'),null,'no separate batch concept in any language');
    assert.equal(await evaluate('document.querySelectorAll("#projectList .project-card[data-project-id]").length'),2,'old saved batch and newly created project share one list');
    assert.equal(await evaluate('document.querySelector("#projectListCount").textContent'),await evaluate('workspaceRepository.list().then(items=>t("project.projectCount",{n:items.length}))'));
    assert.equal(await evaluate('document.querySelector("[data-action=close-settings]").getAttribute("aria-label")'),await evaluate('t("common.close")'));
    assert.equal(await evaluate('document.querySelector("#shortcutAddBtn").title'),await evaluate('t("shortcuts.add")'));
    assert.equal(await evaluate('document.querySelector("#commandInput").placeholder'),await evaluate('t("search.commandPlaceholder")'));
    assert.equal(await evaluate('document.querySelector("#memoryResults .memory-result-meta").textContent.includes(new Date(tabOutBrowsingMemory.controller.state.results[0].visitedAt).toLocaleString(TabOutI18n.locale,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}))'),true);
    assert.equal(await evaluate('document.querySelector("#memoryResults input[type=checkbox]").getAttribute("aria-label")'),await evaluate('t("memory.selectResult",{title:tabOutBrowsingMemory.controller.state.results[0].title})'));
    assert.ok(!(await evaluate('document.querySelector("#memoryResults input[type=checkbox]").getAttribute("aria-label")')).includes('memory.selectResult'),'result control has a translated accessible name');
    assert.equal(await evaluate('chrome.storage.local.get("tabGroups").then(s=>(s.tabGroups||[]).length)'),0,'legacy batches normalized before language changes');
    assert.ok(await evaluate(`document.querySelector('#projectList').textContent.includes(${JSON.stringify(title.slice(0,60))})`),'original migrated page title is preserved');
    assert.equal(await evaluate('document.querySelector(".project-card-footer>span").textContent'),await evaluate('workspaceRepository.get(document.querySelector("#projectList .project-card[data-project-id]").dataset.projectId).then(w=>t("project.updatedDate",{date:new Intl.DateTimeFormat(TabOutI18n.locale,{month:"short",day:"numeric"}).format(new Date(w.sessionSavedAt||w.updatedAt||w.createdAt))}))'));
    await evaluate('renderHistory()');
    assert.equal(await evaluate('document.querySelector("#historyList .trash-item-title").textContent'),await evaluate('snapshotRepository.list().then(items=>new Date(items[0].capturedAt).toLocaleString(TabOutI18n.locale))'));
    await screenshot(`${locale}-settings`);
    await key('Escape');
    for (const [width,height] of [[1440,900],[1366,768],[390,844]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      let footerBaseline;
      for (const view of ['tabs','projects','memory']) {
        await click({tabs:'#dashboardNavTabs',projects:'#dashboardNavProjects',memory:'#dashboardNavMemory'}[view]);
        await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
        await screenshot(`${locale}-${view}-${width}`);
        const metric = await evaluate(`(() => {const card=document.querySelector('#openTabsMissions .mission-card')?.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardTop:card?.top,buttons:[...document.querySelectorAll('#dashboardNavigation .dashboard-navigation-actions button')].map(n=>({visible:!!n.getClientRects().length,width:n.getBoundingClientRect().width})),quickActions:[...document.querySelectorAll('#tabsQuickActions button')].map(n=>({visible:!!n.getClientRects().length,width:n.getBoundingClientRect().width}))};})()`);
        const frame=await evaluate(`(() => {const n=document.querySelector('#dashboardFooter'),r=n.getBoundingClientRect(),host=document.querySelector('#dashboardContent');return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,pageY:window.scrollY,hostWidth:host.clientWidth,hostScrollWidth:host.scrollWidth,contentBottom:host.getBoundingClientRect().bottom,controls:[...n.querySelectorAll('a,button')].map(b=>{const q=b.getBoundingClientRect();return {top:q.top,bottom:q.bottom,hit:b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))};})};})()`);
        assert.ok(Math.abs(frame.bottom-height)<=1,`${locale} ${view} ${width} footer stays at viewport bottom`);
        assert.ok(frame.contentBottom<=frame.top+1&&frame.hostScrollWidth<=frame.hostWidth+1,`${locale} ${view} content fits above footer without clipping`);
        assert.equal(frame.pageY,0,'only content host scrolls');
        assert.ok(frame.controls.every(n=>n.hit&&n.top>=frame.top&&n.bottom<=height+1),'translated footer controls remain visible and clickable');
        if(footerBaseline)for(const side of ['top','bottom','left','right'])assert.ok(Math.abs(footerBaseline[side]-frame[side])<=1,`${locale} ${width} aligned footer across views`);else footerBaseline=frame;
        measurements.push({locale,view,height,...metric,footer:frame});
        assert.ok(metric.scrollWidth<=width+1,`${locale} ${view} ${width} horizontal overflow`);
        assert.ok(metric.buttons.every(button=>button.visible&&button.width>20),'navigation usable');
        assert.equal(metric.quickActions.length,0,'old global save shortcuts are removed; selection owns save actions');
        if(view==='tabs'&&width===1366)assert.ok(metric.cardTop<=200,`tab card stays on the first screen: ${locale} ${JSON.stringify(metric)}`);
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    // Restore the starting view before checking the next language's preservation.
    await click('#dashboardNavMemory');
    await click('#settingsOpenBtn');
    console.log(`PASS ${locale}: real keyboard selection; complete active surfaces, drafts/data preserved; aligned viewport footer in 3 views × 3 widths`);
  }
  // Simulate a write failure at the real UI boundary, then restore storage and retry.
  await evaluate(`(() => {
    globalThis.__originalLanguageSet=chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set=value=>Object.hasOwn(value,'interfaceLanguageV1')?Promise.reject(new Error('Synthetic language write failure')):__originalLanguageSet(value);
  })()`);
  await fill('#settingsLanguageSelect','zh-CN');
  await waitFor('!document.querySelector("#settingsLanguageSelect").disabled && document.querySelector("#settingsLanguageStatus").classList.contains("is-error")','save failure shown to user');
  assert.equal(await evaluate('TabOutI18n.preference'),'ja');
  assert.equal(await evaluate('document.querySelector("#settingsLanguageSelect").value'),'ja');
  assert.equal(await evaluate('document.querySelector("#settingsLanguageStatus").textContent'),await evaluate('t("settings.languageFailed")'));
  assert.equal(await evaluate('chrome.storage.local.get("interfaceLanguageV1").then(s=>s.interfaceLanguageV1)'),'ja');
  await evaluate('chrome.storage.local.set=__originalLanguageSet');
  await chooseWithKeyboard(2,'zh-CN');
  await chooseWithKeyboard(4,'ja');
  console.log('PASS memory/history/group/project dates and accessible result names in all languages; failed save rolls back and retry works');
  // Saving updates future documents, not only the controller in the current tab.
  second=await connectPage(process.env.TAB_OUT_CDP_ORIGIN,extensionURL);
  await second.waitFor(ready,'new document uses stored language');
  assert.equal(await second.evaluate('TabOutI18n.locale'),'ja');
  assert.equal(await second.evaluate('document.documentElement.lang'),'ja');
  assert.equal(await second.evaluate('tabOutDashboardNavigation.currentView'),'tabs');
  const secondTabId=await second.evaluate('chrome.tabs.getCurrent().then(t=>t.id)');
  await evaluate(`chrome.tabs.remove(${secondTabId})`);
  second.close(); second=null;
  await page.send('Page.bringToFront');
  await send('Page.reload');
  await waitFor(ready,'reload reads language before first render');
  assert.equal(await evaluate('TabOutI18n.locale'),'ja');
  assert.equal(await evaluate('tabOutDashboardNavigation.currentView'),'tabs');
  await click('#settingsOpenBtn');
  await chooseWithKeyboard(0,'en');
  assert.equal(await evaluate('TabOutI18n.preference'),'auto');
  const userAgent=await evaluate('navigator.userAgent');
  await send('Network.setUserAgentOverride',{userAgent,acceptLanguage:'zh-HK,en'});
  await send('Page.reload');
  await waitFor(ready,'auto uses actual browser preference');
  assert.equal(await evaluate('TabOutI18n.locale'),'zh-TW');
  console.log('PASS new-tab persistence, reload defaults to Tabs, auto selects Traditional Chinese from zh-HK');

  // Previously initialized platform and project editors must relocalize without losing drafts.
  await evaluate('TabOutCore.openSearchPlatformSettings()');
  await waitFor('!document.querySelector("#searchPlatformSettingsOverlay").hidden','platform settings opens');
  await click('#searchPlatformSettingsOverlay .sps-primary');
  await fill('#searchPlatformSettingsOverlay input[name=name]','Unsaved platform 原始名稱');
  await fill('#searchPlatformSettingsOverlay textarea[name=aliases]','draft,未儲存');
  await evaluate('TabOutI18n.setLanguage("ja")');
  assert.equal(await evaluate('document.querySelector("#spsTitle").textContent'),await evaluate('t("platform.title")'));
  assert.equal(await evaluate('document.querySelector("#searchPlatformSettingsOverlay input[name=name]").value'),'Unsaved platform 原始名稱');
  assert.equal(await evaluate('document.querySelector("#searchPlatformSettingsOverlay textarea[name=aliases]").value'),'draft,未儲存');
  await key('Escape');
  await click('#dashboardNavProjects');
  await click('#projectSaveBtn');
  await waitFor('document.querySelector("#projectNameInput").getClientRects().length','project editor');
  await fill('#projectNameInput','Unsaved project 原始名稱');
  await evaluate('TabOutI18n.setLanguage("zh-CN")');
  assert.equal(await evaluate('document.querySelector("#projectNameInput").value'),'Unsaved project 原始名稱');
  await key('Escape');
  console.log('PASS open platform and project editor drafts retained during interface changes');

  await evaluate('globalThis.__originalExportConfig=exportConfig; exportConfig=async()=>{throw new Error("Synthetic export failure");}');
  await click('#projectBackupBtn');
  await waitFor('document.querySelector("#projectMainStatus").textContent===t("project.backupFailed")','backup failure visible');
  await evaluate('TabOutI18n.setLanguage("ja")');
  assert.equal(await evaluate('document.querySelector("#projectMainStatus").textContent'),await evaluate('t("project.backupFailed")'));
  await evaluate('exportConfig=__originalExportConfig');
  await click('#settingsOpenBtn');
  await click('#settingsUpgradeBtn');
  await waitFor('getComputedStyle(document.querySelector("#upgradeOverlay")).display!=="none"','license status visible');
  await evaluate('TabOutI18n.setLanguage("zh-TW")');
  assert.equal(await evaluate('document.querySelector("#upgradeStatus").textContent'),await evaluate('t("upgrade.freeStatus")'));
  await key('Escape');
  console.log('PASS previously displayed project failure and license status relocalize without repeating their actions');

  assert.deepEqual(exceptions,[],'no uncaught page errors');
  await writeFile(join(directory,'measurements.json'),JSON.stringify({measurements,checks:'All assertions passed',exceptions},null,2));
} catch(error) {
  await page?.screenshot('failure').catch(()=>{});
  throw error;
} finally {
  second?.close();page?.close();
  server.closeAllConnections();
  await new Promise(done=>server.close(done));
}
