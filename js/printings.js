/* Exact physical versions. Rules identity stays independent of printing/finish. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Printings=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const finish = value => value==='nonfoil'||!value ? 'normal' : value;
  const finishLabel = value => ({normal:'Non-foil',foil:'Foil',etched:'Etched foil'}[finish(value)] || 'Unknown finish');
  function selection(row) {
    if(!row)return null;
    if(row.printing)return selection(row.printing);
    const id=row.id || row.scryfallId || row.sid || '';
    const set=row.set || row.s || '', collectorNumber=String(row.collectorNumber ?? row.collector_number ?? row.cn ?? '');
    if(!id && !(set&&collectorNumber))return null;
    return {id,finish:finish(row.finish ?? row.f),set:set.toUpperCase(),collectorNumber,setName:row.setName || row.set_name || ''};
  }
  function key(row) {
    const p=selection(row);return p ? (p.id || p.set.toLowerCase()+':'+p.collectorNumber)+'|'+p.finish : 'unspecified';
  }
  const entryKey = c => String(c.n || c.name || '').toLowerCase().trim()+'|'+(c.zone || 'main')+'|'+(c.printing?key(c.printing):'unspecified');
  function metadata(p,f) {
    p=selection(p); if(!p)return null;
    // Never decorate or price one printing using the name cache for another.
    const matches=f && (p.id ? (f.id || f.sid)===p.id : String(f.set || '').toUpperCase()===p.set && String(f.collector_number)===p.collectorNumber);
    return {...p,setName:matches ? f.set_name || p.setName : p.setName,styles:matches?styles(f):[],fact:matches?f:null};
  }
  function styles(f) {
    const out=[];
    if(f?.border_color==='borderless')out.push('Borderless');
    if(f?.full_art)out.push('Full art');
    const labels={showcase:'Showcase',extendedart:'Extended art',inverted:'Inverted',etched:'Etched treatment',shatteredglass:'Shattered glass',retro:'Retro frame',textless:'Textless'};
    for(const x of f?.frame_effects || [])if(labels[x])out.push(labels[x]);
    if(f?.frame==='1993'||f?.frame==='1997')out.push('Retro frame');
    for(const x of f?.promo_types || [])if(['serialized','surgefoil','galaxyfoil','textured','rainbowfoil','confettifoil','gilded','stepandcompleat'].includes(x))out.push(({surgefoil:'Surge foil',galaxyfoil:'Galaxy foil',rainbowfoil:'Rainbow foil',confettifoil:'Confetti foil',stepandcompleat:'Step-and-compleat foil'})[x] || x[0].toUpperCase()+x.slice(1));
    if(f?.textless)out.push('Textless');
    return [...new Set(out)];
  }
  function label(p,f,includeFinish=true) {
    const m=metadata(p,f);if(!m)return 'Version not selected';
    return [m.setName || m.set || 'Unknown set',m.setName&&m.set?'('+m.set+')':'',m.collectorNumber?'#'+m.collectorNumber:'Collector number unknown',includeFinish?finishLabel(m.finish):''].filter(Boolean).join(' · ');
  }
  function cents(f,selectedFinish='normal') {
    const field={normal:'usd',foil:'usd_foil',etched:'usd_etched'}[finish(selectedFinish)];
    if(!f||!field)return null;
    const value=f.prices ? f.prices[field] : f[field];
    if(value==null||value===''||!Number.isFinite(Number(value))||Number(value)<0)return null;
    return Math.round(Number(value)*100);
  }
  function groups(rows,eligible=()=>false) {
    const map=new Map();
    for(const r of rows){const p=selection(r), id=key(r);if(!map.has(id))map.set(id,{printing:p,key:id,quantity:0,eligible:0,proxyQuantity:0,records:[],binders:[]});const v=map.get(id),q=r.quantity ?? r.q ?? 0;
      v.records.push(r);const binder=r.binder ?? r.b ?? '';if(binder&&!v.binders.includes(binder))v.binders.push(binder);
      if(r.proxy)v.proxyQuantity+=q;else{v.quantity+=q;if(eligible(r))v.eligible+=q;}
    }
    return [...map.values()];
  }
  function add(cards,card) {
    const id=entryKey(card), old=cards.find(c=>entryKey(c)===id);
    if(old)old.q+=card.q;else cards.push({...card,...(card.printing?{printing:selection(card.printing)}:{})});
  }
  function choose(cards,index,printing,quantity) {
    const current=cards[index];if(!current)throw Error('Deck entry not found. Reopen the card.');
    if(!Number.isInteger(quantity)||quantity<1||quantity>current.q)throw Error('Choose between 1 and '+current.q+' copies.');
    const changed={...current,q:quantity};if(printing)changed.printing=selection(printing);else delete changed.printing;
    current.q-=quantity;if(!current.q)cards.splice(index,1);add(cards,changed);
  }
  function validate(p) {
    return p && typeof p==='object' && typeof p.id==='string' && (!p.id || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.id)) && ['normal','foil','etched'].includes(p.finish) && typeof p.set==='string' && p.set.length<=12 && typeof p.collectorNumber==='string' && p.collectorNumber.length<=30 && (p.id || (p.set&&p.collectorNumber)) && (p.setName===undefined || typeof p.setName==='string'&&p.setName.length<=200);
  }
  function coverage(cards,inventory,byId) {
    const map=new Map();
    for(const c of cards){const id=inventory.canonical(c.n)+'|'+key(c.printing);if(!map.has(id))map.set(id,{...c,q:0});map.get(id).q+=c.q;}
    return [...map.values()].map(c=>{
      const version=c.printing ? groups(inventory.get(c.n).records).find(v=>v.key===key(c.printing)) : null;
      const metadataForCard=metadata(c.printing,byId[c.printing?.id]);
      const unitCents=metadataForCard ? cents(metadataForCard.fact,c.printing.finish) : null;
      return {...c,owned:version?.quantity || 0,notOwned:c.printing?Math.max(0,c.q-(version?.quantity || 0)):null,unitCents};
    });
  }
  return {finish,finishLabel,selection,key,entryKey,metadata,styles,label,cents,groups,add,choose,validate,coverage};
});
