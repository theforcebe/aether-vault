// Aether Vault: Scryfall API client.
// Respects documented limits: /cards/collection is 2 requests per second, 75 identifiers max.
// Browser User-Agent stays intact per Scryfall docs. Prices are daily estimates.

const Scry = (() => {
  const API = 'https://api.scryfall.com';
  let lastPost = 0;
  let lastGet = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function throttled(kind) {
    const now = Date.now();
    if (kind === 'post') {
      const wait = Math.max(0, lastPost + 560 - now);
      lastPost = now + wait;
      if (wait) await sleep(wait);
    } else {
      const wait = Math.max(0, lastGet + 130 - now);
      lastGet = now + wait;
      if (wait) await sleep(wait);
    }
  }

  async function post(path, body, tries = 0) {
    await throttled('post');
    try {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (tries < 4) { await sleep(1200 * (tries + 1)); return post(path, body, tries + 1); }
      throw e;
    }
  }

  async function get(path, tries = 0) {
    await throttled('get');
    try {
      const r = await fetch(API + path, { headers: { Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (tries < 4) { await sleep(1000 * (tries + 1)); return get(path, tries + 1); }
      return null;
    }
  }

  function img(sid, size) {
    if (!sid) return '';
    return 'https://cards.scryfall.io/' + (size || 'normal') + '/front/' + sid[0] + '/' + sid[1] + '/' + sid + '.jpg';
  }

  function compactPrices(c) {
    return {
      id:c.id, set:c.set, set_name:c.set_name, collector_number:c.collector_number,
      full_art:c.full_art, border_color:c.border_color, frame:c.frame, frame_effects:c.frame_effects,
      promo_types:c.promo_types, textless:c.textless, _fetchedAt:new Date().toISOString(),
      usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null,
      usd_foil: c.prices && c.prices.usd_foil ? parseFloat(c.prices.usd_foil) : null,
      usd_etched: c.prices && c.prices.usd_etched ? parseFloat(c.prices.usd_etched) : null,
    };
  }

  // Fetch fresh prices for an array of scryfall ids. onProgress(done, total).
  async function pricesByIds(ids, onProgress) {
    const out = {};
    for (let i = 0; i < ids.length; i += 75) {
      const batch = ids.slice(i, i + 75).map((id) => ({ id }));
      const res = await post('/cards/collection', { identifiers: batch });
      for (const c of res.data || []) out[c.id] = compactPrices(c);
      if (onProgress) onProgress(Math.min(i + 75, ids.length), ids.length);
    }
    return out;
  }

  // Resolve card names to {sid, name, prices, type_line, mana_cost, ci}. Batches of 75.
  async function resolveNames(names, onProgress) {
    const out = { found: {}, missing: [] };
    for (let i = 0; i < names.length; i += 75) {
      const batch = names.slice(i, i + 75).map((name) => ({ name }));
      const res = await post('/cards/collection', { identifiers: batch });
      for (const c of res.data || []) {
        out.found[c.name.toLowerCase()] = {
          sid: c.id, name: c.name, t: c.type_line, mc: c.mana_cost || '', ci: (c.color_identity || []).join(''),
          mv: c.cmc, ...compactPrices(c),
        };
        const front = c.name.split(' // ')[0].toLowerCase();
        if (!out.found[front]) out.found[front] = out.found[c.name.toLowerCase()];
      }
      for (const nf of res.not_found || []) out.missing.push(nf.name);
      if (onProgress) onProgress(Math.min(i + 75, names.length), names.length);
    }
    return out;
  }

  async function cardById(sid) { return get('/cards/' + sid); }
  async function cardByName(name) { return get('/cards/named?fuzzy=' + encodeURIComponent(name)); }

  function compactFull(c) {
    return {
      name: c.name, sid: c.id, oracle_id:c.oracle_id, legalities:c.legalities, layout:c.layout, _fetchedAt:new Date().toISOString(),
      o: (c.oracle_text ?? (c.card_faces ? c.card_faces.map((f) => f.oracle_text).join(' // ') : '')).toLowerCase(),
      t: (c.type_line || '').toLowerCase(),
      mv: c.cmc || 0,
      ci: (c.color_identity || []).join(''),
      ...compactPrices(c),
    };
  }

  // Full card facts (oracle text included) for the analyzer. Mixed identifiers.
  async function fullCards(identifiers, onProgress) {
    const out = { bySid: {}, byName: {}, missing: [] };
    for (let i = 0; i < identifiers.length; i += 75) {
      const res = await post('/cards/collection', { identifiers: identifiers.slice(i, i + 75) });
      for (const c of res.data || []) {
        const f = compactFull(c);
        out.bySid[f.sid] = f;
        out.byName[c.name.toLowerCase()] = f;
        out.byName[c.name.split(' // ')[0].toLowerCase()] = f;
        for(const face of c.card_faces || [])out.byName[face.name.toLowerCase()]=f;
      }
      for (const nf of res.not_found || []) out.missing.push(nf.name || nf.id || '');
      if (onProgress) onProgress(Math.min(i + 75, identifiers.length), identifiers.length);
    }
    return out;
  }

  async function searchPrintings(name,set='',page=1) {
    name=String(name).trim();set=String(set).trim();
    if(name.length<2||name.length>120)throw Error('Enter a card name between 2 and 120 characters.');
    if(set&&!/^[a-z0-9]{2,10}$/i.test(set))throw Error('Use the short set code, such as LTR or FDN.');
    if(!Number.isInteger(page)||page<1)throw Error('Invalid search page.');
    const q='name:'+JSON.stringify(name)+' game:paper lang:en'+(set?' set:'+set:'');
    const params=new URLSearchParams({q,unique:'prints',order:'released',dir:'desc',page:String(page)});
    for(let attempt=0;attempt<3;attempt++) {
      await throttled('get');
      const r=await fetch(API+'/cards/search?'+params,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if(r.status===404)return {data:[],has_more:false,total_cards:0};
      if((r.status===429||r.status>=500)&&attempt<2){await sleep(1000*(attempt+1));continue;}
      const result=await r.json();
      if(!r.ok)throw Error(result.details || 'Scryfall search failed. Try again.');
      if(!Array.isArray(result.data))throw Error('Scryfall returned an unreadable search result.');
      if(result.warnings?.length)throw Error(result.warnings.join(' '));
      return {...result,data:result.data.filter(c=>c.games?.includes('paper')).map(c=>({...c,_fetchedAt:new Date().toISOString()}))};
    }
  }
  async function printingById(id) {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw Error('The collection has no exact printing ID. Choose the edition you own.');
    for(let attempt=0;attempt<3;attempt++) {
      await throttled('get');
      const r=await fetch(API+'/cards/'+id,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if((r.status===429||r.status>=500)&&attempt<2){await sleep(1000*(attempt+1));continue;}
      const c=await r.json();
      if(!r.ok)throw Error(c.details||'Could not verify this printing. Try again or choose another edition.');
      if(c.id!==id||!c.games?.includes('paper'))throw Error('The exact paper printing could not be verified. Choose your edition.');
      return {...c,_fetchedAt:new Date().toISOString()};
    }
  }
  return { img, pricesByIds, resolveNames, cardById, cardByName, fullCards, searchPrintings, printingById };
})();
