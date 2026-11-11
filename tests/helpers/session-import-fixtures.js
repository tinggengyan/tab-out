'use strict';
function validSessionFixture() {
  return { id:'import-session',type:'project',windows:[{sourceWindowId:7,focused:true,incognito:false,state:'normal',tabs:[
    {id:'tab-1',url:'https://good.example/one',title:'Good page',index:0,pinned:true,active:true,restorable:true},
    {id:'tab-2',url:'https://good.example/two',title:'Second page',index:1,pinned:false,active:false,restorable:true},
    {id:'tab-3',url:'chrome://settings/',title:'Unsupported browser page',index:2,pinned:false,active:false,restorable:false},
  ],groups:[{ref:'group-1',title:'Native group',color:'green',collapsed:true,tabIds:['tab-1','tab-2']}]}]};
}
function invalidSessionFixtures() {
  const cases = [];
  const add = (name, change) => { const session=validSessionFixture(); change(session); cases.push({name,session}); };
  cases.push({name:'null session',session:null},{name:'primitive session',session:'invalid'},{name:'array session',session:[]});
  add('missing windows',s=>delete s.windows); add('non-array windows',s=>s.windows={});
  for(const value of [null,4,'window',[]]) add('invalid window '+JSON.stringify(value),s=>s.windows[0]=value);
  add('null tabs',s=>s.windows[0].tabs=null); add('non-array tabs',s=>s.windows[0].tabs={});
  for(const value of [null,4,'tab',true,[],{}])add('invalid tab '+JSON.stringify(value),s=>s.windows[0].tabs[0]=value);
  for(const value of [null,4,'','https://','javascript:alert(1)','data:text/html,bad'])add('invalid URL '+JSON.stringify(value),s=>s.windows[0].tabs[0].url=value);
  add('missing URL',s=>delete s.windows[0].tabs[0].url);
  add('unsafe URL marked unsupported',s=>{s.windows[0].tabs[0].url='javascript:alert(1)';s.windows[0].tabs[0].restorable=false;});
  add('internal URL marked restorable',s=>s.windows[0].tabs[2].restorable=true);
  add('bad pinned metadata',s=>s.windows[0].tabs[0].pinned='false');
  add('bad tab reference',s=>s.windows[0].tabs[0].id={bad:true});
  add('bad native group reference',s=>s.windows[0].tabs[0].groupRef=[]);
  add('null groups',s=>s.windows[0].groups=null);add('non-array groups',s=>s.windows[0].groups={});
  for(const value of [null,4,'group',[]])add('invalid group '+JSON.stringify(value),s=>s.windows[0].groups[0]=value);
  add('missing group members',s=>delete s.windows[0].groups[0].tabIds);
  add('non-array group members',s=>s.windows[0].groups[0].tabIds={});
  for(const value of [null,{},[],true])add('invalid group member '+JSON.stringify(value),s=>s.windows[0].groups[0].tabIds=[value]);
  add('bad group reference',s=>s.windows[0].groups[0].ref={});
  add('bad collapsed metadata',s=>s.windows[0].groups[0].collapsed='true');
  return cases;
}
module.exports={validSessionFixture,invalidSessionFixtures};
