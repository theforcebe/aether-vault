'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../js/printings'),C=require('../js/workbench-core');
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const normal={id,finish:'normal',set:'TST',collectorNumber:'1',setName:'Test Set'},foil={...normal,finish:'foil'},etched={...normal,id:other,collectorNumber:'2',finish:'etched'};
const row=(p,q=1,binder='Extras',proxy=false)=>({name:'Test Card',scryfallId:p.id,set:p.set,collectorNumber:p.collectorNumber,finish:p.finish,quantity:q,binder,binderType:'binder',proxy});
function context(){const memory={},ctx=vm.createContext({window:{Printings:P,WorkbenchCore:C},localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>{memory[k]=v;}},console,setTimeout,clearTimeout,Scry:{img:(id)=>'https://cards.scryfall.io/'+id},URL});for(const [file,name] of [['store','Store'],['ui','UI'],['workbench','Workbench']])vm.runInContext(fs.readFileSync(require.resolve('../js/'+file+'.js'),'utf8')+'\nglobalThis.'+name+'='+name,ctx);return ctx;}
test('Same Scryfall ID separates finishes and merges only identical physical versions',()=>{
 const groups=P.groups([row(normal,2),row(foil,1),row(normal,3,'Deck'),row(foil,4,'Extras',true)],r=>r.binder==='Extras');
 assert.equal(groups.length,2);assert.equal(groups[0].quantity,5);assert.equal(groups[0].eligible,2);assert.equal(groups[1].quantity,1);assert.equal(groups[1].proxyQuantity,4);assert.notEqual(P.key(normal),P.key(foil));
});
test('Pricing never substitutes finishes; absent, malformed and negative prices stay unknown',()=>{
 const f={prices:{usd:null,usd_foil:'2.34',usd_etched:'5.67'}};
 assert.equal(P.cents(f),null);assert.equal(P.cents(f,'foil'),234);assert.equal(P.cents(f,'etched'),567);
 for(const value of [undefined,null,'','bad',-1])assert.equal(P.cents({usd:value}),null);
 assert.equal(P.cents({usd:'0.00'}),0);
});
test('Wrong printing metadata cannot supply art style, set name or a price',()=>{
 const f={id:other,set_name:'Wrong Set',border_color:'borderless',prices:{usd:'100'}};
 assert.equal(P.metadata(normal,f).fact,null);assert.deepEqual(P.metadata(normal,f).styles,[]);assert.equal(P.metadata(normal,f).setName,'Test Set');
 const correct={...f,id,set_name:'Correct Set',full_art:true,frame_effects:['showcase']};
 assert.deepEqual(P.metadata(normal,correct).styles,['Borderless','Full art','Showcase']);assert.match(P.label(normal,correct),/Correct Set.*TST.*#1.*Non-foil/);
});
test('Choosing one of several copies splits a deck entry; reselecting merges without losing copies',()=>{
 const cards=[{n:'Test Card',q:4,zone:'main'}];P.choose(cards,0,foil,1);
 assert.equal(cards.length,2);assert.equal(cards[0].q,3);assert.equal(cards[1].printing.finish,'foil');
 P.choose(cards,0,foil,2);assert.equal(cards.length,2);assert.equal(cards[1].q,3);
 P.choose(cards,1,null,3);assert.deepEqual(cards,[{n:'Test Card',q:4,zone:'main'}]);
 assert.throws(()=>P.choose(cards,0,foil,5));assert.throws(()=>P.choose(cards,0,foil,1.5));
});
test('Format conversion, Decks roundtrip, and combo discovery preserve copies across versions',()=>{
 const d={name:'Mixed',format:'commander',cards:[{n:'Test Card',q:1,zone:'commander',printing:foil},{n:'Test Card',q:2,zone:'main',printing:normal}]};
 C.setFormat(d,'standard');assert.equal(d.cards.length,2);assert.equal(C.comboPayload(d).main[0].quantity,3);
 const copy=C.fromStoredDeck({name:'Saved',format:'standard',cards:d.cards,sideboard:[{n:'Test Card',q:1,printing:etched}]});
 assert.deepEqual(copy.cards.map(c=>c.printing.finish),['foil','normal','etched']);
 assert.equal(C.fromStoredDeck({name:'Old',cards:[{n:'Test Card',q:1,sid:id}]}).cards[0].printing,undefined);
});
test('Exact-version coverage shares copies across zones and excludes proxies',()=>{
 const inv=C.inventory({records:[row(normal,2),row(foil,1),row(etched,5,'Extras',true)]},{availableBinders:['Extras'],decks:[]});
 const rows=P.coverage([{n:'Test Card',q:2,zone:'main',printing:foil},{n:'Test Card',q:1,zone:'sideboard',printing:foil},{n:'Test Card',q:2,zone:'main',printing:normal},{n:'Test Card',q:1,zone:'main',printing:etched},{n:'Unknown',q:2,zone:'main'}],inv,{[id]:{id,prices:{usd:'1.00',usd_foil:'4.00'}},[other]:{id:other,prices:{usd:'99',usd_etched:null}}});
 assert.equal(rows[0].q,3);assert.equal(rows[0].notOwned,2);assert.equal(rows[0].unitCents,400);assert.equal(rows[1].notOwned,0);assert.equal(rows[2].owned,0);assert.equal(rows[2].unitCents,null);assert.equal(rows[3].unitCents,null);assert.equal(rows[3].notOwned,null);
});
test('Store uses exact prices and preserves separate finish selections through edits and backup data',()=>{
 const {Store:S}=context();S.state.prices[id]={usd:null,usd_foil:4,usd_etched:null};S.state.resolved['test card']={sid:other,usd:99,usd_etched:88};
 assert.equal(S.knownCardValue('Test Card',id),null);assert.equal(S.knownCardValue('Test Card',id,'foil'),4);assert.equal(S.knownCardValue('Test Card',id,'etched'),null);
 const d=S.createUserDeck('Mixed',[{n:'Test Card',q:2,printing:foil},{n:'Test Card',q:1,printing:normal}],'',{format:'standard',sideboard:[{n:'Test Card',q:1,printing:etched}]});
 S.addToUserDeck(d.id,'Test Card',1,'main',foil);assert.equal(d.cards[0].q,3);assert.equal(d.cards[1].q,1);assert.equal(d.cards[0].sid,id);assert.equal(d.sideboard[0].sid,other);
 S.setUserQty(d.id,'Test Card',0,'main',normal);assert.equal(d.cards.length,1);assert.equal(d.cards[0].printing.finish,'foil');assert.equal(S.userDeckTotal(d.id),100);
 assert.equal(JSON.parse(JSON.stringify(d)).sideboard[0].printing.finish,'etched');
});
test('Collection renders separate art and list rows with exact set, number, finish and prices; filters count matching rows only',()=>{
 const {Store:S,UI}=context();S.state.mycollection={label:'Fixture',rows:[{n:'Test Card',q:2,sid:id,s:'TST',cn:'1',f:'',b:'Extras'},{n:'Test Card',q:1,sid:id,s:'TST',cn:'1',f:'foil',b:'Deck A'},{n:'Test Card',q:1,sid:other,s:'TST',cn:'2',f:'etched',b:'Extras'}]};S.state.prices[id]={id,set:'tst',collector_number:'1',set_name:'Test Set',usd:1,usd_foil:5};S.state.prices[other]={id:other,usd_etched:null};
 const list=UI.viewCollection({mode:'list'});assert.equal((list.match(/class="list-row"/g)||[]).length,3);for(const label of ['Test Set','#1','#2','Non-foil','Foil','Etched foil','$1.00','$5.00','Unknown'])assert.ok(list.includes(label),label);
 const foilOnly=UI.viewCollection({finish:'foil',mode:'list'});assert.equal((foilOnly.match(/class="list-row"/g)||[]).length,1);assert.ok(foilOnly.includes('$5.00'));
 const binder=UI.viewCollection({binder:'Extras',mode:'grid'});assert.equal((binder.match(/class="c-card"/g)||[]).length,2);assert.ok(!binder.includes('$5.00'));
});
test('Workbench backup keeps version selections and rejects malformed IDs and finishes',()=>{
 const {Workbench:W}=context(), backup={app:'aether-workbench',version:1,drafts:[{id:'a',name:'A',cards:[{n:'Test Card',q:1,zone:'main',printing:foil}]}]};
 W.validateBackup(backup);const corrupt=JSON.parse(JSON.stringify(backup));corrupt.drafts[0].cards[0].printing.finish='rainbow';assert.throws(()=>W.validateBackup(corrupt));corrupt.drafts[0].cards[0].printing= {...normal,id:'not-an-id'};assert.throws(()=>W.validateBackup(corrupt));
});
test('Unassigned Workbench copies stay unpriced on Decks instead of assuming a finish',()=>{
 const {Store:S,UI}=context();S.state.prices[id]={usd:50,usd_foil:100};
 const d=S.createUserDeck('Unassigned',[{n:'Test Card',q:2,sid:id,printing:null}],'',{format:'standard'});
 assert.equal(d.cards[0].printing,null);assert.equal(S.knownDeckCardValue(d.cards[0]),null);assert.match(UI.viewDecks(),/2 unpriced/);
});
test('Full printing lookups synchronize exact prices and metadata without overwriting newer observations',()=>{
 const {Store:S}=context();S.state.prices[id]={usd:99,_fetchedAt:'2026-10-30T12:00:00Z'};
 S.cachePrintingFacts([{id,set:'tst',set_name:'Older',_fetchedAt:'2026-10-29T12:00:00Z',prices:{usd:'1'}}]);assert.equal(S.state.prices[id].usd,99);
 S.cachePrintingFacts([{id,set:'tst',set_name:'New Set',collector_number:'1',_fetchedAt:'2026-10-31T12:00:00Z',prices:{usd:null,usd_foil:'12.50',usd_etched:null}}]);
 assert.equal(S.state.prices[id].set_name,'New Set');assert.equal(S.knownCardValue('Test Card',id),null);assert.equal(S.knownCardValue('Test Card',id,'foil'),12.5);
});
test('Importing a physical binder retains two finishes of the same printing',()=>{
 const {Store:S}=context();S.state.mycollection={rows:[{n:'Test Card',q:2,sid:id,s:'TST',cn:'1',f:'',b:'Extras'},{n:'Test Card',q:1,sid:id,s:'TST',cn:'1',f:'foil',b:'Extras'}]};
 const d=S.importBinderAsDeck('Extras');assert.equal(d.cards.length,2);assert.equal(d.cards[0].printing.finish,'normal');assert.equal(d.cards[1].printing.finish,'foil');
});
test('Holdings and movers never combine different printings or discard another finish of the same ID',()=>{
 const {Store:S}=context();S.state.mycollection={rows:[{n:'Test Card',q:2,sid:id,s:'TST',cn:'1',f:'',b:'Extras'},{n:'Test Card',q:1,sid:id,s:'TST',cn:'1',f:'foil',b:'Extras'},{n:'Test Card',q:1,sid:other,s:'TST',cn:'2',f:'',b:'Extras'}]};
 S.state.prev={[id]:{usd:1,usd_foil:2},[other]:{usd:10}};S.state.prices={[id]:{usd:2,usd_foil:4},[other]:{usd:20}};
 assert.equal(S.movers().length,3);assert.equal(S.topHoldings().length,3);assert.equal(S.topHoldings().reduce((sum,c)=>sum+c.total,0),28);
});
