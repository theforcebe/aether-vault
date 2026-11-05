/* Search, select physical editions, and save a batch to the active collection. */
const CollectionUI=(()=>{
  'use strict';
  const A=window.CollectionAdditions,P=window.Printings,KEY='av_collection_queue_v1';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=c=>c==null?'Price unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
  const uuid=()=>crypto.randomUUID();
  let modal,opener,context,entries=[],cardCache={},requestId=uuid(),pending=false,saving=false,error='',success='',wanted=[];
  let results=[],total=0,more=false,page=1,shown=24,selected=null,query='',setCode='',searched=false,searching=false,generation=0,timer;
  let destination='',expectedRevision,defaultBinder='Extras';
  function header() {
    const s=Workbench.collectionSources();
    return `<header class="collection-heading"><div><h1>Your collection</h1><p>Browse your cards or add the exact editions you own.</p></div><div class="collection-actions"><button class="btn primary" data-collection-add${s.ready?'':' disabled'}>Add cards</button><button class="btn" data-collection-export${s.ready?'':' disabled'}>Export collection CSV</button></div><label class="collection-source">Active collection<select data-collection-source${s.ready?'':' disabled'}>${s.options.map(([v,t])=>`<option value="${v}"${v===s.mode?' selected':''}>${esc(t)}</option>`).join('')}</select></label>${s.error?`<p role="alert">${esc(s.error)}</p>`:''}</header>`;
  }
  function persistQueue() {
    localStorage.setItem(KEY,JSON.stringify({version:1,entries,cards:Object.values(cardCache).filter(c=>entries.some(e=>e.id===c.id)),requestId,pending,destination,expectedRevision}));
  }
  function readQueue() {
    const raw=localStorage.getItem(KEY);if(!raw)return;
    const v=JSON.parse(raw);if(v.version!==1||!Array.isArray(v.entries)||!Array.isArray(v.cards))throw Error('The saved Add cards queue could not be read.');
    if(v.entries.length)A.receipt(null,v.requestId,v.entries);
    entries=v.entries;cardCache=Object.fromEntries(v.cards.map(c=>[c.id,c]));requestId=v.requestId;pending=!!v.pending;destination=v.destination;expectedRevision=v.expectedRevision;
  }
  function image(c,cls='') {
    const url=c.image_uris?.normal||c.card_faces?.[0]?.image_uris?.normal||Scry.img(c.id,'normal');
    return `<img class="${cls}" src="${esc(url)}" alt="${esc(c.name)}" loading="lazy" width="488" height="680">`;
  }
  const edition=c=>`${c.set_name || c.set} (${String(c.set).toUpperCase()}) · #${c.collector_number}`;
  const finishes=c=>(c.finishes||[]).filter(f=>['nonfoil','foil','etched'].includes(f)).map(f=>f==='nonfoil'?'normal':f);
  const owned=(id,finish)=>context.snapshot.records.filter(r=>!r.proxy&&r.scryfallId===id&&r.finish===finish).reduce((s,r)=>s+r.quantity,0);
  const control=(label,body)=>`<label class="ca-field">${label}${body}</label>`;
  function binders() {
    const map=new Map([['Extras','binder']]);
    for(const r of context.snapshot.records)if(r.binder)map.set(r.binder,r.binderType||'binder');
    for(const name of context.ledger.availableBinders||[])if(!map.has(name))map.set(name,'binder');
    return [...map].sort(([a],[b])=>a.localeCompare(b));
  }
  function finishFields(c,finish) {
    return `<fieldset class="ca-finishes"><legend>Finish</legend>${finishes(c).map(f=>`<label><input type="radio" name="ca-finish" value="${f}"${f===finish?' checked':''}><span>${P.finishLabel(f)}<strong>${money(P.cents(c,f))}</strong></span></label>`).join('')}</fieldset>`;
  }
  function detail(c) {
    const first=finishes(c)[0];
    return `<button class="btn small" data-ca="back">Back to printings</button><div class="ca-detail">${image(c)}<div><h3>${esc(c.name)}</h3><p>${esc(edition(c))}</p><p class="printing-style">${esc(P.styles(c).join(' · '))}</p><p class="ca-caption">English paper printing · ${esc(c.released_at||'')}</p>${finishFields(c,first)}<p id="ca-owned" class="ca-caption">${owned(c.id,first)} copies of this version already owned</p><div class="ca-detail-fields">${control('Quantity','<input id="ca-quantity" type="number" min="1" max="1000" step="1" value="'+Math.max(1,wanted.find(w=>w.n.toLowerCase()===c.name.toLowerCase())?.q||1)+'" inputmode="numeric">')}${control('Binder',`<select id="ca-binder">${binders().map(([name,type])=>`<option value="${esc(name)}"${name===defaultBinder?' selected':''}>${esc(name)}${type==='deck'?' (deck)':''}</option>`).join('')}</select>`)}${control('Condition','<select id="ca-condition"><option value="near_mint">Near mint</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="light_played">Light played</option><option value="played">Played</option><option value="poor">Poor</option></select>')}</div><p id="ca-binder-note" class="ca-caption"></p><button class="btn primary" data-ca="queue"${pending?' disabled':''}>Queue this version</button><p class="ca-caption">USD reference prices retrieved ${esc(new Date(c._fetchedAt).toLocaleDateString())}. Condition can affect resale value.</p></div></div>`;
  }
  function resultsHtml() {
    if(selected)return detail(selected);
    if(searching&&!results.length)return '<p class="ca-empty" role="status">Searching Scryfall printings…</p>';
    if(!searched)return '<div class="ca-empty"><h3>Start with a card name</h3><p>Search all English paper printings. Match the artwork, set code, and number printed along the bottom of your card.</p></div>';
    if(!results.length)return '<div class="ca-empty"><h3>No printings found</h3><p>Try a shorter card name or remove the set code.</p></div>';
    return `<p class="ca-result-count">${total.toLocaleString()} printings found · choose your edition</p><div class="ca-results">${results.slice(0,shown).map(c=>`<button class="ca-result" data-ca="select" data-id="${c.id}" aria-label="Choose ${esc(c.name)}, ${esc(edition(c))}">${image(c)}<strong>${esc(c.name)}</strong><span>${esc(c.set_name)}</span><span>${esc(String(c.set).toUpperCase())} · #${esc(c.collector_number)}</span><small>${esc(P.styles(c).join(' · '))}</small><small>${finishes(c).map(f=>P.finishLabel(f)).join(' / ')}</small></button>`).join('')}</div>${shown<results.length||more?`<button class="btn ca-more" data-ca="more"${searching?' disabled':''}>${searching?'Loading printings…':'Show more printings'}</button>`:''}`;
  }
  function queueHtml() {
    const count=entries.reduce((s,e)=>s+e.quantity,0);let cents=0,unknown=0;
    for(const e of entries){const p=P.cents(cardCache[e.id],e.finish);if(p==null)unknown+=e.quantity;else cents+=p*e.quantity;}
    return `<div class="ca-queue-heading"><h3>Your queue <span>${count}</span></h3>${entries.length?`<button class="ca-link" data-ca="clear"${pending?' disabled':''}>Clear</button>`:''}</div>${!entries.length?'<p class="ca-empty">Choose a printing, finish, and quantity. Queue as many cards as you need before saving.</p>':entries.map((e,i)=>{const c=cardCache[e.id];return `<article class="ca-queue-row">${image(c)}<div><strong>${esc(c.name)}</strong><p>${esc(edition(c))}</p><p class="ca-finish">${P.finishLabel(e.finish)} · ${money(P.cents(c,e.finish))} each</p><p>${esc(e.binder)} · ${esc(e.condition.replaceAll('_',' '))}</p><div class="ca-queue-controls"><label>Qty <input type="number" min="1" max="1000" step="1" inputmode="numeric" data-ca-qty="${i}" value="${e.quantity}" aria-label="Quantity of ${esc(c.name)} ${P.finishLabel(e.finish)}"${pending?' disabled':''}></label><button class="ca-link" data-ca="remove" data-index="${i}" aria-label="Remove ${esc(c.name)} ${P.finishLabel(e.finish)} from queue"${pending?' disabled':''}>Remove</button></div></div></article>`;}).join('')}<div class="ca-queue-total"><span>${count} ${count===1?'copy':'copies'} to add</span><strong>${money(cents)}${unknown?' + unpriced':''}</strong>${unknown?`<small>${unknown} copies have no price for the selected finish.</small>`:''}<small>Estimated collection value, not a purchase.</small></div>${pending?'<p class="ca-caption">This queue has a pending save. Retry safely to confirm it; the same batch cannot be added twice.</p>':''}`;
  }
  function paintResults() {if(!modal)return;modal.querySelector('#ca-results-area').innerHTML=resultsHtml();if(selected)binderNote();}
  function paintQueue() {if(!modal)return;modal.querySelector('#ca-queue').innerHTML=queueHtml();const count=entries.reduce((s,e)=>s+e.quantity,0),save=modal.querySelector('[data-ca="save"]');save.disabled=saving||!count||destination!==context.mode;save.textContent=saving?'Saving collection…':pending?'Retry save safely':`Add ${count||''} ${count===1?'card':'cards'} to collection`;}
  function feedback() {if(!modal)return;const el=modal.querySelector('#ca-feedback');el.textContent=error||success;el.className=error?'ca-feedback error':'ca-feedback';el.setAttribute('role',error?'alert':'status');}
  function binderNote() {const name=modal.querySelector('#ca-binder')?.value;if(!name)return;const free=context.ledger.availableBinders.includes(name),decks=context.ledger.decks.filter(d=>d.mode==='binder'&&d.binder===name);modal.querySelector('#ca-binder-note').textContent=decks.length?'These copies will be assigned to '+decks.map(d=>d.name).join(', ')+'.':free?'These copies are available for building.':'This binder is not marked free in the allocation ledger.';}
  async function search(append=false) {
    const current=++generation;selected=null;error='';success='';
    query=modal.querySelector('#ca-search').value.trim();setCode=modal.querySelector('#ca-set').value.trim();
    if(!append){results=[];shown=24;page=1;}
    searched=true;searching=true;paintResults();feedback();
    try {const r=await Scry.searchPrintings(query,setCode,page);if(current!==generation||!modal)return;results.push(...r.data);total=r.total_cards;more=r.has_more;}
    catch(e){if(current!==generation||!modal)return;error=e.name==='TimeoutError'?'Card search timed out. Try Search again.':e.message;}
    finally {if(current===generation&&modal){searching=false;paintResults();feedback();}}
  }
  function changed() {requestId=uuid();pending=false;expectedRevision=context.revision;destination=context.mode;error='';success='';persistQueue();paintQueue();feedback();}
  function queueSelected() {
    const quantity=Number(modal.querySelector('#ca-quantity').value),finish=modal.querySelector('[name="ca-finish"]:checked')?.value,binder=modal.querySelector('#ca-binder').value;
    const entry={id:selected.id,quantity,finish,binder,binderType:binders().find(([n])=>n===binder)?.[1]||'binder',condition:modal.querySelector('#ca-condition').value};
    A.validate([entry]);cardCache[selected.id]=selected;defaultBinder=binder;
    const same=entries.find(e=>e.id===entry.id&&e.finish===entry.finish&&e.binder===binder&&e.binderType===entry.binderType&&e.condition===entry.condition);
    if(same){if(same.quantity+quantity>1000)throw Error('A queued version can have at most 1,000 copies.');same.quantity+=quantity;}else{if(entries.length>=200)throw Error('Save this batch before adding more versions.');entries.push(entry);}
    changed();success=quantity+' '+selected.name+' '+P.finishLabel(finish)+' queued.';feedback();selected=null;paintResults();
  }
  async function save() {
    if(saving||!entries.length)return;
    error='';success='';saving=true;
    try {
      A.validate(entries);pending=true;persistQueue();paintQueue();feedback();
      const result=await Workbench.addToCollection(entries,Object.values(cardCache),{requestId,expectedRevision,mode:destination});
      // Mark the receipt before clearing. If storage fails, a retry uses the same ID.
      entries=[];pending=false;requestId=uuid();localStorage.removeItem(KEY);
      context=await Workbench.collectionContext();expectedRevision=context.revision;
      success=`${result.added} ${result.added===1?'copy':'copies'} saved to ${context.label}. Collection and Workbench are updated.`;
      App.refresh();
    } catch(e){if(e.status>=400&&e.status<500){pending=false;persistQueue();}error=e.name==='TimeoutError'?'The save response timed out. Retry safely to check whether it was saved.':e.message;}
    finally{saving=false;paintQueue();feedback();paintResults();}
  }
  function close() {if(saving)return;generation++;clearTimeout(timer);modal.close();modal.remove();modal=null;opener?.focus();}
  async function open(list=[]) {
    if(modal){modal.focus();return;}opener=document.activeElement;error='';success='';wanted=list;
    try {
      context=await Workbench.collectionContext(true);readQueue();
      if(!entries.length){destination=context.mode;expectedRevision=context.revision;pending=false;}
      if(destination!==context.mode&&entries.length)error='Your queue belongs to '+destination+' collection. Close this dialog and select that collection to save it, or clear the queue.';
      query=wanted[0]?.n||'';setCode='';results=[];selected=null;searched=false;searching=false;
      modal=document.createElement('dialog');modal.className='ca-dialog';modal.setAttribute('aria-labelledby','ca-title');
      modal.innerHTML=`<header class="ca-header"><div><h2 id="ca-title">Add cards to collection</h2><p>Saving to <strong>${esc(context.label)}</strong></p></div><button class="btn" data-ca="close" aria-label="Close Add cards">Close</button></header><form id="ca-search-form" class="ca-search-form">${control('Card name','<input id="ca-search" type="search" placeholder="Search any card, e.g. Cloudshift" value="'+esc(query)+'" autocomplete="off" minlength="2" maxlength="120" required>')}${control('Set code (optional)','<input id="ca-set" type="text" placeholder="e.g. LTR" maxlength="10" autocomplete="off">')}<button class="btn primary" type="submit">Search</button></form>${wanted.length?`<details class="ca-wanted"><summary>Choose editions for ${wanted.length} cards from your list</summary><div>${wanted.map(w=>`<button class="btn small" data-ca="wanted" data-name="${esc(w.n)}">${w.q} ${esc(w.n)}</button>`).join('')}</div></details>`:''}<div id="ca-feedback" class="ca-feedback" aria-live="polite"></div><div class="ca-body"><section id="ca-results-area" class="ca-search-area" aria-label="Choose a printing"></section><aside id="ca-queue" class="ca-queue" aria-label="Cards to add"></aside></div><footer class="ca-footer"><button class="btn" data-ca="refresh">Refresh collection</button><button class="btn primary" data-ca="save"></button></footer>`;
      document.body.append(modal);modal.showModal();paintResults();paintQueue();feedback();
      modal.querySelector('#ca-search-form').onsubmit=e=>{e.preventDefault();clearTimeout(timer);search();};
      modal.querySelector('#ca-search').oninput=()=>{clearTimeout(timer);generation++;if(modal.querySelector('#ca-search').value.trim().length>=2)timer=setTimeout(()=>search(),400);};
      modal.addEventListener('cancel',e=>{e.preventDefault();close();});
      modal.addEventListener('click',async e=>{
        const button=e.target.closest('[data-ca]');if(!button||button.disabled)return;
        const action=button.dataset.ca;
        try {
          if(action==='close')return close();
          if(saving)return;
          if(action==='select'){selected=results.find(c=>c.id===button.dataset.id);paintResults();modal.querySelector('#ca-results-area').scrollTop=0;modal.querySelector('[data-ca="back"]').focus();}
          if(action==='back'){selected=null;paintResults();}
          if(action==='queue')queueSelected();
          if(action==='remove'){entries.splice(Number(button.dataset.index),1);changed();}
          if(action==='clear'){entries=[];changed();}
          if(action==='more'){shown+=24;if(shown>results.length&&more){page++;await search(true);}else paintResults();}
          if(action==='save')await save();
          if(action==='wanted'){modal.querySelector('#ca-search').value=button.dataset.name;modal.querySelector('#ca-set').value='';await search();}
          if(action==='refresh'){context=await Workbench.collectionContext(true);expectedRevision=context.revision;persistQueue();success='Collection refreshed. Review your queue, then save.';error='';App.refresh();paintQueue();feedback();if(selected){const finish=modal.querySelector('[name="ca-finish"]:checked')?.value;modal.querySelector('#ca-owned').textContent=owned(selected.id,finish)+' copies of this version already owned';binderNote();}}
        }catch(err){error=err.message;feedback();paintQueue();}
      });
      modal.addEventListener('change',e=>{
        try{
          if(e.target.matches('[data-ca-qty]')){const i=Number(e.target.dataset.caQty),next={...entries[i],quantity:Number(e.target.value)};A.validate([next]);entries[i]=next;changed();}
          if(e.target.name==='ca-finish')modal.querySelector('#ca-owned').textContent=owned(selected.id,e.target.value)+' copies of this version already owned';
          if(e.target.id==='ca-binder')binderNote();
        }catch(err){error=err.message;feedback();paintQueue();}
      });
      modal.querySelector('#ca-search').focus();if(query)search();
    }catch(e){UI.toast(e.message);}
  }
  function install() {
    window.addEventListener('storage',async e=>{if(e.key!=='av_collection_changed')return;try{const change=JSON.parse(e.newValue);if(change.mode===Workbench.collectionSources().mode){await Workbench.collectionContext(true);App.refresh();}}catch(_){/* A disconnected companion is reported when opening the collection. */}});
    document.addEventListener('click',async e=>{
      if(e.target.closest('[data-collection-add]')){Workbench.close();return open();}
      if(e.target.closest('[data-collection-export]'))try{const c=await Workbench.collectionContext(true),blob=new Blob([A.csv(c.snapshot)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='aether-collection-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){UI.toast(err.message);}
    });
    document.addEventListener('change',async e=>{if(e.target.matches('[data-collection-source]'))try{await Workbench.useCollectionSource(e.target.value,true);}catch(err){UI.toast(err.message);App.refresh();}});
  }
  return {header,install,open};
})();
