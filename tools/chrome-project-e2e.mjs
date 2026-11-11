#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connectPage } from './chrome-test-client.mjs';

const origin = process.env.TAB_OUT_CDP_ORIGIN || 'http://127.0.0.1:9333';
const extensionId = process.env.TAB_OUT_EXTENSION_ID || 'gbbakbpcbbcilmggnkcahkemicknngbo';
let page;
const fixture = createServer((request, response) => {
  const titles = { '/atlas-api': 'Atlas · API reference', '/atlas-design': 'Atlas · Design review', '/atlas-plan': 'Atlas · Delivery plan', '/beacon-notes': 'Beacon · Research notes',
    '/beacon-runbook': 'Beacon · Release runbook', '/shared': 'Shared · Product documentation', '/other-project': 'Orion · Unrelated project',
    '/pinned': 'Inbox · Keep pinned', '/other-window': 'Another window · Keep open' };
  const title = titles[request.url] || 'Project test page';
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><title>${title}</title><main><h1>${title}</h1><p>Disposable Tab Out project fixture.</p></main>`);
});

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const port = fixture.address().port;
  const base = `http://127.0.0.1:${port}`;
  const urls = { atlasApi: `${base}/atlas-api`, atlasDesign: `http://localhost:${port}/atlas-design`, beaconNotes: `${base}/beacon-notes`,
    atlasPlan: `${base}/atlas-plan`, beaconRunbook: `http://localhost:${port}/beacon-runbook`, shared: `${base}/shared`, other: `${base}/other-project`, pinned: `${base}/pinned`, otherWindow: `${base}/other-window` };
  const acceptanceFailures = [];
  function check(description, actual, expected) {
    try { assert.deepEqual(actual, expected, description); }
    catch (error) { acceptanceFailures.push(error); console.error('FAIL ' + description + ': ' + JSON.stringify({actual, expected})); }
  }
  page = await connectPage(origin, `chrome-extension://${extensionId}/index.html`);
  const { evaluate, waitFor, click, fill, screenshot } = page;
  page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));
  await waitFor("document.readyState === 'complete' && document.getElementById('projectSaveBtn')", 'project workbench load');
  await evaluate(`(async () => { await chrome.storage.local.clear(); await chrome.storage.local.set({onboardingV1:true,automaticSnapshotsEnabledV1:false}); location.reload(); })()`);
  await waitFor("document.readyState === 'complete' && document.getElementById('projectSaveBtn')", 'clean workbench load');
  await click('#dashboardNavProjects');
  await screenshot('01-empty-workbench');
  const tabs = await evaluate(`(async () => {
    const current = await chrome.tabs.getCurrent();
    const urls = ${JSON.stringify(urls)};
    const result = {windowId:current.windowId};
    for (const key of ['pinned','atlasApi','atlasDesign','atlasPlan','beaconNotes','beaconRunbook','shared','other']) {
      result[key] = await chrome.tabs.create({windowId:current.windowId,url:urls[key],active:false,pinned:key==='pinned'});
    }
    const groupId = await chrome.tabs.group({tabIds:[result.atlasApi.id,result.atlasDesign.id,result.atlasPlan.id]});
    await chrome.tabGroups.update(groupId,{title:'Atlas research',color:'green',collapsed:false});
    const other = await chrome.windows.create({url:urls.otherWindow,focused:false});
    result.otherWindowTab = other.tabs[0];
    return result;
  })()`);
  await waitFor(`chrome.tabs.query({}).then(tabs=>Object.values(${JSON.stringify(urls)}).every(url=>tabs.some(tab=>tab.url===url)))`, 'fixture navigation');
  const partialGroup = await evaluate(`(async()=>{
    const before=(await chrome.tabs.query({windowId:${tabs.windowId}})).sort((a,b)=>a.index-b.index).map(tab=>tab.url);
    const operation=await operationService.close([${tabs.atlasApi.id},${tabs.atlasPlan.id}],{source:'partial-native-group-test'});
    await Promise.all([operationService.undo(operation.id),operationService.undo(operation.id)]);
    const current=(await chrome.tabs.query({windowId:${tabs.windowId}})).sort((a,b)=>a.index-b.index);
    return {before,after:current.map(tab=>tab.url),groupIds:current.filter(tab=>[${JSON.stringify(urls.atlasApi)},${JSON.stringify(urls.atlasDesign)},${JSON.stringify(urls.atlasPlan)}].includes(tab.url)).map(tab=>tab.groupId),tabs:current};
  })()`);
  check('partial native-group Undo preserves original positions', partialGroup.after, partialGroup.before);
  check('partial native-group Undo rejoins the surviving native group', [...new Set(partialGroup.groupIds)].length, 1);
  if (!acceptanceFailures.length) console.log('PASS concurrent Undo runs once; partial native-group Undo preserves window order and surviving group');
  for (const name of ['atlasApi','atlasDesign','atlasPlan']) tabs[name]=partialGroup.tabs.find(tab=>tab.url===urls[name]);
  const visible = selector => `(() => {const node=document.querySelector(${JSON.stringify(selector)});return node&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().height>0;})()`;
  const projects = () => evaluate("workspaceRepository.list()");
  const selectedIds = () => evaluate("Array.from(document.querySelectorAll('#projectCandidates input[data-tab-id]:checked')).map(node=>Number(node.dataset.tabId)).sort((a,b)=>a-b)");
  await click('#projectSaveBtn');
  await waitFor(visible('#projectNameInput'), 'keyboard-accessible save form');
  assert.equal(await evaluate("document.getElementById('projectDialogOverlay').contains(document.activeElement)"), true, 'dialog should receive keyboard focus');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await waitFor("getComputedStyle(document.getElementById('projectDialogOverlay')).display==='none'", 'Escape cancels preview');
  assert.equal((await projects()).length, 0, 'cancel must not save a project');
  async function finishDialog() {
    if (await evaluate(visible('#projectDoneBtn'))) {
      await waitFor("!document.getElementById('projectDoneBtn').disabled", 'result actions ready');
      await waitFor("document.getElementById('projectDialogOverlay').contains(document.activeElement)&&document.activeElement.offsetParent!==null", 'result keyboard focus', 4000);
      const focused = await evaluate("document.getElementById('projectDialogOverlay').contains(document.activeElement)&&document.activeElement.offsetParent!==null");
      check('result receives visible keyboard focus', focused, true);
      const controls = await evaluate("Array.from(document.querySelectorAll('#projectDialogOverlay button:not([disabled]),#projectDialogOverlay input:not([disabled]),#projectDialogOverlay select:not([disabled])')).filter(node=>node.offsetParent!==null).map(node=>node.id)");
      await evaluate(`document.getElementById(${JSON.stringify(controls.at(-1))}).focus()`);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
      check('result Tab wraps within the dialog', await evaluate('document.activeElement.id'), controls[0]);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers:8});
      check('result Shift+Tab wraps within the dialog', await evaluate('document.activeElement.id'), controls.at(-1));
      await click('#projectDoneBtn');
    }
    else if (await evaluate(visible('#projectCancelBtn'))) await click('#projectCancelBtn');
    await waitFor("getComputedStyle(document.getElementById('projectDialogOverlay')).display==='none'", 'project dialog closes');
    check('closing restores focus to a visible control', await evaluate("['BUTTON','SUMMARY'].includes(document.activeElement.tagName)&&document.activeElement.getClientRects().length>0&&!document.activeElement.closest('[hidden]')"), true);
  }
  async function saveProject(name, ids) {
    await click('#projectSaveBtn');
    await waitFor(visible('#projectNameInput'), 'save form');
    assert.deepEqual(await selectedIds(), [], 'mixed-window creation must start with no implicit selection');
    await fill('#projectNameInput', name);
    for (const id of ids) await click(`#projectCandidates input[data-tab-id="${id}"]`);
    assert.deepEqual(await selectedIds(), [...ids].sort((a,b)=>a-b));
    await screenshot(name === 'Atlas' ? '02-selected-project-preview' : '03-second-project-preview');
    await click('#projectSaveOnlyBtn');
    await waitFor(`workspaceRepository.list().then(items=>items.some(item=>item.name===${JSON.stringify(name)}))`, 'project saved');
    await finishDialog();
    return (await projects()).find(item => item.name === name);
  }
  const atlasIds = [tabs.atlasApi.id, tabs.atlasDesign.id, tabs.atlasPlan.id, tabs.shared.id, tabs.pinned.id];
  const atlas = await saveProject('Atlas', atlasIds);
  const beacon = await saveProject('Beacon', [tabs.beaconNotes.id, tabs.beaconRunbook.id, tabs.shared.id]);
  assert.equal((await projects()).length, 2);
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.other.id}).then(tab=>tab.url)`), urls.other);
  await screenshot('04-saved-projects');
  console.log('PASS explicit cross-domain selection and save without closing mixed-window tabs');

  // Put-away is now an explicit option inside the selected project's preview.
  await click(`[data-project-action="replace"][data-project-id="${atlas.id}"]`);
  await waitFor(visible('#projectSourceSelect'), 'park form ready');
  await fill('#projectSourceSelect', atlas.id);
  await waitFor(`tabOutProjectWorkbench.controller.state.sourceWorkspaceId===${JSON.stringify(atlas.id)} && !tabOutProjectWorkbench.controller.state.previewBusy && document.querySelectorAll('#projectCandidates input[data-tab-id]:checked').length===${atlasIds.length}`, 'source change replaces the current-window shortcut selection with saved project members');
  assert.deepEqual(await selectedIds(), [...atlasIds].sort((a,b)=>a-b), 'only saved Atlas members should be selected');
  await screenshot('05-park-preview');
  await click('#projectExecuteBtn');
  await waitFor(`chrome.tabs.query({}).then(items=>!items.some(tab=>tab.id===${tabs.atlasApi.id}))`, 'Atlas parked');
  await waitFor(visible('#projectUndoBtn'), 'park undo result');
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.pinned.id}).then(tab=>tab.pinned)`), true);
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.other.id}).then(tab=>tab.url)`), urls.other);
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.otherWindowTab.id}).then(tab=>tab.url)`), urls.otherWindow);
  await click('#projectUndoBtn');
  await waitFor(`chrome.tabs.query({}).then(items=>[${JSON.stringify(urls.atlasApi)},${JSON.stringify(urls.atlasDesign)},${JSON.stringify(urls.shared)}].every(url=>items.some(tab=>tab.url===url&&tab.windowId===${tabs.windowId})))`, 'Undo restores original source window');
  const group = await evaluate(`(async()=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===${JSON.stringify(urls.atlasApi)});return chrome.tabGroups.get(tab.groupId)})()`);
  assert.equal(group.title, 'Atlas research');
  assert.equal(group.color, 'green');
  await finishDialog();
  console.log('PASS park protects unrelated/pinned tabs; Undo restores original window and native groups');

  const beforeResume = await evaluate("chrome.tabs.query({}).then(tabs=>tabs.length)");
  await click(`[data-project-action="resume"][data-project-id="${atlas.id}"]`);
  await waitFor(visible('#projectExecuteBtn'), 'resume preview');
  await evaluate(`window.__originalProjectPreview=projectService.previewResume.bind(projectService);projectService.previewResume=async options=>{
    if(options.mode==='merge-current')await new Promise(resolve=>{window.__releaseProjectPreview=resolve});
    return window.__originalProjectPreview(options);
  }`);
  await fill('#projectRestoreMode', 'merge-current');
  await waitFor('Boolean(window.__releaseProjectPreview)', 'delayed restore-mode preview starts');
  assert.equal(await evaluate("document.getElementById('projectExecuteBtn').disabled"), true, 'submit must wait for the chosen restore mode');
  await evaluate('window.__releaseProjectPreview();projectService.previewResume=window.__originalProjectPreview');
  await waitFor("globalThis.tabOutProjectWorkbench.controller.state.targetPreview.mode==='merge-current'&&!globalThis.tabOutProjectWorkbench.controller.state.previewBusy", 'selected restore mode is ready');
  await click('#projectExecuteBtn');
  await waitFor(visible('#projectDoneBtn'), 'resume result');
  assert.equal(await evaluate("chrome.tabs.query({}).then(tabs=>tabs.length)"), beforeResume, 'resume must reuse existing tabs');
  await finishDialog();
  console.log('PASS repeat resume does not duplicate pages or move existing tabs');

  await evaluate(`chrome.tabs.remove([${tabs.beaconNotes.id},${tabs.beaconRunbook.id}])`);
  const sourceTabs = await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>[${JSON.stringify(urls.atlasApi)},${JSON.stringify(urls.atlasDesign)}].includes(tab.url)))`);
  const sharedId = await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(urls.shared)}).id)`);
  await click(`[data-project-action="switch"][data-project-id="${beacon.id}"]`);
  await waitFor(visible('#projectSourceSelect'), 'switch form ready');
  await fill('#projectSourceSelect', atlas.id);
  await waitFor("document.querySelectorAll('#projectCandidates input[data-tab-id]:checked').length>=3", 'explicit switch source');
  await waitFor("!globalThis.tabOutProjectWorkbench.controller.state.previewBusy", 'switch source preview settled');
  assert.equal(await evaluate("document.getElementById('projectSelectionSummary').textContent"), await evaluate("t('project.selectionSummary',{selected:5,closed:3,pinned:1})"), 'switch preview must exclude shared destination and explain pinned protection');
  await screenshot('06-switch-preview');
  await click('#projectExecuteBtn');
  await waitFor(`chrome.tabs.query({}).then(tabs=>[${JSON.stringify(urls.beaconNotes)},${JSON.stringify(urls.beaconRunbook)}].every(url=>tabs.some(tab=>tab.url===url))&&!tabs.some(tab=>${JSON.stringify(sourceTabs.map(tab=>tab.id))}.includes(tab.id)))`, 'switch completes');
  await waitFor(visible('#projectDoneBtn'), 'switch result');
  assert.equal(await evaluate(`chrome.tabs.get(${sharedId}).then(tab=>tab.windowId)`), tabs.windowId, 'shared target page must stay in place');
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.other.id}).then(tab=>tab.windowId)`), tabs.windowId);
  assert.equal(await evaluate(`chrome.tabs.get(${tabs.pinned.id}).then(tab=>tab.pinned)`), true);
  await screenshot('07-switch-result');
  await click('#projectUndoBtn');
  await waitFor(`chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(urls.atlasApi)}&&tab.windowId===${tabs.windowId}))`, 'source Undo after switching');
  await finishDialog();
  console.log('PASS safe switch preserves mixed-window projects, shared pages and pinned tabs');

  await evaluate(`chrome.tabs.query({}).then(tabs=>chrome.tabs.remove(tabs.filter(tab=>[${JSON.stringify(urls.beaconNotes)},${JSON.stringify(urls.beaconRunbook)}].includes(tab.url)).map(tab=>tab.id)))`);
  await waitFor(`document.querySelector('.project-card[data-project-id="${beacon.id}"] [data-project-action=resume]')?.textContent===t('savedFlow.openMissing',{n:2})`, 'destination card reflects the completed fixture teardown before the next mouse gesture');
  await evaluate(`window.__projectOriginalCreate=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async props=>{
    if(props.url===${JSON.stringify(urls.beaconRunbook)})throw new Error('Injected fixture creation failure');
    return window.__projectOriginalCreate(props);
  }`);
  await click(`[data-project-action="switch"][data-project-id="${beacon.id}"]`);
  await waitFor(visible('#projectSourceSelect'), 'failure case switch form ready');
  await fill('#projectSourceSelect', atlas.id);
  await waitFor("document.querySelectorAll('#projectCandidates input[data-tab-id]:checked').length>=3", 'failure case source selected');
  await click('#projectExecuteBtn');
  await waitFor(visible('#projectRetryBtn'), 'partial failure exposes retry');
  assert.equal(await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(urls.atlasApi)}&&tab.windowId===${tabs.windowId}))`), true, 'target failure must preserve source');
  await screenshot('08-partial-failure');
  await evaluate("chrome.tabs.create=window.__projectOriginalCreate");
  await click('#projectRetryBtn');
  await waitFor(`chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(urls.beaconRunbook)}))`, 'failed page retry');
  assert.equal(await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>tab.url===${JSON.stringify(urls.beaconNotes)}).length)`), 1, 'retry duplicated a successful target page');
  assert.equal(await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(urls.atlasApi)}))`), true);
  await finishDialog();
  console.log('PASS target failure preserves source; retry opens only failed pages');

  const downloadDirectory = resolve(process.env.TAB_OUT_E2E_SCREENSHOT_DIR || '/tmp/tab-out-project-downloads', 'downloads');
  await mkdir(downloadDirectory, { recursive: true });
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
  await click('#projectBackupBtn');
  await waitFor("chrome.storage.local.get('projectBackupStateV1').then(state=>Boolean(state.projectBackupStateV1?.requestedAt))", 'backup request status');
  let backup;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { backup = JSON.parse(await readFile(join(downloadDirectory, 'tab-out.config'), 'utf8')); break; }
    catch { await new Promise(done => setTimeout(done, 80)); }
  }
  assert.ok(backup, 'export did not produce a readable backup download');
  assert.equal(backup.data.workspacesV2.filter(item => item.session).length, 2, 'project layout missing from backup');
  const validation = await evaluate(`TabOutCore.validatePortableBackup(${JSON.stringify(backup)})`);
  assert.equal(validation.ok, true);
  await evaluate(`chrome.storage.local.remove('workspacesV2').then(()=>importConfig(new File([${JSON.stringify(JSON.stringify(backup))}],'projects.config',{type:'application/json'})))`);
  await waitFor(visible('#importPreviewOverlay'), 'backup import preview');
  await click('[data-action="confirm-import-preview"]');
  await waitFor("workspaceRepository.list().then(items=>items.length===2)", 'projects restored from backup');
  await evaluate('location.reload()');
  await waitFor("document.querySelectorAll('#projectList [data-project-id]').length>=2", 'project persistence after reload');
  await click('#dashboardNavProjects');
  await screenshot('09-workbench-desktop');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await screenshot('10-workbench-768');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, '768px layout overflows');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('11-workbench-390');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'narrow layout overflows');
  console.log('PASS project backup roundtrip, reload persistence, desktop and narrow layouts');
  if (acceptanceFailures.length) throw new AggregateError(acceptanceFailures, `${acceptanceFailures.length} acceptance checks failed`);
  process.stdout.write(JSON.stringify({ ok: true, journeys: ['mixed-window-explicit-selection','save-without-close','park-and-original-undo',
    'native-group-restore','partial-native-group-order','concurrent-undo','keyboard-dialog-focus','restore-mode-waiting',
    'resume-reuse','safe-project-switch','shared-page-protection','partial-failure-retry','backup-download','project-backup-roundtrip','responsive-layout'], projectCount: 2 }, null, 2) + '\n');
}

main().catch(async error => {
  try { await page?.screenshot('failure'); } catch { /* preserve the original error */ }
  process.stderr.write((error.stack || error) + '\n');
  process.exitCode = 1;
}).finally(async () => {
  page?.close();
  fixture.closeAllConnections();
  if (fixture.listening) await new Promise(done => fixture.close(done));
});
