'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const A=require('../js/collection-additions'),P=require('../js/printings'),C=require('../js/workbench-core');
const {commit}=require('./collection-additions'),{createServer}=require('./workbench-server'),{importCollection}=require('./mtg');
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const card={id,name:'Test Card',set:'tst',set_name:'Test Edition',collector_number:'12',lang:'en',games:['paper'],finishes:['nonfoil','foil'],prices:{usd:'1.00',usd_foil:'5.00'},_fetchedAt:new Date().toISOString()};
const etched={...card,id:other,collector_number:'13',finishes:['etched'],prices:{usd_etched:null}};
const entry=(changes={})=>({id,finish:'normal',quantity:1,binder:'Extras',binderType:'binder',condition:'near_mint',...changes});
const initial=()=>({schemaVersion:1,source:'original.csv',sha256:'original-csv-hash',importedAt:'2026-01-01',records:[{name:'Test Card',scryfallId:id,set:'TST',collectorNumber:'12',finish:'normal',quantity:2,binder:'Extras',binderType:'binder',proxy:false,language:'en',condition:'near_mint'}]});
const ledger={schemaVersion:1,availableBinders:['Extras'],decks:[]};
const options=s=>({requestId:crypto.randomUUID(),expectedRevision:A.revision(s)});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aether-add-test-')),collection=path.join(dir,'knowledge/collection');fs.mkdirSync(collection,{recursive:true});fs.writeFileSync(path.join(collection,'latest.json'),JSON.stringify(initial()));fs.writeFileSync(path.join(collection,'allocations.json'),JSON.stringify(ledger));return {dir,collection,cleanup(){assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'aether-add-test-'));fs.rmSync(dir,{recursive:true});}};}
test('Batch adds matching physical copies and separates edition, finish, condition, and binder',()=>{
  const original=initial(),before=JSON.stringify(original),r=A.apply(original,[entry({quantity:2}),entry({finish:'foil'}),entry({id:other,finish:'etched'}),entry({binder:'Deck',binderType:'deck'}),entry({condition:'played'})],[card,etched],options(original));
  assert.equal(r.added,6);assert.equal(r.snapshot.records.length,5);assert.equal(r.snapshot.records[0].quantity,4);assert.equal(r.snapshot.totalQuantity,8);assert.equal(r.snapshot.sha256,original.sha256);assert.equal(r.snapshot.importedAt,original.importedAt);assert.equal(JSON.stringify(original),before);assert.equal(r.snapshot.records[2].setName,'Test Edition');
});
test('Unsupported finish, unresolved printing, proxies, digital cards, and invalid quantities cannot partially apply',()=>{
  for(const entries of [[entry(),entry({finish:'etched'})],[entry({id:other})],[entry({quantity:0})],[entry({quantity:1.5})],[entry({quantity:1001})],[entry({id:'bad'})],[entry({binderType:'other'})],[entry({condition:'invented'})]]){
    const s=initial(),before=JSON.stringify(s);assert.throws(()=>A.apply(s,entries,[card],options(s)));assert.equal(JSON.stringify(s),before);
  }
  const s=initial();assert.throws(()=>A.apply(s,[entry()],[{...card,games:['arena']}],options(s)),/paper/);
  s.records[0].proxy=true;assert.equal(A.apply(s,[entry()],[card],options(s)).snapshot.records.length,2);
});
test('Receipts make retries idempotent, reject changed payloads, and detect stale inventory',()=>{
  const s=initial(),opts=options(s),first=A.apply(s,[entry()],[card],opts);
  const replay=A.apply(first.snapshot,[entry()],[],opts);assert.equal(replay.replayed,true);assert.equal(replay.snapshot.totalQuantity,3);
  assert.throws(()=>A.apply(first.snapshot,[entry({quantity:2})],[card],opts),/different cards/);
  assert.throws(()=>A.apply(first.snapshot,[entry()],[card],options(s)),/collection changed/);
});
test('Local commits archive the previous snapshot, preserve CSV provenance and ledger, and survive restart/retry',()=>{
  const f=fixture();try{const file=path.join(f.collection,'latest.json'),before=fs.readFileSync(file,'utf8'),ledgerBefore=fs.readFileSync(path.join(f.collection,'allocations.json'),'utf8'),opts=options(initial());
    const r=commit(f.dir,[entry({finish:'foil',quantity:3})],[card],opts);assert.equal(r.snapshot.totalQuantity,5);
    const archived=fs.readdirSync(path.join(f.collection,'snapshots'));assert.equal(archived.length,1);assert.equal(fs.readFileSync(path.join(f.collection,'snapshots',archived[0]),'utf8'),before);
    const again=commit(f.dir,[entry({finish:'foil',quantity:3})],[],opts);assert.equal(again.replayed,true);assert.equal(JSON.parse(fs.readFileSync(file)).totalQuantity,5);
    assert.equal(fs.readFileSync(path.join(f.collection,'allocations.json'),'utf8'),ledgerBefore);
    assert.throws(()=>commit(f.dir,[entry()],[card],options(initial())),/collection changed/);assert.equal(JSON.parse(fs.readFileSync(file)).totalQuantity,5);
  }finally{f.cleanup();}
});
test('CSV export roundtrips exact editions, finishes, quantities, locations, language, condition and proxies',()=>{
  const f=fixture();try{const s=A.apply(initial(),[entry({finish:'foil'}),entry({id:other,finish:'etched'})],[card,etched],options(initial())).snapshot;s.records[0].name='A, "Quoted" Card';s.records[0].proxy=true;s.records[0].language='ja';
    const file=path.join(f.dir,'export.csv');fs.writeFileSync(file,A.csv(s));const read=importCollection(file);assert.deepEqual(read.records,s.records.map(({setName,...r})=>r));
  }finally{f.cleanup();}
});
function browser(mode='browser',seed={}) {
  const memory={av_collection_source:mode,...seed},ctx=vm.createContext({window:{Printings:P,WorkbenchCore:C,CollectionAdditions:A},location:{hash:'#/collection'},localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>{if(ctx.full)throw Error('Storage full');memory[k]=v;},removeItem:k=>delete memory[k]},console,setTimeout,clearTimeout,AbortSignal,crypto,URL,URLSearchParams,fetch:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>String(url).endsWith('/status')?{local:true}:{snapshot:initial(),ledger}})});
  for(const [file,name] of [['store','Store'],['builder','Builder'],['workbench','Workbench'],['collection-ui','CollectionUI']])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8')+';globalThis.'+name+'='+name,ctx);
  return {ctx,memory};
}
test('Local collection view is shared by Collection/Workbench without replacing or syncing browser data',async()=>{
  const original={label:'Browser separate',rows:[{n:'Other Card',q:4,b:'Extras',bt:'binder',sid:other}]},b=browser('local',{av_mycollection:JSON.stringify(original)});
  await b.ctx.Workbench.prepareCollection();assert.equal(b.ctx.Store.rows()[0].n,'Test Card');assert.equal(b.ctx.Store.byName.testcard.qty,2);assert.equal(b.memory.av_mycollection,JSON.stringify(original));
  assert.match(b.ctx.CollectionUI.header(),/Add cards/);assert.match(b.ctx.CollectionUI.header(),/Collection on this computer/);
  await b.ctx.Workbench.useCollectionSource('browser');assert.equal(b.ctx.Store.rows()[0].n,'Other Card');assert.equal(b.ctx.Store.byName.othercard.qty,4);
});
test('Browser save updates both views, survives reload, deduplicates retry and fails safely on storage quota',async()=>{
  const b=browser();await b.ctx.Workbench.prepareCollection();const c=await b.ctx.Workbench.collectionContext(),opts={...options(c.snapshot),mode:'browser'};
  b.ctx.full=true;await assert.rejects(()=>b.ctx.Workbench.addToCollection([entry()],[card],opts),/Storage full/);assert.equal(b.ctx.Store.rows().length,0);b.ctx.full=false;
  await b.ctx.Workbench.addToCollection([entry({quantity:3})],[card],opts);assert.equal(b.ctx.Store.byName.testcard.qty,3);assert.equal((await b.ctx.Workbench.collectionContext()).snapshot.records[0].quantity,3);
  const reload=browser('browser',b.memory);await reload.ctx.Workbench.prepareCollection();await reload.ctx.Workbench.addToCollection([entry({quantity:3})],[card],opts);assert.equal(reload.ctx.Store.byName.testcard.qty,3);
});
test('Workbench-upload additions preserve drafts and survive reload without changing browser source',async()=>{
  const saved={version:1,active:'a',drafts:[{id:'a',name:'Keep',cards:[{n:'Keep Card',q:1,zone:'main'}]}],custom:{snapshot:initial(),ledger}},b=browser('custom',{av_workbench_v1:JSON.stringify(saved)});await b.ctx.Workbench.prepareCollection();const c=await b.ctx.Workbench.collectionContext();await b.ctx.Workbench.addToCollection([entry({finish:'foil'})],[card],{...options(c.snapshot),mode:'custom'});
  assert.equal(b.ctx.Store.rows().length,2);assert.deepEqual(JSON.parse(b.memory.av_workbench_v1).drafts,saved.drafts);assert.equal(b.memory.av_mycollection,undefined);const reload=browser('custom',b.memory);await reload.ctx.Workbench.prepareCollection();assert.equal(reload.ctx.Store.byName.testcard.qty,3);
});
test('Refreshing shared inventory picks up another tab’s browser or Workbench-upload additions',async()=>{
  for(const mode of ['browser','custom']){
    const saved={version:1,active:'a',drafts:[{id:'a',name:'Keep',cards:[]}],custom:{snapshot:initial(),ledger}},b=browser(mode,{av_workbench_v1:JSON.stringify(saved)});await b.ctx.Workbench.prepareCollection();
    const changed=A.apply(initial(),[entry({quantity:4})],[card],options(initial())).snapshot;
    if(mode==='browser')b.memory.av_mycollection=JSON.stringify({label:'Changed in another tab',rows:A.toRows(changed),revision:changed.revision,additions:changed.additions});
    else b.memory.av_workbench_v1=JSON.stringify({...saved,custom:{snapshot:changed,ledger}});
    const current=await b.ctx.Workbench.collectionContext(true);assert.equal(current.snapshot.records[0].quantity,6);assert.equal(b.ctx.Store.byName.testcard.qty,6);
  }
});
test('New printing facts immediately support Collection type/color filters without a separate indexing pass',()=>{
  const b=browser();b.ctx.Store.cachePrintingFacts([{...card,type_line:'Instant',cmc:1,color_identity:['W'],oracle_text:'Exile target creature, then return it.'}]);
  const f=b.ctx.Store.card('Test Card');assert.equal(f.t,'Instant');assert.equal(f.ci,'W');assert.equal(b.ctx.Store.knownCardValue('Test Card',id,'foil'),5);
});
test('Search requests paper printings with a set constraint, preserves supported finishes and reports upstream failures',async()=>{
  let requested,status=200,data={data:[card,etched],total_cards:2,has_more:false};const ctx=vm.createContext({URLSearchParams,AbortSignal,setTimeout,fetch:async url=>{requested=url;return {ok:status<400,status,json:async()=>data};}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/scryfall.js'),'utf8')+';this.S=Scry;',ctx);
  const result=await ctx.S.searchPrintings('Test Card','TST');assert.equal(new URL(requested).searchParams.get('unique'),'prints');assert.match(new URL(requested).searchParams.get('q'),/game:paper lang:en set:TST/);assert.equal(result.data[1].finishes[0],'etched');
  status=404;assert.equal((await ctx.S.searchPrintings('Absent')).data.length,0);status=400;data={details:'Invalid query'};await assert.rejects(()=>ctx.S.searchPrintings('Test'),/Invalid query/);
});
test('Finish availability hides unsupported non-foil, foil, etched and digital versions without using prices as availability',()=>{
  assert.deepEqual(A.availableFinishes({...card,finishes:['nonfoil'],foil:true,prices:{usd_foil:'99.00'}}),['normal']);
  assert.deepEqual(A.availableFinishes({...card,finishes:['foil'],prices:{usd_foil:null}}),['foil']);
  assert.deepEqual(A.availableFinishes(etched),['etched']);
  assert.deepEqual(A.availableFinishes({...card,finishes:undefined}),[]);
  assert.deepEqual(A.availableFinishes({...card,games:['arena']}),[]);
  assert.throws(()=>A.verifyFinish({...card,finishes:['nonfoil']},'foil'),/not available/);
  assert.throws(()=>A.verifyFinish({...card,finishes:['foil']},'normal'),/not available/);
});
test('Copy shortcut preserves the exact printing and finish; unknown or mismatched versions require selection',()=>{
  assert.equal(A.exactCopy(card,{id,finish:'foil'}),'foil');
  assert.throws(()=>A.exactCopy(card,{id:other,finish:'foil'}),/exact owned printing/);
  assert.throws(()=>A.exactCopy(card,null),/exact owned printing/);
  assert.throws(()=>A.exactCopy({...card,finishes:['nonfoil']},{id,finish:'foil'}),/not available/);
  assert.throws(()=>A.exactCopy(etched,{id:other,finish:'normal'}),/not available/);
});
test('Copy actions encode the actual edition and finish and safely render card names',()=>{
  const b=browser(),html=b.ctx.CollectionUI.copyButton('A "Card" <name>',{id,finish:'foil',set:'TST',collectorNumber:'12'});
  assert.match(html,/Add copies/);assert.match(html,/data-copy-printing=/);assert.match(html,/&quot;finish&quot;:&quot;foil&quot;/);assert.match(html,/&lt;name&gt;/);assert.ok(!html.includes('<name>'));
});
test('Exact printing lookup never substitutes a different printing and retains authoritative finish support',async()=>{
  let status=200,data={...card,finishes:['nonfoil']},calls=[];
  const ctx=vm.createContext({URLSearchParams,AbortSignal,setTimeout,fetch:async url=>{calls.push(url);return {ok:status===200,status,json:async()=>data};}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/scryfall.js'),'utf8')+';this.S=Scry;',ctx);
  const found=await ctx.S.printingById(id);assert.equal(calls[0],'https://api.scryfall.com/cards/'+id);assert.deepEqual(A.availableFinishes(found),['normal']);assert.ok(found._fetchedAt);
  data={...card,id:other};await assert.rejects(()=>ctx.S.printingById(id),/exact paper printing/);
  status=404;data={details:'Printing not found'};await assert.rejects(()=>ctx.S.printingById(id),/Printing not found/);
  await assert.rejects(()=>ctx.S.printingById(''),/no exact printing ID/);
});
test('Adding existing and alternate editions updates Builder, Decks, Standard coverage, exact values and protected inventory',async()=>{
  const b=browser('browser',{av_mycollection:JSON.stringify({label:'Owned cards',rows:A.toRows(initial())})});await b.ctx.Workbench.prepareCollection();
  const S=b.ctx.Store,W=b.ctx.Workbench,B=b.ctx.Builder;
  const draft={name:'Standard copies',format:'standard',cards:[{n:'Test Card',q:3,zone:'main'},{n:'Test Card',q:1,zone:'sideboard'}]};
  const saved=S.createUserDeck('Saved deck',[{n:'Test Card',q:3}],'',{format:'standard',sideboard:[{n:'Test Card',q:1}]});
  const beforeDeck=JSON.stringify(saved),before=B.compare([{n:'Test Card',q:4}]);assert.equal(before.needCount,2);
  async function add(entries,cards){const current=await W.collectionContext();return W.addToCollection(entries,cards,{...options(current.snapshot),mode:'browser'});}
  await add([entry()],[card]);assert.equal(S.rows().length,1);assert.equal(S.rows()[0].q,3);assert.equal(B.compare([{n:'Test Card',q:4}]).needCount,1);
  await add([entry({finish:'foil'})],[card]);assert.equal(S.rows().length,2);assert.equal(S.byName.testcard.qty,4);assert.equal(B.compare([{n:'Test Card',q:4}]).needCount,0);assert.equal(S.missingFromCollection(S.deckCards(saved)).length,0);assert.equal(S.collectionTotal(),8);
  const different={...card,id:other,set:'alt',collector_number:'91',finishes:['nonfoil'],prices:{usd:'2.00'}};
  await add([entry({id:other,binder:'Protected',binderType:'deck'})],[different]);
  const current=await W.collectionContext(),inv=C.inventory(current.snapshot,current.ledger);
  assert.equal(S.rows().length,3);assert.equal(S.byName.testcard.qty,5);assert.equal(inv.get('Test Card').available,4);
  assert.equal(C.coverage(draft.cards,inv,true)[0].missing,0);assert.equal(C.coverage([{n:'Test Card',q:5,zone:'main'}],inv,true)[0].missing,1);
  const exact=P.coverage([{n:'Test Card',q:2,printing:{id,finish:'foil',set:'TST',collectorNumber:'12'},zone:'main'}],inv,{[id]:card});assert.equal(exact[0].owned,1);assert.equal(exact[0].notOwned,1);assert.equal(exact[0].unitCents,500);
  assert.equal(JSON.stringify(S.userDeck(saved.id)),beforeDeck);
});
test('Local addition API verifies all versions, persists once, rejects conflicts and foreign origins, and keeps files private',async()=>{
  const f=fixture(),port=18789;let calls=0;const server=createServer({port,vaultRoot:f.dir,cacheRoot:path.join(f.dir,'cache'),api:async(url,opts)=>{calls++;return {data:JSON.parse(opts.body).identifiers.map(e=>e.id===id?card:etched),not_found:[]};}});await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const base='http://127.0.0.1:'+port,post=(body,headers={})=>fetch(base+'/api/workbench/collection-add',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try{const body={entries:[entry({finish:'foil',quantity:2}),entry({id:other,finish:'etched'})],...options(initial())};
    assert.equal((await post(body,{Origin:'https://foreign.example'})).status,403);assert.equal((await post(body,{'Content-Type':'text/plain'})).status,415);assert.equal(calls,0);
    const r=await post(body);assert.equal(r.status,200);const value=await r.json();assert.equal(value.added,3);assert.equal(value.snapshot.totalQuantity,5);
    const refreshed=await fetch(base+'/api/workbench/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifiers:[{id}]})});assert.equal((await refreshed.json()).data[0].prices.usd_foil,'5.00');assert.equal(calls,1);
    assert.equal((await (await post(body)).json()).replayed,true);assert.equal(calls,1);
    assert.equal((await post({...body,requestId:crypto.randomUUID()})).status,409);
    const invalid=await post({entries:[entry({finish:'etched'})],...options(value.snapshot)});assert.equal(invalid.status,400);assert.equal(JSON.parse(fs.readFileSync(path.join(f.collection,'latest.json'))).totalQuantity,5);
    assert.equal((await fetch(base+'/knowledge/collection/latest.json')).status,404);
    const current=await (await fetch(base+'/api/workbench/vault')).json();assert.equal(current.snapshot.records.find(r=>r.finish==='foil').quantity,2);
  }finally{await new Promise(r=>server.close(r));f.cleanup();}
});
