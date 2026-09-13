const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = '../../extension/src/services/omnibox-search-service.js';
const api = fs.existsSync(path.join(__dirname,target)) ? require(target) : {};
test('omnibox exposes free tab suggestions and plain input opens dashboard', async () => {
  assert.equal(typeof api.installOmniboxSearch, 'function');
  const listeners = {};
  const opened = [];
  const chrome = {
    omnibox: Object.fromEntries(['onInputChanged','onInputEntered','onInputCancelled'].map(key => [key,{addListener: fn => {listeners[key]=fn;}}])),
    tabs: {query: async()=>[{id:7,windowId:4,title:'MiniMax API',url:'https://example.com/docs'}]},
  };
  api.installOmniboxSearch(chrome, {
    platforms: {list:async()=>[]}, advancedItems:async()=>[], openDashboard:async(...args)=>opened.push(args),
  });
  let results;
  await listeners.onInputChanged('minimax', value => {results=value;});
  assert.equal(results.length,1);
  assert.match(results[0].description,/MiniMax API/);
  assert.notEqual(results[0].content,'https://example.com/docs');
  await listeners.onInputEntered('unmatched words');
  assert.deepEqual(opened,[['unmatched words']]);
});

test('late omnibox responses cannot overwrite newer suggestions', async () => {
  const listeners = {}; let resolveOld; let queryCalls = 0;
  const chrome = {omnibox:Object.fromEntries(['onInputChanged','onInputEntered','onInputCancelled'].map(key=>[key,{addListener:fn=>{listeners[key]=fn;}}])),
    tabs:{query:()=>++queryCalls === 1 ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve([{id:2,windowId:1,title:'new',url:'https://example.com/new'}])}};
  api.installOmniboxSearch(chrome,{platforms:{list:async()=>[]},advancedItems:async()=>[],openDashboard:async()=>{}});
  const outputs=[];
  const old = listeners.onInputChanged('old',value=>outputs.push(['old',value]));
  await listeners.onInputChanged('new',value=>outputs.push(['new',value]));
  resolveOld([{id:1,windowId:1,title:'old',url:'https://example.com/old'}]); await old;
  assert.deepEqual(outputs.map(item=>item[0]),['new']);
});

test('platform command Enter opens a fresh encoded search and empty query routes to dashboard', async () => {
  const listeners={}; const opened=[]; const dashboards=[];
  const chrome={omnibox:Object.fromEntries(['onInputChanged','onInputEntered','onInputCancelled'].map(key=>[key,{addListener:fn=>{listeners[key]=fn;}}])),
    tabs:{create:async item=>opened.push(item),query:async()=>[]}};
  const platforms=[{id:'yuque',name:'语雀',aliases:['yq','yuque'],domain:'example.com',searchUrlTemplate:'https://example.com/search?q={Query}'}];
  api.installOmniboxSearch(chrome,{platforms:{list:async()=>platforms},advancedItems:async()=>[],openDashboard:async q=>dashboards.push(q)});
  await listeners.onInputEntered('yq 中文 & #');
  assert.deepEqual(opened,[{url:'https://example.com/search?q=%E4%B8%AD%E6%96%87%20%26%20%23'}]);
  await listeners.onInputEntered('语雀');
  assert.deepEqual(dashboards,['语雀']);
});
