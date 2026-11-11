const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('default Free opens the existing palette instead of an upgrade toast', async () => {
  const app = fs.readFileSync(require('node:path').join(__dirname,'../../extension/app.js'),'utf8');
  const start = app.indexOf('async function openCommandPalette(');
  const end = app.indexOf('\nfunction closeCommandPalette',start);
  const nodes = {commandOverlay:{style:{display:'none'},contains:()=>false}, commandInput:{value:'',focus(){}},commandEmpty:{style:{},textContent:''}};
  let built = false;
  const context = { entitlementService:{has:async()=>false}, showToast:()=>{}, t:x=>x,
    buildCommandSearchIndex:async()=>{built=true;}, renderCommandResults:()=>{},
    document:{getElementById:id=>nodes[id]},
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  await context.openCommandPalette();
  assert.equal(nodes.commandOverlay.style.display,'flex');
  assert.equal(built,true);
});

test('confirming an IME candidate never activates a search result', () => {
  const app = fs.readFileSync(require('node:path').join(__dirname,'../../extension/app.js'),'utf8');
  const start = app.indexOf("document.addEventListener('keydown',", app.indexOf('// Escape key'));
  const end = app.indexOf('\nconst modalFocusObserver', start);
  let handler; let clicks = 0;
  const context = { commandSelectedIndex:0, document: {
    addEventListener:(_name,fn)=>{handler=fn;}, getElementById:()=>({style:{display:'flex'}}),
    querySelectorAll:()=>[{click:()=>{clicks++;}}],
  }};
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  handler({key:'Enter',isComposing:true,preventDefault(){}});
  assert.equal(clicks,0);
});

test('tab API failures reject index building rather than appear as no results', async () => {
  const app = fs.readFileSync(require('node:path').join(__dirname,'../../extension/app.js'),'utf8');
  const start = app.indexOf('async function buildCommandSearchIndex()');
  const end = app.indexOf('\nfunction searchTypeLabel',start);
  const context = { commandBuildGeneration:0, chrome:{storage:{local:{}},tabs:{query:async()=>{throw new Error('offline');}}},
    fetchOpenTabs:async()=>{}, entitlementService:{has:async()=>false},
    TabOutCore:{createSearchPlatformRepository:()=>({list:async()=>[]}),openTabSearchItems:()=>[],createSearchIndex:()=>({})},
    getRealTabs:()=>[], commandSearchItems:new Map(),
  };
  vm.createContext(context); vm.runInContext(app.slice(start,end),context);
  await assert.rejects(context.buildCommandSearchIndex(),/offline/);
});

test('Free builds canonical projects including migrated records and archived pages without advanced entitlement', async () => {
  const app = fs.readFileSync(require('node:path').join(__dirname, '../../extension/app.js'), 'utf8');
  const start = app.indexOf('async function buildCommandSearchIndex()');
  const end = app.indexOf('\nfunction searchTypeLabel', start);
  let indexed;
  const context = { commandBuildGeneration: 0, commandSearchItems: new Map(),
    chrome: { storage: { local: {} }, tabs: { query: async () => [{ windowId: 57382 }] } },
    entitlementService: { has: async () => false },
    workspaceRepository: { list: async () => [{ id: 'w', name: 'Research', entries: [{ id: 'e', title: 'Architecture', url: 'https://docs.example/a' }] }, { id: 'migrated', legacyGroupId: 'g', name: 'Migrated', entries: [{id:'ge',title:'Collected',url:'https://g.example/'}]}] },
    snapshotRepository: { list: async () => { throw new Error('history must remain gated'); } },
    getTabGroups: async () => [{ id: 'g', tabs: [{ title: 'Collected', url: 'https://g.example/' }] }],
    getSavedTabs: async () => ({ active: [{ title: 'Later', url: 'https://later.example/' }], archived: [{ title: 'Archive', url: 'https://archive.example/' }] }),
    TabOutCore: { createSearchPlatformRepository: () => ({ list: async () => [] }), openTabSearchItems: () => [], createSearchIndex: items => { indexed = items; return {}; } },
  };
  vm.createContext(context); vm.runInContext(app.slice(start, end), context);
  await context.buildCommandSearchIndex();
  assert.deepEqual(Array.from(indexed, item => item.type), ['workspace', 'workspace', 'workspace', 'workspace', 'deferred', 'deferred']);
  assert.equal(context.commandWindowNames.get(57382), 1);
});

test('each command query searches memory locally and a late result cannot replace the current query', async () => {
  const app = fs.readFileSync(require('node:path').join(__dirname, '../../extension/app.js'), 'utf8');
  const start = app.indexOf('function searchTypeLabel(');
  const end = app.indexOf('\nasync function openCommandPalette', start);
  const pending = []; const searches = [];
  const nodes = { commandResults: { style: {}, innerHTML: '', setAttribute() {} }, commandEmpty: { style: {}, textContent: '' }, commandHint: { textContent: '' } };
  const context = {
    commandQueryGeneration: 0, commandBuildGeneration: 0, commandMemoryRequestId: null, commandPlatforms: [], commandHasAdvanced: false,
    commandSearchItems: new Map(), commandWindowNames: new Map(), commandSelectedIndex: 0,
    commandSearchIndex: { search: query => [{ id: 'saved', type: 'deferred', title: `Saved ${query}`, url: 'https://saved.example/' }] },
    chrome: { runtime: { sendMessage: message => {
      if (message.action === 'cancel') return Promise.resolve({ ok: true });
      searches.push(message.payload);
      return new Promise(resolve => pending.push(resolve));
    } } },
    TabOutCore: { parsePlatformQuery: query => ({ kind: 'tabs', query }), findSearchPlatforms: () => [], renderMemorySnippetHTML: () => '' },
    escapeHtml: require('../../extension/src/shared/sanitize.js').escapeHtml, t: key => key,
    document: { getElementById: id => nodes[id] },
  };
  vm.createContext(context); vm.runInContext(app.slice(start, end), context);
  const first = context.renderCommandResults('old');
  const second = context.renderCommandResults('new');
  pending[1]({ ok: true, data: { results: [{ id: 'new-memory', title: 'New memory', url: 'https://memory.example/new' }] } });
  await second;
  assert.match(nodes.commandResults.innerHTML, /New memory/);
  pending[0]({ ok: true, data: { results: [{ id: 'old-memory', title: 'Old memory', url: 'https://memory.example/old' }] } });
  await first;
  assert.doesNotMatch(nodes.commandResults.innerHTML, /Old memory/);
  assert.match(nodes.commandResults.innerHTML, /Saved new/);
  assert.deepEqual(searches.map(item => [item.query, item.useAI, item.includeContent, item.days]), [['old', false, false, 365], ['new', false, false, 365]]);
});
