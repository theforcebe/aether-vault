'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/workbench-core');
const { inventoryFor } = require('./mtg');
const { effectivePlan } = require('./mtg-allocations');
const { createServer } = require('./workbench-server');
const row=(name,quantity,binder,proxy=false,binderType='binder')=>({name,quantity,binder,proxy,binderType});
const snapshot={schemaVersion:1,records:[row('Sol Ring',3,'Extras'),row('Sol Ring',2,'Deck A',false,'deck'),row('Sol Ring',1,'Unknown'),row('Sol Ring',4,'Extras',true),row('Cloudshift',2,'Extras')]};
const ledger={schemaVersion:1,availableBinders:['Extras'],decks:[{id:'a',name:'Deck A',mode:'binder',binder:'Deck A',status:'inferred'},{id:'b',name:'Deck B',mode:'list',cards:[{name:'Sol Ring',quantity:2}]}]};
test('Workbench inventory matches research allocation tool for every target and protects unknown binders',()=>{
  for(const targetDeckId of [undefined,'a','b']){
    const inv=C.inventory(snapshot,ledger,targetDeckId).get('Sol Ring'), expected=inventoryFor(['Sol Ring'],snapshot,effectivePlan({cards:[],targetDeckId},ledger,snapshot));
    for(const k of ['available','totalOwned','eligibleOwned','reserved','proxyQuantity','copiesInOtherDecks'])assert.equal(inv[k],expected[k],k+' '+targetDeckId);
  }
  assert.equal(C.inventory(snapshot,ledger).get('Sol Ring').available,1);
});
test('DFC aliases share one physical pool; commander and main quantities combine; sideboard stays separate',()=>{
  const facts={'front // back':{name:'Front // Back',card_faces:[{name:'Front'},{name:'Back'}]}};
  const inv=C.inventory({records:[row('Front // Back',1,'Extras')]},{availableBinders:['Extras'],decks:[]},null,facts);
  const rows=C.coverage([{n:'Front',q:1,zone:'commander'},{n:'Back',q:1,zone:'main'},{n:'Front',q:7,zone:'sideboard'}],inv);
  assert.equal(rows.length,1);assert.equal(rows[0].q,2);assert.equal(rows[0].missing,1);
});
test('Deck parser accepts common exports, duplicates, printings, commander markers and sections',()=>{
  const p=C.parseDeck('Commander\n1 Atraxa, Praetors\' Voice\nDeck\n2x Sol Ring\n1 Sol Ring (C21) 263\n1 Fire // Ice\nSideboard\n1 Cloudshift\nSB: 2 Island');
  assert.deepEqual(p.errors,[]);assert.equal(p.cards.find(c=>c.n==='Sol Ring').q,3);assert.equal(p.cards[0].zone,'commander');assert.equal(p.cards.find(c=>c.n==='Fire // Ice').q,1);assert.equal(p.cards.find(c=>c.n==='Island').zone,'sideboard');
  assert.equal(C.parseDeck('1 Karlov of the Ghost Council *CMDR*').cards[0].zone,'commander');
});
test('Invalid and zero deck quantities never silently become one',()=>{
  for(const s of ['0 Sol Ring','-1 Sol Ring','1001 Sol Ring','1.5 Sol Ring'])assert.ok(C.parseDeck(s).errors.length,s);
});
test('Effect comparisons distinguish team double strike from a single target and show mana tradeoffs',()=>{
  const team={name:'True Conviction',oracle_text:'Creatures you control have double strike and lifelink.',type_line:'Enchantment',cmc:6,color_identity:['W']};
  const target={name:'Single target',oracle_text:'Target creature gains double strike until end of turn.',type_line:'Instant',cmc:2,color_identity:['W']};
  const equivalent={...team,name:'Team effect',cmc:7};
  assert.ok(C.roles(team).includes('double-strike-team'));assert.ok(!C.roles(target).includes('double-strike-team'));
  const list=C.alternatives(team,[{name:target.name,fact:target,own:{totalOwned:1,available:1}},{name:equivalent.name,fact:equivalent,own:{totalOwned:1,available:1}}],['W']);
  assert.deepEqual(list.map(c=>c.name),['Team effect']);
});
test('Flicker browsing detects immediate and delayed return without treating ETB text as flicker',()=>{
  const f={oracle_text:'Exile target creature you control, then return that card to the battlefield under your control.',type_line:'Instant'};
  assert.ok(C.roles(f).includes('flicker'));assert.ok(!C.roles({oracle_text:'When this creature enters, draw a card.'}).includes('flicker'));
  assert.ok(C.traits({...f,oracle_text:f.oracle_text+' at the beginning of the next end step.'}).includes('Delayed return'));
  assert.ok(!C.roles(f).includes('removal'));
  assert.ok(!C.roles({oracle_text:'When Fiend Hunter enters, exile another target creature. When Fiend Hunter leaves the battlefield, return the exiled card to the battlefield.'}).includes('flicker'));
  const adventure={name:'Pegasus Guardian // Rescue the Foal',cmc:6,card_faces:[{name:'Pegasus Guardian',type_line:'Creature',mana_cost:'{5}{W}',oracle_text:'Flying'},{name:'Rescue the Foal',type_line:'Instant — Adventure',mana_cost:'{1}{W}',oracle_text:f.oracle_text}]};
  assert.equal(C.effectView(adventure,'flicker').cmc,2);assert.equal(C.effectView(adventure,'flicker').faceName,'Rescue the Foal');
});
test('Commander construction checks include colors, unknown facts and singleton with basic exception',()=>{
  const facts={leader:{name:'Leader',type_line:'Legendary Creature',color_identity:['W'],legalities:{commander:'legal'}},island:{name:'Island',type_line:'Basic Land — Island',color_identity:['U'],legalities:{commander:'legal'}},ring:{name:'Ring',type_line:'Artifact',color_identity:[],legalities:{commander:'legal'}}};
  const result=C.validateDeck({format:'commander',cards:[{n:'Leader',q:1,zone:'commander'},{n:'Island',q:20,zone:'main'},{n:'Ring',q:2,zone:'main'},{n:'Mystery',q:1,zone:'main'}]},facts);
  assert.equal(result.total,24);assert.equal(result.unresolved,1);assert.ok(result.issues.some(s=>s.includes('outside commander')));assert.ok(result.issues.some(s=>s.includes('Ring: check singleton')));assert.ok(!result.issues.some(s=>s.includes('Island: check singleton')));
});
test('Local server guards private files, traversal, cross-origin and host rebinding; facts retain full API objects',async()=>{
  const port=18787, cacheRoot=path.join(__dirname,'..','workbench-test-cache-'+process.pid);
  const server=createServer({port,cacheRoot,api:async()=>({data:[{id:'11111111-1111-1111-1111-111111111111',name:'Front // Back',image_uris:{normal:'https://cards.scryfall.io/test.jpg'},card_faces:[{name:'Back',image_uris:{normal:'https://cards.scryfall.io/back.jpg'}}],prices:{usd:null}}]})});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  try{
    const base='http://127.0.0.1:'+port;
    assert.equal((await fetch(base+'/')).status,200);
    for(const p of ['/knowledge/collection/latest.json','/.git/config','/tools/mtg.js','/js/%2e%2e%2fknowledge%2fcollection%2flatest.json'])assert.equal((await fetch(base+p)).status,404,p);
    assert.equal((await fetch(base+'/api/workbench/status',{headers:{Origin:'https://evil.example'}})).status,403);
    const spoofed=await new Promise((resolve,reject)=>{const req=require('node:http').request(base+'/api/workbench/status',{headers:{Host:'evil.example:'+port}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(spoofed,403);
    const r=await fetch(base+'/api/workbench/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifiers:[{name:'Front'}]})});
    const d=await r.json();assert.equal(d.data[0].card_faces[0].image_uris.normal,'https://cards.scryfall.io/back.jpg');assert.equal(d.data[0].prices.usd,null);assert.ok(d.data[0]._fetchedAt);
  }finally{await new Promise(r=>server.close(r));for(const f of ['facts.json','facts.json.tmp']){const p=path.join(cacheRoot,f);if(fs.existsSync(p))fs.unlinkSync(p);}if(fs.existsSync(cacheRoot))fs.rmdirSync(cacheRoot);}
});
test('Workbench assets and route are included in the service worker and private API is excluded',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
  for(const asset of ['workbench-core','workbench'])assert.ok(html.includes('js/'+asset+'.js')&&sw.includes("'"+asset+"'"));
  assert.ok(html.includes('css/workbench.css')&&sw.includes('css/workbench.css'));assert.ok(sw.includes("url.pathname.startsWith('/api/')"));assert.ok(app.includes('Workbench.mount(el)'));
});
test('Workbench backup roundtrip validates drafts and rejects corrupt quantities and collection records',()=>{
  const vm=require('node:vm'),ctx={window:{WorkbenchCore:C},localStorage:{getItem:()=>null}};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workbench.js'),'utf8')+';this.WB=Workbench;',ctx);
  const backup={app:'aether-workbench',version:1,active:'test',drafts:[{id:'test',name:'Test',format:'commander',cards:[{n:'Sol Ring',q:1,zone:'main'}]}],custom:{snapshot,ledger}};
  assert.doesNotThrow(()=>ctx.WB.validateBackup(JSON.parse(JSON.stringify(backup))));
  assert.throws(()=>ctx.WB.validateBackup({...backup,drafts:[{id:'bad',name:'Bad',cards:[{n:'Sol Ring',q:0,zone:'main'}]}]}));
  assert.throws(()=>ctx.WB.validateBackup({...backup,custom:{snapshot:{schemaVersion:1,records:[{name:'Sol Ring',quantity:-1}]},ledger}}));
});
