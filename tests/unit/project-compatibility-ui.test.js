'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');
const { createRuleRepository } = require('../../extension/src/storage/rule-repository.js');
const { createTrashRepository } = require('../../extension/src/storage/trash-repository.js');
const schema = require('../../extension/src/storage/schema.js');
const backup = require('../../extension/src/services/backup-service.js');
const app = fs.readFileSync(require('node:path').join(__dirname, '../../extension/app.js'), 'utf8');
function storage(initial = {}) {
  let data = structuredClone(initial), failure = () => false;
  return {
    async get(keys) { return keys === null ? structuredClone(data) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])); },
    async set(update) { if (failure(update)) throw new Error('Injected storage failure'); Object.assign(data, structuredClone(update)); },
    inspect: () => structuredClone(data), failWhen: predicate => { failure = predicate; },
  };
}
async function restoreHarness(rules) {
  const area = storage();
  const workspaceRepository = createWorkspaceRepository(area);
  const ruleRepository = createRuleRepository(area);
  const trashRepository = createTrashRepository(area, { id: () => 'trash-project-1' });
  const item = await trashRepository.add('workspace', 'old-project', { id: 'old-project', name: 'Restored project', entries: [{ url: 'https://restore.example/' }], rules });
  const context = { workspaceRepository, ruleRepository, trashRepository, renderWorkspaces: async () => {}, renderTrash: async () => {} };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function restoreTrashItem('), app.indexOf('\nasync function renderHistory(')), context);
  return { area, workspaceRepository, ruleRepository, trashRepository, restore: () => context.restoreTrashItem(item.id) };
}
test('real restoreTrashItem retries a failed final trash write without duplicating project or rules or reverting edits', async () => {
  const h = await restoreHarness([{ id: 'original-rule', pattern: 'docs.example', enabled: false, mode: 'auto', description: 'Original user note' }]);
  let once = true;
  h.area.failWhen(update => Boolean(Object.hasOwn(update, 'trashV2') && !update.trashV2.length && once && (once = false, true)));
  await assert.rejects(h.restore(), /Injected storage failure/);
  assert.equal((await h.workspaceRepository.list()).length, 1);
  assert.equal((await h.ruleRepository.list()).length, 1);
  assert.equal((await h.trashRepository.list()).length, 1);
  const first = (await h.ruleRepository.list())[0];
  assert.equal(first.enabled, false); assert.equal(first.mode, 'auto'); assert.equal(first.description, 'Original user note');
  await h.ruleRepository.update(first.id, { enabled: true, mode: 'suggest', description: 'Edited after partial restore' });
  await h.restore();
  assert.equal((await h.workspaceRepository.list()).length, 1);
  assert.equal((await h.trashRepository.list()).length, 0);
  const after = await h.ruleRepository.list(); assert.equal(after.length, 1); assert.equal(after[0].id, first.id);
  assert.equal(after[0].enabled, true); assert.equal(after[0].mode, 'suggest'); assert.equal(after[0].description, 'Edited after partial restore');
});
test('real restoreTrashItem resumes a partial multi-rule write and restores anonymous rule identity once', async () => {
  const original = [
    { id: 'r1', pattern: 'one.example', mode: 'auto', enabled: false },
    { pattern: 'two.example', mode: 'suggest', enabled: true },
    { id: 'r3', pattern: 'three.example', mode: 'auto', enabled: true },
  ];
  const h = await restoreHarness(original); let once = true;
  h.area.failWhen(update => Boolean(update.workspaceRulesV2?.length === 2 && once && (once = false, true)));
  await assert.rejects(h.restore(), /Injected storage failure/);
  const first = (await h.ruleRepository.list())[0];
  assert.equal((await h.trashRepository.list()).length, 1);
  await h.restore();
  const restored = await h.ruleRepository.list();
  assert.equal(restored.length, 3); assert.equal(restored[0].id, first.id);
  assert.equal(new Set(restored.map(rule => rule.id)).size, 3);
  assert.deepEqual(restored.map(({pattern,mode,enabled})=>({pattern,mode,enabled})), original.map(({pattern,mode,enabled})=>({pattern,mode,enabled})));
  assert.ok(restored.every(rule => rule.workspaceId === 'old-project'));
  assert.equal((await h.workspaceRepository.list()).length, 1); assert.equal((await h.trashRepository.list()).length, 0);
});

function importHarness() {
  const area = storage(); const workspaceRepository = createWorkspaceRepository(area);
  const nodes = new Map(); const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', style: { display: 'none' } });
    return nodes.get(id);
  };
  let strategy = 'merge'; const toasts = [];
  const context = {
    pendingImport: null, importGeneration: 0, workspaceRepository, chrome: { storage: { local: area } },
    document: { getElementById: node, querySelector: () => ({ value: strategy }) },
    TabOutCore: { ...schema, ...backup }, t: key => key, tPlural: key => key, showToast: text => toasts.push(text),
    initShortcuts: async () => {}, renderDashboard: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function importConfig('), app.indexOf('// ---- Dialog helpers ----', app.indexOf('async function importConfig('))), context);
  const start = app.indexOf("  if (action === 'confirm-import-preview') {");
  const end = app.indexOf("  if (action === 'deactivate-license')", start);
  vm.runInContext(`async function confirmImport() { const action = 'confirm-import-preview'; ${app.slice(start, end)} }`, context);
  return { area, workspaceRepository, nodes, context, toasts,
    async load(payload, selected = 'merge') {
      strategy = selected;
      const file = new File([JSON.stringify(payload)], 'legacy-tab-out.config', { type: 'application/json' });
      await context.importConfig(file);
      assert.ok(context.pendingImport, 'real File import reaches its UI preview');
      assert.equal(node('importPreviewOverlay').style.display, 'flex');
    },
    async confirm() { await context.confirmImport(); assert.equal(node('importPreviewOverlay').style.display, 'none'); },
  };
}
function legacyGroup() {
  const session = { windows: [{ sourceWindowId: 42, focused: true, incognito: false, tabs: [
    { id: 'tab-1', url: 'https://reading.example/one', title: 'Pinned source', pinned: true, index: 0, active: true, restorable: true },
    { id: 'tab-2', url: 'https://reading.example/two', title: 'Native group page', pinned: false, index: 1, active: false, restorable: true },
  ], groups: [{ ref: 'group-1', title: 'Native reading', color: 'green', collapsed: true, tabIds: ['tab-1', 'tab-2'] }] }] };
  return { name: 'Keep my project name', savedAt: '2026-08-01T00:00:00.000Z', tabs: session.windows[0].tabs.map(({url,title,pinned})=>({url,title,pinned})), session };
}
test('actual File to validator to preview-confirm preserves legacy metadata and distinct stable anonymous records across merge/replace', async () => {
  const h = importHarness(); const raw = legacyGroup(); const payload = { version: 1, tabGroups: [raw, structuredClone(raw)] };
  await h.load(payload);
  const validated = h.context.pendingImport.data.tabGroups;
  assert.notEqual(validated[0].id, validated[1].id, 'identical anonymous records have separate source identities');
  assert.equal(validated[0].name, raw.name); assert.deepEqual(validated[0].session, raw.session); assert.equal(validated[0].tabs[0].pinned, true);
  await h.confirm();
  let projects = await h.workspaceRepository.list(); assert.equal(projects.length, 2);
  for (const project of projects) { assert.equal(project.name, raw.name); assert.deepEqual(project.session, raw.session); assert.equal(project.entries[0].pinned, true); assert.equal(project.createdAt, raw.savedAt); }
  const ids = projects.map(project => project.id);
  await h.workspaceRepository.update(ids[0], { name: 'Edited after import' });
  await h.load(payload); await h.confirm(); await h.load(payload); await h.confirm();
  projects = await h.workspaceRepository.list(); assert.deepEqual(projects.map(project=>project.id), ids);
  assert.equal((await h.workspaceRepository.get(ids[0])).name, 'Edited after import');
  await h.workspaceRepository.create({ name: 'Unrelated', entries: [] });
  await h.load(payload, 'replace'); await h.confirm();
  projects = await h.workspaceRepository.list(); assert.equal(projects.length, 2);
  for (const project of projects) { assert.equal(project.name, raw.name); assert.deepEqual(project.session, raw.session); }
  assert.deepEqual(h.area.inspect().tabGroups, []);
});
test('actual legacy File import uses valid session pages when the flat list has no valid URL', async () => {
  const h = importHarness(); const raw = legacyGroup(); raw.tabs = [{title:'Pending page'}];
  await h.load({tabGroups:[raw]}); await h.confirm();
  const project = (await h.workspaceRepository.list())[0];
  assert.equal(project.name,raw.name); assert.equal(project.entries.length,2); assert.equal(project.entries[0].pinned,true);
  assert.deepEqual(project.session,raw.session);
});
test('actual legacy File import rejects unsafe session URLs without touching existing projects', async () => {
  const h = importHarness(); await h.workspaceRepository.create({name:'Keep existing'});
  const raw = legacyGroup(); raw.session.windows[0].tabs[0].url = 'javascript:alert(1)';
  await h.context.importConfig(new File([JSON.stringify({tabGroups:[raw]})],'unsafe.config'));
  assert.equal(h.context.pendingImport,null); assert.equal(h.toasts.at(-1),'toast.importFailed');
  assert.equal((await h.workspaceRepository.list()).length,1);
});
test('legacy validator preserves dangerous-leaf filtering and enforces depth, size, item and prototype bounds', () => {
  const filtered = schema.validateImportPayload({tabGroups:[{tabs:[{url:'javascript:alert(1)'},{url:'https://safe.example/',pinned:true}]}]});
  assert.equal(filtered.ok,true); assert.equal(filtered.data.tabGroups[0].tabs.length,1); assert.equal(filtered.data.tabGroups[0].tabs[0].pinned,true);
  let deep = {}; for(let index=0;index<20;index++)deep={child:deep};
  assert.equal(schema.validateImportPayload({tabGroups:[{tabs:[],session:deep}]}).ok,false);
  assert.equal(schema.validateImportPayload({tabGroups:[{tabs:[{url:'https://safe.example/',title:'x'.repeat(30)}]}]},{maxStringLength:20}).ok,false);
  assert.equal(schema.validateImportPayload({tabGroups:[{tabs:[{url:'https://safe.example/a'},{url:'https://safe.example/b'}]}]},{maxItems:2}).ok,false);
  assert.equal(schema.validateImportPayload(JSON.parse('{"tabGroups":[{"tabs":[],"__proto__":{"bad":true}}]}')).ok,false);
  const emojiIdentity = name => schema.validateImportPayload({tabGroups:[{name,tabs:[{url:'https://same.example/'}]}]}).data.tabGroups[0].id;
  assert.notEqual(emojiIdentity('😀'),emojiIdentity('😁'),'different Unicode titles cannot collapse because of a shared high surrogate');
});

test('real File import clears an existing preview and rejects malformed legacy and portable sessions without touching the library', async () => {
  const {invalidSessionFixtures,validSessionFixture}=require('../helpers/session-import-fixtures.js');
  const h=importHarness();await h.workspaceRepository.create({name:'Existing library',entries:[{url:'https://keep.example/'}]});
  const before=h.area.inspect();
  for(const {name,session} of invalidSessionFixtures()) {
    for(const payload of [
      {tabGroups:[{id:'bad',name:'Do not import',tabs:[{url:'https://good.example/'}],session}]},
      {version:2,data:{workspacesV2:[{id:'bad',name:'Do not import',entries:[{url:'https://good.example/'}],session}]}},
      {version:2,data:{tabGroups:[{id:'bad',tabs:[{url:'https://good.example/'}],session}]}},
      {version:2,data:{snapshotsV2:[session]}},
    ]) {
      await h.load({tabGroups:[{...legacyGroup(),session:validSessionFixture()}]});
      await h.context.importConfig(new File([JSON.stringify(payload)],'bad-session.config'));
      assert.equal(h.context.pendingImport,null,name);assert.equal(h.nodes.get('importPreviewOverlay').style.display,'none',name);
      assert.equal(h.toasts.at(-1),'toast.importFailed',name);assert.deepEqual(h.area.inspect(),before,name);
      await h.context.confirmImport();assert.deepEqual(h.area.inspect(),before,'a stale confirmation cannot mutate data: '+name);
    }
  }
});
test('a previous slow File read cannot resurrect its confirmation after the replacement file is rejected', async () => {
  const h=importHarness();await h.workspaceRepository.create({name:'Keep existing'});const before=h.area.inspect();
  let release;const file=new File(['placeholder'],'slow-valid.config');file.text=()=>new Promise(done=>{release=done;});
  const pending=h.context.importConfig(file);
  await h.context.importConfig(new File(['{invalid json'],'invalid.config'));
  release(JSON.stringify({tabGroups:[legacyGroup()]}));await pending;
  assert.equal(h.context.pendingImport,null);assert.equal(h.nodes.get('importPreviewOverlay').style.display,'none');assert.deepEqual(h.area.inspect(),before);
});

test('actual valid File to repository to project service preserves safe unsupported metadata and remains previewable after trash roundtrip', async () => {
  const {validSessionFixture}=require('../helpers/session-import-fixtures.js');
  const {createProjectService}=require('../../extension/src/services/project-service.js');
  const {createChromeSessionAdapter}=require('../../extension/src/api/chrome-session-adapter.js');
  const h=importHarness(),session=validSessionFixture();
  await h.load({tabGroups:[{...legacyGroup(),session}]});await h.confirm();
  let project=(await h.workspaceRepository.list())[0];
  const chromeApi={tabs:{query:async()=>[]},windows:{getAll:async()=>[],getCurrent:async()=>({id:1})}};
  const service=createProjectService({chromeApi,workspaceRepository:h.workspaceRepository,sessionAdapter:createChromeSessionAdapter(chromeApi),operationService:{}});
  let preview=await service.previewResume({workspaceId:project.id});
  assert.equal(preview.counts.missing,2);assert.equal(preview.counts.unsupported,1);
  assert.deepEqual(project.session,session);
  project=await h.workspaceRepository.restore({...await h.workspaceRepository.remove(project.id),restoredFromTrashId:'safe-internal-roundtrip'});
  preview=await service.previewResume({workspaceId:project.id});
  assert.equal(preview.counts.missing,2);assert.equal(preview.counts.unsupported,1);assert.deepEqual(project.session,session);
});
