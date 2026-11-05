/* Physical inventory additions, shared by the browser and local companion. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CollectionAdditions=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const revision = s => s?.revision || s?.sha256 || s?.importedAt || 'empty';
  const assert = (ok,message) => {if(!ok)throw Error(message);};
  function validate(entries) {
    assert(Array.isArray(entries)&&entries.length>0&&entries.length<=200,'Queue between 1 and 200 versions.');
    return entries.map(e=>{
      assert(e&&uuid.test(e.id),'Choose a specific Scryfall printing.');
      assert(['normal','foil','etched'].includes(e.finish),'Choose a supported finish.');
      assert(Number.isSafeInteger(e.quantity)&&e.quantity>=1&&e.quantity<=1000,'Quantity must be a whole number from 1 to 1,000.');
      assert(typeof e.binder==='string'&&e.binder.trim()&&e.binder.length<=150&&!/[\x00-\x1f]/.test(e.binder),'Choose a valid binder.');
      assert(['binder','deck'].includes(e.binderType),'Choose a valid binder type.');
      assert(['near_mint','excellent','good','light_played','played','poor'].includes(e.condition),'Choose a card condition.');
      return {id:e.id.toLowerCase(),finish:e.finish,quantity:e.quantity,binder:e.binder.trim(),binderType:e.binderType,condition:e.condition};
    });
  }
  function receipt(snapshot,requestId,entries) {
    assert(typeof requestId==='string'&&uuid.test(requestId),'A valid addition request ID is required.');
    const normalized=validate(entries),signature=JSON.stringify(normalized);
    const old=(snapshot?.additions || []).find(r=>r.id===requestId);
    if(old)assert(old.signature===signature,'This saved request has different cards. Reopen Add cards.');
    return {normalized,signature,old};
  }
  const recordKey=r=>JSON.stringify([r.scryfallId,r.finish||'normal',r.binder,r.binderType||'binder',r.language||'en',r.condition||'near_mint',!!r.proxy]);
  function apply(snapshot,entries,cards,{requestId,expectedRevision,now=new Date().toISOString()}={}) {
    const {normalized,signature,old}=receipt(snapshot,requestId,entries);
    if(old)return {snapshot,added:old.quantity,replayed:true};
    assert(expectedRevision===revision(snapshot),'The collection changed. Refresh the collection and review your queue before saving again.');
    const byId=new Map(cards.map(c=>[c.id,c]));
    const additions=normalized.map(e=>{
      const c=byId.get(e.id);
      assert(c&&typeof c.name==='string'&&c.name.trim()&&c.set&&c.collector_number!=null,'A printing could not be verified. Search for that edition again.');
      assert(c.games?.includes('paper'),'Only paper cards can be added to this collection.');
      assert(c.finishes?.includes(e.finish==='normal'?'nonfoil':e.finish),'This printing is not available in the selected finish.');
      return {name:c.name,quantity:e.quantity,scryfallId:c.id,set:c.set.toUpperCase(),setName:c.set_name||'',collectorNumber:String(c.collector_number),finish:e.finish,binder:e.binder,binderType:e.binderType,proxy:false,language:c.lang||'en',condition:e.condition};
    });
    const records=(snapshot?.records||[]).map(r=>({...r})),index=new Map();
    for(const r of records)index.set(recordKey(r),r);
    for(const r of additions){const old=index.get(recordKey(r));if(old){assert(Number.isSafeInteger(old.quantity+r.quantity),'Collection quantity is too large.');old.quantity+=r.quantity;}else{records.push(r);index.set(recordKey(r),r);}}
    assert(records.length<=50000,'Collection exceeds the 50,000 row limit.');
    const added=additions.reduce((s,r)=>s+r.quantity,0);
    return {snapshot:{schemaVersion:1,source:'Manual collection',...snapshot,records,rowCount:records.length,totalQuantity:records.reduce((s,r)=>s+r.quantity,0),uniqueNames:new Set(records.map(r=>r.name.normalize('NFC').trim().toLowerCase())).size,revision:requestId,updatedAt:now,additions:[...(snapshot?.additions||[]),{id:requestId,signature,quantity:added,at:now}]},added,replayed:false};
  }
  const toRows=s=>(s?.records||[]).map(r=>({n:r.name,q:r.quantity,sid:r.scryfallId,s:r.set||'',setName:r.setName||'',cn:r.collectorNumber||'',f:r.finish==='normal'?'':r.finish,b:r.binder,bt:r.binderType,proxy:r.proxy,language:r.language,condition:r.condition}));
  function fromBrowser(collection) {
    return {schemaVersion:1,source:collection?.label||'Browser collection',importedAt:collection?.uploaded,revision:collection?.revision,additions:collection?.additions||[],records:(collection?.rows||[]).map(r=>({name:r.n,quantity:r.q,scryfallId:r.sid,set:r.s,collectorNumber:r.cn,setName:r.setName,finish:r.f||'normal',binder:r.b,binderType:r.bt||'binder',proxy:r.proxy===true,language:r.language||'en',condition:r.condition||'near_mint'}))};
  }
  function csv(snapshot) {
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const header=['Name','Quantity','Scryfall ID','Set code','Collector number','Foil','Binder Name','Binder Type','Proxy','Language','Condition'];
    return [header,...(snapshot?.records||[]).map(r=>[r.name,r.quantity,r.scryfallId,r.set,r.collectorNumber,r.finish||'normal',r.binder,r.binderType,!!r.proxy,r.language||'en',r.condition||'near_mint'])].map(row=>row.map(quote).join(',')).join('\r\n');
  }
  return {validate,revision,receipt,apply,toRows,fromBrowser,csv};
});
