const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('default Free opens the existing palette instead of an upgrade toast', async () => {
  const app = fs.readFileSync(require('node:path').join(__dirname,'../../extension/app.js'),'utf8');
  const start = app.indexOf('async function openCommandPalette(');
  const end = app.indexOf('\nfunction closeCommandPalette',start);
  const nodes = {commandOverlay:{style:{display:'none'}}, commandInput:{value:'',focus(){}},commandEmpty:{style:{},textContent:''}};
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
