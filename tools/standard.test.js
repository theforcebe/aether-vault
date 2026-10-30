'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const C=require('../js/workbench-core'), {createServer}=require('./workbench-server');
const now=Date.now(), fresh=new Date(now).toISOString();
const f=(name,extra={})=>({name,oracle_id:name.toLowerCase(),type_line:'Creature',color_identity:['R'],legalities:{standard:'legal'},_fetchedAt:fresh,...extra});
const facts={island:f('Island',{type_line:'Basic Land — Island'}),spell:f('Spell'),other:f('Other')};
const row=(n,q,zone='main')=>({n,q,zone});
const check=cards=>C.validateDeck({format:'standard',cards},facts,now);
test('Standard requires at least 60 main and at most 15 sideboard, with no commander or color identity rule',()=>{
  assert.equal(check([row('Island',60),row('Spell',4,'sideboard')]).issues.length,0);
  assert.equal(check([row('Island',61)]).issues.length,0);
  assert.ok(check([row('Island',59),row('Island',1,'sideboard')]).issues.some(x=>x.includes('at least 60')));
  assert.ok(check([row('Island',60),row('Island',16,'sideboard')]).issues.some(x=>x.includes('at most 15')));
  assert.equal(check([row('Island',60)]).ci,null);
  assert.ok(check([row('Island',60),row('Spell',1,'commander')]).issues.some(x=>x.includes('no command zone')));
});
test('Standard copy limits combine zones, printings and face aliases; Oracle exceptions override four',()=>{
  assert.equal(check([row('Island',57),row('Spell',3),row('Spell',1,'sideboard')]).issues.length,0);
  assert.ok(check([row('Island',56),row('Spell',4),row('Spell',1,'sideboard')]).issues.some(x=>x.includes('5 copies')));
  const alias=facts.spell;
  const r=C.validateDeck({format:'standard',cards:[row('Island',60),row('Spell',3),row('Back',2,'sideboard')]},{...facts,back:alias},now);
  assert.ok(r.issues.some(x=>x.includes('5 copies')));
  for(const [oracle_text,count,passes] of [['A deck can have any number of cards named Spell.',30,true],['A deck can have up to nine cards named Spell.',9,true],['A deck can have up to nine cards named Spell.',10,false]]){
    const result=C.validateDeck({format:'standard',cards:[row('Island',60),row('Spell',count)]},{...facts,spell:f('Spell',{oracle_text})},now);
    assert.equal(result.issues.length===0,passes);
  }
});
test('Bans, rotation and missing or stale legality data stay explicit, including the sideboard',()=>{
  for(const legality of ['banned','not_legal']){
    const result=C.validateDeck({format:'standard',cards:[row('Island',60),row('Spell',1,'sideboard')]},{...facts,spell:f('Spell',{legalities:{standard:legality}})},now);
    assert.ok(result.issues.some(x=>x.includes(legality.replace('_',' '))));
  }
  for(const bad of [undefined,f('Spell',{legalities:{}}),f('Spell',{_fetchedAt:undefined}),f('Spell',{_fetchedAt:new Date(now-86400001).toISOString()})]){
    const r=C.validateDeck({format:'standard',cards:[row('Island',60),row('Spell',1)]},{...facts,spell:bad},now);
    assert.equal(r.unresolved,1);assert.ok(r.issues.length);
  }
});
test('Changing format preserves every card and merges command-zone copies into main',()=>{
  const deck={cards:[row('Spell',1,'commander'),row('Spell',3),row('Spell',1,'sideboard')]};
  assert.equal(C.formatOf(deck),'commander');C.setFormat(deck,'standard');
  assert.deepEqual(deck.cards,[row('Spell',4),row('Spell',1,'sideboard')]);
  assert.deepEqual(C.parseDeck(C.deckText(deck)).cards,deck.cards);
});
test('Standard collection coverage shares owned copies across main and sideboard',()=>{
  const inv=C.inventory({records:[{name:'Spell',quantity:4,binder:'Extras',binderType:'binder',proxy:false}]},{availableBinders:['Extras'],decks:[]});
  const cards=[row('Spell',4),row('Spell',1,'sideboard')];
  assert.equal(C.coverage(cards,inv,true)[0].missing,1);
  assert.equal(C.coverage(cards,inv)[0].missing,0);
});
test('Commented export sections retain commanders and sideboard; combo payload omits sideboard and resolves faces',()=>{
  const p=C.parseDeck('// Commanders\n1 Godo, Bandit Warlord\n// Mainboard\n1 Front\n// Sideboard\n1 Spell\n// a regular comment');
  assert.deepEqual(p.cards.map(c=>c.zone),['commander','main','sideboard']);
  const deck={format:'commander',cards:p.cards}, payload=C.comboPayload(deck,{front:{name:'Front // Back'}});
  assert.deepEqual(payload,{main:[{card:'Front // Back',quantity:1}],commanders:[{card:'Godo, Bandit Warlord',quantity:1}]});
  const url=new URL(C.comboLink(deck,{front:{name:'Front // Back'}}));
  assert.equal(url.origin,'https://commanderspellbook.com');assert.equal(url.searchParams.get('decklist'),'1 Front // Back');assert.equal(url.searchParams.get('commanders'),'1 Godo, Bandit Warlord');
});
test('Stored Standard decks preserve sideboard through edits and backup, while legacy decks default to Commander',()=>{
  const memory={},ctx=vm.createContext({window:{},localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>{memory[k]=v;},removeItem:k=>{delete memory[k];}},console,setTimeout});
  vm.runInContext(fs.readFileSync(require.resolve('../js/store.js'),'utf8')+'\nglobalThis.Store=Store;',ctx);
  const S=ctx.Store, d=S.createUserDeck('Standard',[{n:'Spell',q:3}],'',{format:'standard',sideboard:[{n:'Spell',q:1}]});
  S.addToUserDeck(d.id,'Spell',1,'sideboard');assert.equal(d.cards[0].q,3);assert.equal(d.sideboard[0].q,2);
  S.setUserQty(d.id,'Spell',1,'sideboard');assert.equal(d.sideboard[0].q,1);
  const copy=C.fromStoredDeck(S.deckView(d.id));assert.equal(copy.format,'standard');assert.equal(copy.cards[1].zone,'sideboard');
  S.addPurchased([{n:'Spell',q:3}]);assert.equal(S.missingFromCollection(S.deckCards(d))[0].q,1);
  const saved=JSON.parse(memory.av_userdecks);S.importBackup({app:'aether-vault',userdecks:saved});
  assert.equal(S.userDeck(d.id).sideboard[0].q,1);assert.equal(S.deckView(d.id).format,'standard');
  S.state.userdecks.push({id:'old',name:'Legacy',commander:'Spell',cards:[{n:'Spell',q:1}]});
  assert.equal(S.deckView('old').format,'commander');assert.equal(S.deckView('old').cards[0].src,'commander');
  S.setUserFormat('old','standard');assert.equal(S.deckView('old').commander,'');assert.equal(S.userDeck('old').cards[0].q,1);
});
test('Combo requests complete while Scryfall work is blocked, and API errors are returned visibly',async()=>{
  const port=18788;let release, entered;
  const began=new Promise(r=>{entered=r;}), blocked=new Promise(r=>{release=r;});
  const server=createServer({port,cacheRoot:require('node:path').join(__dirname,'unused-test-cache'),api:async()=>{entered();await blocked;throw Error('test Scryfall unavailable');},comboFind:async deck=>{if(!deck.main)throw Error('Invalid combo deck');return {results:{included:[{id:'test-variant'}]}};}});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const post=(route,body)=>fetch('http://127.0.0.1:'+port+'/api/workbench/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  const slow=post('facts',{identifiers:[{name:'Test'}]});
  try{await began;const response=await post('combos',{main:[{card:'Test',quantity:1}]});assert.equal(response.status,200);assert.equal((await response.json()).results.included[0].id,'test-variant');
    const failed=await post('combos',{});assert.equal(failed.status,400);assert.match((await failed.json()).error,/Invalid combo deck/);
  }finally{release();await slow;await new Promise(r=>server.close(r));}
});
