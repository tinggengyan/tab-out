#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN;
const extensionId = process.env.TAB_OUT_EXTENSION_ID;
const directory = process.env.TAB_OUT_E2E_SCREENSHOT_DIR;
const servers = [];
let page;
const measurements = [];
const deferredFailures = [];

async function main() {
  const urls = [];
  for (let i = 0; i < 6; i++) {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<title>Research ${i + 1} ${request.url}</title><main>Disposable local layout fixture</main>`);
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    servers.push(server);
    // Distinct *.localhost names stay on loopback while producing real domain cards.
    for (const host of [`reading-${i}.localhost`, `notes-${i}.localhost`]) for (const path of ['article', 'notes']) urls.push(`http://${host}:${server.address().port}/${path}`);
  }
  urls[0] += '?context=' + 'continuous-long-url-without-spaces-'.repeat(22);
  page = await connectPage(origin, `chrome-extension://${extensionId}/index.html`);
  const { evaluate, waitFor, click, fill, screenshot } = page;
  const command = (action, payload = {}) => evaluate(`(async()=>{
    const r=await chrome.runtime.sendMessage({type:'browsing-memory',action:${JSON.stringify(action)},payload:${JSON.stringify(payload)}});
    if(!r?.ok) throw new Error(r?.error?.code || 'bridge failed');return r.data;
  })()`);
  await waitFor('typeof renderDashboard === "function" && globalThis.tabOutBrowsingMemory', 'dashboard initialization');
  await waitFor('chrome.storage.local.get("storageMeta").then(s=>s.storageMeta?.schemaVersion>=2)', 'fresh profile migration completed before seeding existing assets');
  await waitFor('globalThis.tabOutDashboardNavigation && document.querySelector("#dashboardContent") && document.querySelector("#dashboardFooter")','viewport shell initialized');
  await waitFor('document.querySelector("#onboardingStartBtn").textContent && getComputedStyle(document.querySelector("#onboardingOverlay")).display!=="none"','fresh-profile onboarding ready');
  await click('#onboardingStartBtn');
  await waitFor('getComputedStyle(document.querySelector("#onboardingOverlay")).display==="none"','onboarding dismissed before testing uncovered footer');
  async function shellGeometry() {
    return evaluate(`(() => {
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      const host=document.querySelector('#dashboardContent');
      return {header:rect('#dashboardNavigation'),footer:rect('#dashboardFooter'),content:rect('#dashboardContent'),height:innerHeight,width:innerWidth,
        pageY:window.scrollY,documentHeight:document.documentElement.scrollHeight,scrollTop:host.scrollTop,
        hostWidth:host.clientWidth,hostScrollWidth:host.scrollWidth,hostHeight:host.clientHeight,hostScrollHeight:host.scrollHeight,
        controls:[...document.querySelectorAll('#dashboardFooter a,#dashboardFooter button')].map(n=>{const r=n.getBoundingClientRect();return {id:n.id||n.tagName,top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};
    })()`);
  }
  function assertPinnedShell(value,label) {
    assert.ok(Math.abs(value.footer.bottom-value.height)<=1,`${label}: footer must end at viewport bottom`);
    assert.ok(value.content.bottom<=value.footer.top+1,`${label}: content does not overlap footer`);
    assert.ok(value.header.bottom<=value.content.top+1,`${label}: content does not overlap header`);
    assert.equal(value.pageY,0,`${label}: document must not scroll`);
    assert.ok(value.documentHeight<=value.height+1,`${label}: no offscreen document content`);
    assert.ok(value.hostScrollWidth<=value.hostWidth+1,`${label}: content must not clip horizontal overflow`);
    assert.ok(value.controls.every(n=>n.hit&&n.top>=value.footer.top&&n.bottom<=value.height+1&&n.left>=0&&n.right<=value.width+1),`${label}: all footer entrances visible and hit-testable`);
  }
  function assertSameRect(left,right,label) {
    for(const side of ['top','bottom','left','right'])assert.ok(Math.abs(left[side]-right[side])<=1,`${label}: ${side} must stay aligned`);
  }
  const emptyFooter=[];
  for(const name of ['tabs','projects','memory']) {
    await evaluate(`tabOutDashboardNavigation.show(${JSON.stringify(name)})`);
    const value=await shellGeometry();assertPinnedShell(value,`initial ${name}`);emptyFooter.push(value.footer);
  }
  for(const rect of emptyFooter)assertSameRect(rect,emptyFooter[0],'empty/short views share footer coordinates');
  await evaluate('tabOutDashboardNavigation.show("tabs")');
  console.log('PASS empty/short views use the same viewport-bottom footer without document scroll');
  const savedAt = new Date().toISOString();
  const deferred = Array.from({ length: 8 }, (_, i) => ({ id: `layout-deferred-${i}`, title: `Read later ${i + 1}`, url: urls[i], savedAt, completed: false, dismissed: false }));
  const groups = Array.from({ length: 18 }, (_, i) => ({ id: `layout-group-${i}`, savedAt, tabs: [{ title: `Saved research ${i + 1}`, url: urls[i % urls.length] }] }));
  const longTitle = 'LongContinuousTitleWithoutSpaces超长连续标题'.repeat(24);
  deferred[0].title = longTitle;
  groups[0].tabs[0].title = longTitle;
  await evaluate(`chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false,deferred:${JSON.stringify(deferred)},tabGroups:${JSON.stringify(groups)}})`);
  await page.send('Page.reload');
  await waitFor('globalThis.tabOutBrowsingMemory && typeof workspaceRepository !== "undefined"', 'clean dashboard');
  await evaluate(`(async()=>{
    const current=await chrome.tabs.getCurrent();
    for(const url of ${JSON.stringify(urls)}) await chrome.tabs.create({url,windowId:current.windowId,active:false});
    for(let i=0;i<15;i++) await workspaceRepository.create({name:i===0?${JSON.stringify(longTitle)}:'Existing project '+(i+1),entries:[{url:${JSON.stringify(urls[0])},title:${JSON.stringify(longTitle)}}]});
    await renderDashboard();
  })()`);
  await waitFor('document.querySelectorAll("#openTabsMissions .mission-card").length>=6 && document.querySelectorAll("#projectList .project-card[data-project-id]").length===33', 'live cards and all 18 migrated plus 15 new projects');
  assert.equal(await evaluate('document.querySelector("#tabGroupsColumn") || document.querySelector("#savedCollections")'), null, 'saved batches have one home in Projects');
  await waitFor('document.querySelectorAll("#deferredList .deferred-item").length===8', 'existing read-later items rendered');

  async function viewport(width, height) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  const visible = selector => evaluate(`(() => {const n=document.querySelector(${JSON.stringify(selector)});return Boolean(n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');})()`);
  async function measureHome(label) {
    await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
    // The screenshot helper awaits finite entry animations; measure the same settled state.
    await screenshot(label);
    const result = await evaluate(`(() => {
      const rect=s=>{const n=document.querySelector(s);if(!n||!n.getClientRects().length)return null;const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,card:rect('#openTabsMissions .mission-card'),tab:rect('#openTabsMissions .page-chip'),saved:rect('#tabGroupsList .tab-group-card'),deferred:rect('#deferredList .deferred-item')};
    })()`);
    measurements.push({ label, ...result });
    assert.ok(result.card && result.card.top <= 200, `first card below primary screen: ${JSON.stringify(result)}`);
    assert.ok(result.tab && result.tab.bottom <= result.height, 'at least one actual tab is visible');
    assert.equal(result.saved, null, 'Tabs does not repeat the saved project library');
    assert.ok(result.deferred && result.deferred.bottom <= result.height, 'first read-later item is visible');
    assert.ok(result.scrollWidth <= result.width + 1, `home horizontal overflow: ${JSON.stringify(result)}`);
  }
  for (const [width, height] of [[1440, 900], [1366, 768]]) {
    await viewport(width, height);
    await measureHome(`01-home-${width}`);
  }
  assert.equal(await visible('#memoryWorkbench'), false);
  assert.equal(await visible('#projectWorkbench'), false);
  console.log('PASS first live card and read-later visible on desktop; saved batches live only in Projects');

  const beforeWheel=await shellGeometry();
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:beforeWheel.content.left+100,y:beforeWheel.content.top+120,deltaX:0,deltaY:480});
  await waitFor('document.querySelector("#dashboardContent").scrollTop>=300','real wheel scrolls independent content');
  const afterWheel=await shellGeometry();assertPinnedShell(afterWheel,'real wheel');
  assertSameRect(beforeWheel.header,afterWheel.header,'wheel keeps header fixed');
  assertSameRect(beforeWheel.footer,afterWheel.footer,'wheel keeps footer fixed');
  measurements.push({label:'real-wheel',before:beforeWheel,after:afterWheel});

  async function tapNav(name) {
    await page.send('Page.bringToFront');
    const selector = { tabs: '#dashboardNavTabs', projects: '#dashboardNavProjects', memory: '#dashboardNavMemory' }[name];
    const point = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()`);
    assert.ok(point.hit, `navigation must be visible without scrollIntoView: ${name}`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await waitFor(`tabOutDashboardNavigation.currentView===${JSON.stringify(name)}`, `${name} view active`);
    assert.equal(await evaluate('document.querySelectorAll("#dashboardNavTabs[aria-current=page],#dashboardNavProjects[aria-current=page],#dashboardNavMemory[aria-current=page]").length'), 1);
  }
  async function tapFooter(selector) {
    const point=await evaluate(`(() => {const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
    assert.ok(point.hit,`footer works without scrolling content: ${selector}`);
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  }
  const records = Array.from({ length: 30 }, (_, i) => ({ url: urls[i % urls.length] + `?memory=${i}`, title: `混合检索研究 ${i + 1}`, text: '混合检索结合词法匹配与语义理解，这是本地布局测试正文。'.repeat(8), visitedAt: Date.now(), capturedAt: Date.now(), source: 'import' }));
  records[0].title += longTitle;
  await command('import', { backup: { format: 'tab-out-memory', version: 1, exportedAt: savedAt, records }, preview: false });
  const before = await evaluate('chrome.storage.local.get(["deferred","tabGroups","workspacesV2","browsingMemorySettingsV1","browsingMemorySecretV1"])');
  const beforeMemory = (await command('export')).records;

  await evaluate('document.getElementById("dashboardContent").scrollTo(0,450)');
  const tabScroll = await evaluate('document.getElementById("dashboardContent").scrollTop');
  assert.ok(tabScroll >= 400, 'long fixture must really scroll');
  await tapNav('projects');
  await waitFor('document.querySelectorAll("#projectList .project-card[data-project-id]").length===33', 'all migrated and existing projects preserved');
  await screenshot('02-projects');
  await evaluate('document.getElementById("dashboardContent").scrollTo(0,430)');
  const projectScroll = await evaluate('document.getElementById("dashboardContent").scrollTop');
  assert.ok(projectScroll >= 400);
  await tapNav('tabs');
  assert.ok(Math.abs(await evaluate('document.getElementById("dashboardContent").scrollTop') - tabScroll) <= 2, 'tabs scroll restored');
  assert.equal(await evaluate('document.activeElement.id'), 'dashboardNavTabs');
  await tapNav('projects');
  assert.ok(Math.abs(await evaluate('document.getElementById("dashboardContent").scrollTop') - projectScroll) <= 2, 'projects scroll restored');

  await tapNav('memory');
  await click('#memoryRefreshBtn');
  await waitFor('tabOutBrowsingMemory.controller.state.stats.total===30', 'fixture imported records reflected in memory overview');
  await fill('#memoryQuery', '混合检索');
  await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length===30', 'local search results');
  await click('#memoryResults input[data-memory-id]');
  await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
  await screenshot('03-memory');
  await evaluate('document.getElementById("dashboardContent").scrollTo(0,460)');
  const memoryScroll = await evaluate('document.getElementById("dashboardContent").scrollTop');
  await tapNav('tabs');
  assert.ok(Math.abs(await evaluate('document.getElementById("dashboardContent").scrollTop') - tabScroll) <= 2);
  await tapNav('memory');
  assert.ok(Math.abs(await evaluate('document.getElementById("dashboardContent").scrollTop') - memoryScroll) <= 2, 'memory scroll restored');
  assert.equal(await evaluate('document.querySelector("#memoryQuery").value'), '混合检索');
  assert.equal(await evaluate('tabOutBrowsingMemory.controller.state.selected.size'), 1);
  assert.equal(await evaluate('tabOutBrowsingMemory.controller.state.results.length'), 30);
  assert.equal(await evaluate('document.querySelector("#memoryDays").value'), '30');
  console.log('PASS actual sticky navigation restores independent scroll positions, visible focus and query/result/selection state');

  // A language redraw uses the content scroll host rather than the immobile window.
  const language=await evaluate('TabOutI18n.preference');
  const languageBefore=await evaluate('document.querySelector("#dashboardContent").scrollTop');
  await evaluate('TabOutI18n.setLanguage(TabOutI18n.locale==="ja"?"zh-CN":"ja")');
  const languageAfter=await evaluate('document.querySelector("#dashboardContent").scrollTop');
  measurements.push({label:'language-content-scroll',before:languageBefore,after:languageAfter});
  assert.ok(Math.abs(languageAfter-languageBefore)<=2,`language change preserves content scroll: ${languageBefore} -> ${languageAfter}`);
  assert.equal(await evaluate('tabOutBrowsingMemory.controller.state.selected.size'),1);
  assert.equal(await evaluate('document.querySelector("#memoryQuery").value'),'混合检索');
  await evaluate(`TabOutI18n.setLanguage(${JSON.stringify(language)})`);

  const refreshURL = urls[1] + '?background-refresh';
  const beforeRefresh = await evaluate('({view:tabOutDashboardNavigation.currentView,y:document.getElementById("dashboardContent").scrollTop,focus:document.activeElement.id})');
  const backgroundTab = await evaluate(`chrome.tabs.create({url:${JSON.stringify(refreshURL)},active:false}).then(t=>t.id)`);
  await waitFor(`Array.from(document.querySelectorAll('#openTabsMissions [data-tab-url]')).some(n=>n.dataset.tabUrl===${JSON.stringify(refreshURL)})`, 'actual background tab creation redraws hidden tab cards');
  await evaluate(`chrome.tabs.remove(${backgroundTab})`);
  await waitFor(`!Array.from(document.querySelectorAll('#openTabsMissions [data-tab-url]')).some(n=>n.dataset.tabUrl===${JSON.stringify(refreshURL)})`, 'actual background tab closure redraws hidden tab cards');
  const afterRefresh = await evaluate('({view:tabOutDashboardNavigation.currentView,y:document.getElementById("dashboardContent").scrollTop,focus:document.activeElement.id})');
  assert.equal(afterRefresh.view, beforeRefresh.view);
  assert.equal(afterRefresh.focus, beforeRefresh.focus);
  assert.ok(Math.abs(afterRefresh.y - beforeRefresh.y) <= 2);
  measurements.push({label:'background-tab-refresh',before:beforeRefresh,after:afterRefresh});
  console.log('PASS actual background tab creation/closure redraw preserves active view, scroll and visible navigation focus');

  await click('#memoryDeleteBtn');
  await waitFor('document.querySelector("#memoryConfirmDialog").open', 'memory confirmation opens in its view');
  assert.equal(await evaluate('document.activeElement.id'), 'memoryConfirmNo', 'confirmation starts on the safe cancel action');
  await key('Tab', 8);
  assert.equal(await evaluate('document.activeElement.id'), 'memoryConfirmYes', 'Shift+Tab stays within the native confirmation');
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.id'), 'memoryConfirmNo', 'Tab wraps within the native confirmation');
  await key('Escape');
  await waitFor('!document.querySelector("#memoryConfirmDialog").open', 'Escape cancels just the confirmation');
  assert.equal(await evaluate('tabOutDashboardNavigation.currentView'), 'memory');
  assert.equal(await evaluate('document.activeElement.id'), 'memoryDeleteBtn');
  assert.equal(await evaluate('tabOutBrowsingMemory.controller.state.selected.size'), 1, 'cancellation does not delete selection');
  console.log('PASS memory confirmation traps keyboard focus and Escape returns to the same visible view');

  // Complete a search after its view has been hidden; it may update data but cannot steal the home screen or focus.
  await evaluate(`(() => {
    const original=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=(message,...rest)=>message?.type==='browsing-memory'&&message.action==='search'
      ? new Promise(resolve=>setTimeout(()=>resolve(original(message,...rest)),350)) : original(message,...rest);
  })()`);
  await fill('#memoryQuery', '词法'); await click('#memorySearchBtn'); await tapNav('tabs');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching', 'hidden search complete');
  assert.equal(await evaluate('tabOutDashboardNavigation.currentView'), 'tabs');
  assert.equal(await evaluate('document.activeElement.id'), 'dashboardNavTabs');
  assert.ok(Math.abs(await evaluate('document.getElementById("dashboardContent").scrollTop') - tabScroll) <= 2);

  async function key(key, modifiers = 0) {
    const code = key === 'k' ? 'KeyK' : key;
    const windowsVirtualKeyCode = { k: 75, Escape: 27, Tab: 9, PageDown:34 }[key];
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  }
  for (const name of ['tabs', 'projects', 'memory']) {
    await tapNav(name);
    await key('k', 2); // Ctrl+K also works on macOS in the extension handler.
    await waitFor('getComputedStyle(document.querySelector("#commandOverlay")).display!=="none"', 'command search opens');
    const controls = await evaluate('Array.from(document.querySelectorAll("#commandOverlay button:not([disabled]),#commandOverlay input:not([disabled]),#commandOverlay select:not([disabled])")).filter(n=>n.getClientRects().length).map(n=>n.id).filter(Boolean)');
    await evaluate(`document.getElementById(${JSON.stringify(controls.at(-1))}).focus({preventScroll:true})`);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.id'), controls[0], `${name} command Tab stays inside`);
    await key('Tab',8);
    assert.equal(await evaluate('document.activeElement.id'), controls.at(-1), `${name} command Shift+Tab stays inside`);
    await key('Escape');
    await waitFor('getComputedStyle(document.querySelector("#commandOverlay")).display==="none"', 'command search closes');
    assert.equal(await evaluate('tabOutDashboardNavigation.currentView'), name);
    const focus = await evaluate('({id:document.activeElement.id,tag:document.activeElement.tagName,visible:Boolean(document.activeElement.getClientRects().length)})');
    if (!focus.visible) {
      deferredFailures.push(`command return focus is hidden in ${name}: ${JSON.stringify(focus)}`);
      console.error('FAIL ' + deferredFailures.at(-1));
    }
    await tapFooter('#settingsOpenBtn');
    await waitFor('getComputedStyle(document.querySelector("#settingsOverlay")).display!=="none"', `${name} global footer settings opens`);
    assert.equal(await evaluate('(() => {const n=document.querySelector("#searchOpenBtn"),r=n.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("#dashboardFooter");})()'),false,'modal backdrop blocks footer controls');
    await key('Escape');
    await waitFor('getComputedStyle(document.querySelector("#settingsOverlay")).display==="none"', `${name} footer settings closes`);
    assert.equal(await evaluate('tabOutDashboardNavigation.currentView'),name);
    assert.equal(await evaluate('document.activeElement.id'),'settingsOpenBtn');
  }
  console.log('PASS hidden asynchronous search leaves home unchanged; command search works in every view');

  await tapNav('projects');
  await evaluate('document.querySelector("#dashboardContent").scrollTo(0,0);document.querySelector("#dashboardContent").focus({preventScroll:true})');
  await key('PageDown');
  await waitFor('document.querySelector("#dashboardContent").scrollTop>100','keyboard PageDown scrolls focused content');
  const keyboardShell=await shellGeometry();assertPinnedShell(keyboardShell,'keyboard PageDown');
  for(const name of ['tabs','projects','memory']) {
    await tapNav(name);
    if(name==='memory'&&!await evaluate('document.querySelector("#memorySettings").open'))await click('#memorySettingsToggle');
    if(name==='projects')for(const selector of ['#savedLater','#savedArchive']) {
      if(await evaluate(`(() => {const n=document.querySelector(${JSON.stringify(selector)});return n&&!n.hidden&&!n.open})()`))await click(selector+' > summary');
    }
    const target={tabs:'#deferredList .deferred-item:last-child .deferred-dismiss',projects:'#projectBackupBtn',memory:'#memoryClearBtn'}[name];
    await evaluate('document.querySelector("#dashboardContent").scrollTop=document.querySelector("#dashboardContent").scrollHeight');
    const end=await shellGeometry();assertPinnedShell(end,`${name} end`);
    // Parallel columns can end at different heights: verify the visually last control
    // at content end, then separately let keyboard focus reveal the final DOM control.
    const bottomControl=await evaluate(`(() => {const host=document.querySelector('#dashboardContent'),r=host.getBoundingClientRect();const controls=[...host.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),summary,a[href]')].filter(n=>n.getClientRects().length);const n=controls.sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0],q=n.getBoundingClientRect();return {id:n.id,top:q.top,bottom:q.bottom,hostTop:r.top,hostBottom:r.bottom,hit:n.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))};})()`);
    assert.ok(bottomControl.hit&&bottomControl.top>=bottomControl.hostTop&&bottomControl.bottom<=bottomControl.hostBottom+1,`${name} visually final content control is reachable: ${JSON.stringify(bottomControl)}`);
    const last=await evaluate(`(() => {const n=document.querySelector(${JSON.stringify(target)});n.focus();const r=n.getBoundingClientRect(),host=document.querySelector('#dashboardContent').getBoundingClientRect();return {top:r.top,bottom:r.bottom,hostTop:host.top,hostBottom:host.bottom,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
    assert.ok(last.hit&&last.top>=last.hostTop&&last.bottom<=last.hostBottom+1,`${name} final DOM control is keyboard reachable: ${JSON.stringify(last)}`);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.closest("#dashboardFooter")?.id'),'dashboardFooter',`${name} keyboard proceeds to footer`);
    measurements.push({label:`${name}-end`,...end,bottomControl,last});
  }
  console.log('PASS keyboard content scrolling and final controls remain reachable above footer; Tab reaches shared footer');

  for (const name of ['projects', 'memory']) {
    await tapNav(name); await page.send('Page.reload');
    await waitFor('globalThis.tabOutDashboardNavigation?.currentView==="tabs" && globalThis.tabOutBrowsingMemory', 'reload returns to tabs');
    assert.equal(await visible('#memoryWorkbench'), false); assert.equal(await visible('#projectWorkbench'), false);
  }
  const after = await evaluate('chrome.storage.local.get(["deferred","tabGroups","workspacesV2","browsingMemorySettingsV1","browsingMemorySecretV1"])');
  assert.deepEqual(after, before, 'navigation/reload does not alter saved business assets or settings');
  assert.deepEqual((await command('export')).records, beforeMemory, 'captured text unchanged');
  console.log('PASS reload always opens tabs and preserves existing collections, projects, memory bodies and settings');

  // Reload resets ephemeral query UI; repopulate it so the responsive matrix measures real long results.
  await tapNav('memory');
  await fill('#memoryQuery', '混合检索'); await click('#memorySearchBtn');
  await waitFor('!tabOutBrowsingMemory.controller.state.searching && tabOutBrowsingMemory.controller.state.results.length===30 && Array.from(document.querySelectorAll("#memoryResults .memory-result-title")).some(n=>n.textContent.includes("LongContinuousTitleWithoutSpaces"))', 'long memory result actually rendered before responsive measurement');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#memoryResults .memory-result-title")).some(n=>n.href.length>500)'), 'long original URL actually rendered');
  await tapNav('tabs');

  // Historical group payloads cannot recreate a second library on Tabs.
  for (const variant of ['groups-only', 'deferred-only', 'both']) {
    await evaluate(`chrome.storage.local.set({tabGroups:${JSON.stringify(variant === 'deferred-only' ? [] : groups)},deferred:${JSON.stringify(variant === 'groups-only' ? [] : deferred)}}).then(()=>renderDashboard())`);
    assert.equal(await evaluate('document.querySelector("#tabGroupsColumn") || document.querySelector("#savedCollections")'), null, `${variant}: no duplicate batch library`);
    for (const [width, height] of [[1440,900],[1366,768]]) {
      await viewport(width,height); await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), `${variant} ${width} overflow`);
    }
  }
  for (const [width, height] of [[1440,900],[1366,768],[390,844]]) {
    await viewport(width,height);
    let footerRect;
    for (const name of ['tabs','projects','memory']) {
      await tapNav(name); await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), `${name} ${width} overflow`);
      assert.ok(await visible('footer'), 'footer exists in every view');
      const start=await shellGeometry();assertPinnedShell(start,`${name} ${width} start`);
      if(footerRect)assertSameRect(footerRect,start.footer,`${width} views share aligned footer`);else footerRect=start.footer;
      await evaluate('document.querySelector("#dashboardContent").scrollTop=document.querySelector("#dashboardContent").scrollHeight/2');
      const middle=await shellGeometry();assertPinnedShell(middle,`${name} ${width} middle`);assertSameRect(start.footer,middle.footer,'footer stays fixed while scrolling');
      await evaluate('document.querySelector("#dashboardContent").scrollTop=document.querySelector("#dashboardContent").scrollHeight');
      const end=await shellGeometry();assertPinnedShell(end,`${name} ${width} end`);assertSameRect(start.footer,end.footer,'footer stays fixed at content end');
      measurements.push({label:`footer-${name}-${width}`,start,middle,end});
      await evaluate('document.querySelector("#dashboardContent").scrollTo(0,0)');
      await screenshot(`04-${name}-${width}`);
    }
  }
  // Duplicate dashboard notice still leaves the first real card in the initial screen.
  await viewport(1366,768); await tapNav('tabs');
  const duplicate = await evaluate(`chrome.tabs.create({url:chrome.runtime.getURL('index.html'),active:false}).then(t=>t.id)`);
  await waitFor('getComputedStyle(document.querySelector("#tabOutDupeBanner")).display!=="none"', 'duplicate dashboard notice');
  for (const [width,height] of [[1440,900],[1366,768]]) {
    await viewport(width,height);await evaluate('document.getElementById("dashboardContent").scrollTo(0,0)');
    await screenshot(`05-home-duplicate-banner-${width}`);
    const duplicateTop = await evaluate('document.querySelector("#openTabsMissions .mission-card").getBoundingClientRect().top');
    assert.ok(duplicateTop <= 280, `duplicate banner pushes first card down at ${width}: ${duplicateTop}`);
    measurements.push({label:`duplicate-banner-${width}`,cardTop:duplicateTop});
  }
  await evaluate(`chrome.tabs.remove(${duplicate})`);
  console.log('PASS both desktop collection combinations, all three views at 390px, and duplicate-dashboard notice');
  console.log('PASS continuous long titles and URLs, real footer settings actions and command Tab/Shift+Tab in every view');
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'measurements.json'),JSON.stringify({locale:process.env.TAB_OUT_TEST_LOCALE || 'en',measurements},null,2));
  assert.deepEqual(deferredFailures, [], 'all keyboard focus checks must pass');
}

try { await main(); }
catch (error) { if (page) await page.screenshot('failure').catch(() => {}); throw error; }
finally {
  page?.close();
  for (const server of servers) {server.closeAllConnections();await new Promise(done=>server.close(done));}
}
