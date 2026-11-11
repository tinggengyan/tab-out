'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceRepository } = require('../../extension/src/storage/workspace-repository.js');
const { createPortableBackup } = require('../../extension/src/services/backup-service.js');
function storage(initial = {}) {
  let data = structuredClone(initial); let fail = false;
  return {
    async get(key) { await new Promise(done => setTimeout(done, 1)); return { [key]: structuredClone(data[key]) }; },
    async set(value) { if (fail) throw new Error('Storage unavailable'); await new Promise(done => setTimeout(done, 1)); Object.assign(data, structuredClone(value)); },
    inspect: () => structuredClone(data), fail: value => { fail = value; },
  };
}
const group = (id, extra = {}) => ({ id, savedAt: '2026-08-10T00:00:00.000Z', tabs: [{ url: 'https://same.example/', title: 'Readable article' }], ...extra });
test('legacy projects migrate atomically with provenance, dates, raw backup and native session intact', async () => {
  const session = { windows: [{ sourceWindowId: 9, tabs: [{ id: 'a', url: 'https://same.example/', pinned: true, index: 2 }], groups: [{ ref: 'g', color: 'green', title: 'Native', tabIds: ['a'] }] }] };
  const original = group('one', { name: 'My project', session });
  const area = storage({ workspacesV2: [{ id: 'normal', name: 'Existing', entries: [], order: 0 }], tabGroups: [original, group('two')] });
  const repo = createWorkspaceRepository(area);
  const projects = await repo.list();
  assert.equal(projects.length, 3);
  const migrated = projects.find(item => item.legacyGroupId === 'one');
  assert.equal(migrated.name, 'My project'); assert.equal(migrated.createdAt, original.savedAt);
  assert.deepEqual(migrated.session, session);
  assert.equal(projects.find(item => item.legacyGroupId === 'two').name, 'Readable article');
  assert.deepEqual(area.inspect().tabGroups, []);
  assert.deepEqual(area.inspect().projectMigrationBackupV1.tabGroups, [original, group('two')]);
  assert.equal((await repo.list()).length, 3);
});
test('failed migration preserves the original active data and can retry without duplicates', async () => {
  const area = storage({ tabGroups: [group('one')] }); const repo = createWorkspaceRepository(area);
  area.fail(true); await assert.rejects(repo.list(), /Storage unavailable/);
  assert.deepEqual(area.inspect().tabGroups, [group('one')]); assert.equal(area.inspect().workspacesV2, undefined);
  area.fail(false); assert.equal((await repo.list()).length, 1); assert.deepEqual(area.inspect().tabGroups, []);
});
test('concurrent repository initialization and creates cannot overwrite projects or migrate twice', async () => {
  const area = storage({ tabGroups: [group('one')] });
  let id = 0; const options = { id: () => `new-${++id}` };
  const a = createWorkspaceRepository(area, options), b = createWorkspaceRepository(area, options);
  await Promise.all([a.list(), b.list(), a.create({ name: 'A' }), b.create({ name: 'B' })]);
  assert.equal((await a.list()).length, 3);
  assert.equal((await a.list()).filter(item => item.legacyGroupId === 'one').length, 1);
});
test('legacy identity collision preserves unrelated project and repeated imports preserve user edits', async () => {
  const area = storage({ workspacesV2: [{ id: 'legacy-group:one', name: 'Unrelated', order: 0, entries: [] }], tabGroups: [group('one')] });
  const repo = createWorkspaceRepository(area); const project = (await repo.list()).find(item => item.legacyGroupId === 'one');
  assert.equal(project.id, 'legacy-group:one:2');
  await repo.update(project.id, { name: 'Edited later' });
  await repo.importLegacyGroups([group('one')]); await repo.importLegacyGroups([group('one')]);
  assert.equal((await repo.list()).length, 2); assert.equal((await repo.get(project.id)).name, 'Edited later');
});
test('modern and legacy import/replace/export roundtrip has one canonical project per record', async () => {
  const area = storage(); const repo = createWorkspaceRepository(area);
  await repo.importData({ tabGroups: [group('one'), group('two')] }, { strategy: 'replace' });
  assert.equal((await repo.list()).length, 2);
  const backup = createPortableBackup(area.inspect());
  assert.deepEqual(backup.data.tabGroups, []); assert.equal(backup.data.workspacesV2.length, 2);
  await repo.importData(backup.data); await repo.importData(backup.data);
  assert.equal((await repo.list()).length, 2);
  const restored = await repo.restore(await repo.remove((await repo.list())[0].id));
  assert.equal(restored.legacyGroupId, 'one');
  await repo.importLegacyGroups([group('one')]); assert.equal((await repo.list()).length, 2);
});

test('a valid captured session supplies pages when a legacy tab list has only pending URLs', async () => {
  const session = { windows: [{ tabs: [{ id:'a', url:'https://complete.example/', title:'Complete page', pinned:true }], groups:[] }] };
  const area = storage({tabGroups:[group('pending',{tabs:[{title:'Pending title'}],session})]});
  const project = (await createWorkspaceRepository(area).list())[0];
  assert.equal(project.entries.length,1); assert.equal(project.entries[0].url,'https://complete.example/');
  assert.deepEqual(project.session,session); assert.deepEqual(area.inspect().projectMigrationBackupV1.tabGroups[0].tabs,[{title:'Pending title'}]);
});
test('retrying a trash restoration after trash removal fails reuses the already restored project', async () => {
  const repo = createWorkspaceRepository(storage());
  const payload = {id:'deleted',name:'Restore me',entries:[{url:'https://restore.example/'}],legacyGroupId:'old',restoredFromTrashId:'trash-1'};
  const first = await repo.restore(payload), second = await repo.restore(payload);
  assert.equal(first.id,second.id); assert.equal((await repo.list()).length,1);
});

test('current-schema legacy normalization rejects invalid nested sessions without clearing source or unrelated assets', async () => {
  const {invalidSessionFixtures,validSessionFixture}=require('../helpers/session-import-fixtures.js');
  for(const {name,session} of invalidSessionFixtures()) {
    const initial={storageMeta:{schemaVersion:2},tabGroups:[group('bad',{session})],workspacesV2:[{id:'keep',name:'Keep project',entries:[],order:0}],deferred:[{id:'later',url:'https://later.example/'}]};
    const area=storage(initial),repo=createWorkspaceRepository(area);
    await assert.rejects(repo.list(),/Invalid saved project session/,name);assert.deepEqual(area.inspect(),initial,name);
    await area.set({tabGroups:[group('bad',{session:validSessionFixture()})]});
    assert.equal((await repo.list()).length,2,name);assert.deepEqual(area.inspect().tabGroups,[],name);
  }
});
