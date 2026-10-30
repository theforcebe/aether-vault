/* Aether Vault Workbench. Drafts are independent of physical allocations and legacy sync. */
const Workbench = (() => {
  'use strict';
  const C = window.WorkbenchCore, STORAGE = 'av_workbench_v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const money = c => c == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
  const uid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const blank = (name, format = 'commander') => ({ id: uid(), name: name || 'Untitled deck', format, targetDeckId: '', cards: [] });
  let saved; try { saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); } catch (_) { /* restore via backup */ }
  let drafts = Array.isArray(saved?.drafts) && saved.drafts.length ? saved.drafts : [blank()];
  let draft = drafts.find(d => d.id === saved?.active) || drafts[0];
  let snapshot = null, ledger = { schemaVersion: 1, availableBinders: ['Extras', 'Purchased'], decks: [] }, audit = {}, custom = saved?.custom || null;
  let local = false, initialized = false, loading = false, facts = {}, byId = {}, inventory, catalog = [], undo = [], report = null, comboResult = null;
  let comboBusy = false, comboError = '', comboGeneration = 0;
  let note = '', busy = '', selected = '', dialog = null, loadPromise, hydrationErrors = [], hydrating = false, inventoryVersion = 0;
  const pendingNames = new Set();
  const filters = { search: '', binder: '', type: '', role: '', colors: '', availability: 'all', mv: '', maxPrice: '', sort: 'name', finish: '', set: '', rarity: '', fit: false, legal: false, view: 'art', page: 1 };
  let tab = 'library', group = 'type', mobileFiltersOpen = false, addZone = 'main';
  const standard = () => C.formatOf(draft)==='standard';
  const coverage = () => C.coverage(draft.cards, inventory || C.inventory(null,ledger), standard());
  const visible = () => location.hash.split('?')[0] === '#/workbench';
  const fact = n => facts[C.key(n)];
  const sourceLabel = () => custom ? snapshot?.source || 'Uploaded collection' : local ? 'Saved ManaBox baseline' : 'Browser collection';
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, drafts, active: draft.id, custom })); return true; }
    catch (_) { note = 'Browser storage is full. Your changes are still open; download a Workbench backup now.'; return false; }
  }
  function download(name, value, mime = 'application/json') {
    const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function api(endpoint, body, timeout = 180000) {
    const r = await fetch('/api/workbench/' + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout), cache: 'no-store' });
    if (!(r.headers.get('content-type') || '').includes('application/json')) throw Error('Start the local Workbench companion to use this feature.');
    const data = await r.json(); if (!r.ok) throw Error(data.error || 'Request failed (' + r.status + ')'); return data;
  }
  function adopt(v) { snapshot = v.snapshot; ledger = v.ledger; audit = v.audit || {}; inventoryVersion++; report = null; rebuild(); }
  function browserCollection() {
    const records = Store.rows().map(r => ({ name: r.n, quantity: r.q, scryfallId: r.sid, set: r.s, collectorNumber: r.cn, finish: r.f || 'normal', binder: r.b, binderType: r.bt || 'binder', proxy: r.proxy === true }));
    return { snapshot: { schemaVersion: 1, source: Store.collectionLabel(), records, importedAt: Store.state.mycollection?.uploaded }, ledger: { schemaVersion: 1, availableBinders: ['Extras', 'Purchased'], decks: [...new Set(records.filter(r => r.binderType === 'deck').map(r => r.binder))].map((binder, i) => ({ id: 'browser-' + i, name: binder, binder, mode: 'binder', status: 'inferred' })) } };
  }
  function cacheCards(cards) {
    for (const f of cards) {
      byId[f.id] = f; facts[C.key(f.name)] = f;
      for (const face of f.card_faces || []) facts[C.key(face.name)] = f;
    }
    rebuild();
  }
  function rebuild() {
    inventory = C.inventory(snapshot, ledger, draft.targetDeckId, facts);
    catalog = [...inventory.byName.values()].filter(c => c.records.length).map(c => {
      const record = c.records.find(r => !r.proxy) || c.records[0], f = byId[record?.scryfallId] || fact(c.name);
      return { name: f?.name || c.name, fact: f, sid: record?.scryfallId || f?.id, own: c, roles: C.roles(f) };
    });
  }
  async function init() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      loading = true; redraw();
      try { local = !!(await api('status', undefined, 3000)).local; } catch (_) { local = false; }
      if (custom) adopt(custom);
      else if (local) { try { adopt(await api('vault')); } catch (e) { note = e.message; adopt(browserCollection()); } }
      else { adopt(browserCollection()); note = 'Browser collection mode. Start tools/workbench-server.js for the saved ManaBox baseline, allocation ledger, exact purchase quotes and in-app Spellbook results.'; }
      initialized = true; loading = false; redraw();
      hydrate();
    })();
    return loadPromise;
  }
  async function hydrate(refresh = false, onlyNames, printingId) {
    if (hydrating) { for (const n of onlyNames || []) if (!fact(n)) pendingNames.add(n); return; }
    const version = inventoryVersion;
    const ids = new Map();
    if (!onlyNames) for (const r of snapshot?.records || []) { if (r.scryfallId) ids.set(r.scryfallId, { id: r.scryfallId }); else ids.set(C.key(r.name), { name: r.name }); }
    for (const c of onlyNames || draft.cards.map(c => c.n)) if (refresh || !fact(c)) ids.set(C.key(c), { name: c });
    if (printingId) { ids.clear(); ids.set(printingId, { id: printingId }); }
    const needed = [...ids.values()].filter(x => refresh || !(x.id ? byId[x.id] : fact(x.name)));
    if (!needed.length) { redraw(); return; }
    hydrating = true; hydrationErrors = [];
    try {
      for (let i = 0; i < needed.length; i += 75) {
        if (version !== inventoryVersion) break;
        busy = 'Indexing Oracle text and printings ' + Math.min(i + 75, needed.length) + ' / ' + needed.length; redrawStatus();
        const identifiers = needed.slice(i, i + 75); let r;
        if (local) r = await api('facts', { identifiers, refresh });
        else {
          // Same public API as the original app; full objects retain all faces and metadata.
          const response = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers }), signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw Error('Scryfall HTTP ' + response.status + '. Try Refresh card facts.');
          const data = await response.json(); r = { data: (data.data || []).map(c => ({ ...c, _fetchedAt: new Date().toISOString() })), missing: data.not_found };
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        cacheCards(r.data || []); hydrationErrors.push(...(r.missing || []));
        if (visible() && !dialog) redrawPanels();
      }
    } catch (e) { note = 'Card indexing paused: ' + e.message + ' Cards without facts remain visible; effect filters cover indexed cards only.'; }
    finally { hydrating = false; busy = ''; if (hydrationErrors.length) note = hydrationErrors.length + ' printing(s) could not be resolved. Try refreshing, or inspect the collection export.'; redraw();
      if (pendingNames.size) { const next = [...pendingNames]; pendingNames.clear(); hydrate(false,next); }
    }
  }
  function change(fn) {
    undo.push(JSON.stringify(draft)); if (undo.length > 40) undo.shift();
    fn(); draft.updated = new Date().toISOString(); report = null; comboResult = null;comboError='';comboGeneration++; rebuild(); persist(); redraw();
  }
  function add(name, zone = addZone) {
    name = fact(name)?.name || name;
    change(() => { const c = draft.cards.find(c => inventory.canonical(c.n) === inventory.canonical(name) && c.zone === zone); if (c) c.q++; else draft.cards.push({ n: name, q: 1, zone }); });
    if (!fact(name)) hydrate(false, [name]);
  }
  function imageUrl(name, sid, faceIndex = 0, crop = false) {
    const f = byId[sid] || fact(name), face = f?.card_faces?.[faceIndex];
    const images = face?.image_uris || f?.image_uris;
    if (images) return crop ? images.art_crop || images.normal : images.normal || images.large;
    return sid ? Scry.img(sid, 'normal') : '';
  }
  function cardImage(name, sid, cls = '', faceIndex = 0) {
    const url = imageUrl(name, sid, faceIndex);
    return url ? `<img class="${cls}" src="${esc(url)}" alt="${esc(name)}${faceIndex ? ' back face' : ''}" loading="lazy" draggable="false">` : `<div class="wb-no-image ${cls}">${esc(name)}<small>Art loads after card lookup</small></div>`;
  }
  const labelFor = id => C.ROLES.find(r => r.id === id)?.label || id;
  function tags(f, max = 4) { return C.roles(f).slice(0, max).map(id => { const r = C.ROLES.find(x => x.id === id); return `<span class="wb-tag" style="--role:${r.color}">${esc(r.label)}</span>`; }).join(''); }
  function price(f, finish = 'normal') { const n = f?.prices?.[{ normal: 'usd', foil: 'usd_foil', etched: 'usd_etched' }[finish]]; return n == null ? null : Math.round(Number(n) * 100); }
  function status() { return `<span>${esc(busy || (initialized ? catalog.length.toLocaleString() + ' names · ' + catalog.filter(c => c.fact).length.toLocaleString() + ' indexed' : 'Opening your vault…'))}</span>${note ? `<span class="wb-notice">${esc(note)}</span>` : ''}`; }
  function shell() {
    return `<section class="wb" aria-label="Collection Workbench"><header class="wb-heading"><div><h1>Collection Workbench</h1><p>Build with what you have. See what works together.</p></div><div class="wb-actions"><button class="btn" data-wb="open">Open deck</button><button class="btn" data-wb="import">Import decklist</button><button class="btn primary" data-wb="new">New deck</button><button class="btn" data-wb="backup">Backup</button></div></header>
    <div class="wb-source"><span class="wb-dot"></span><strong>${esc(sourceLabel())}</strong><span>${(snapshot?.records || []).reduce((s, r) => s + (r.proxy ? 0 : r.quantity), 0).toLocaleString()} paper copies</span><span>${ledger.decks.length} protected decks</span><span>${snapshot?.importedAt ? 'Imported ' + new Date(snapshot.importedAt).toLocaleDateString() : ''}</span><button data-wb="collection" class="wb-link">Collection & allocations</button></div>
    <div id="wb-status" class="wb-status" role="status" aria-live="polite">${status()}</div>
    <div class="wb-mobile-jumps" aria-label="Workbench sections"><button class="btn small" data-wb="jump" data-id="filters">Find cards</button><button class="btn small" data-wb="jump" data-id="library">Binder</button><button class="btn small" data-wb="jump" data-id="deck">Deck</button></div><div class="wb-layout"><aside class="wb-filters${mobileFiltersOpen?' wb-filters-open':''}" aria-label="Card filters">${filterHtml()}</aside><section class="wb-library"><div class="wb-tabs" role="tablist" aria-label="Workbench views">${[['library','Your binder'],['deck-art','Deck art'],['shopping','Collection check'],['interactions','Interactions']].map(([id,label]) => `<button role="tab" aria-selected="${tab === id}" data-wb="tab" data-id="${id}">${label}</button>`).join('')}</div><div id="wb-library-body">${libraryBody()}</div></section><aside class="wb-deck" aria-label="Deck editor">${deckHtml()}</aside></div></section>`;
  }
  function select(name, label, options, value) { return `<label class="wb-field">${label}<select data-filter="${name}">${options.map(([v,t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`; }
  function filterHtml() {
    const binders = [...new Set((snapshot?.records || []).map(r => r.binder))].sort();
    const sets = [...new Set((snapshot?.records || []).map(r => r.set).filter(Boolean))].sort();
    return `<div class="wb-filter-title"><h2>Find a card</h2><div><button class="btn small wb-filter-toggle" data-wb="filters" aria-expanded="${mobileFiltersOpen}">${mobileFiltersOpen?'Fewer filters':'More filters'}</button><button class="wb-link" data-wb="clear-filters">Reset</button></div></div>
    <label class="wb-field wb-search-field">Name or Oracle text<input data-filter="search" type="search" value="${esc(filters.search)}" placeholder="Search cards…" autocomplete="off"></label>
    <div class="wb-field wb-color-field">Color identity<div class="wb-colors">${['W','U','B','R','G','C'].map(c => `<button data-wb="color" data-id="${c}" class="wb-color wb-color-${c}${filters.colors.includes(c) ? ' chosen' : ''}" aria-label="${({W:'White',U:'Blue',B:'Black',R:'Red',G:'Green',C:'Colorless'})[c]}" aria-pressed="${filters.colors.includes(c)}">${c}</button>`).join('')}</div><small>Cards within selected colors</small></div>
    ${select('availability','Availability',[['all','All owned cards'],['free','Available for this deck'],['protected','In protected decks'],['proxy','Includes proxies']],filters.availability)}
    ${select('binder','Binder',[['','Every binder'],...binders.map(x => [x,x])],filters.binder)}
    ${select('role','Effect',[['','Every effect'],...C.ROLES.map(r => [r.id,r.label])],filters.role)}
    ${select('type','Card type',[['','Every type'],...['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Battle'].map(x => [x.toLowerCase(),x])],filters.type)}
    <div class="wb-filter-pair">${select('mv','Mana value',[['','Any'],...['0','1','2','3','4','5','6','7+'].map(x=>[x,x])],filters.mv)}<label class="wb-field">Max USD<input data-filter="maxPrice" type="number" min="0" step="0.25" placeholder="Any" value="${esc(filters.maxPrice)}"></label></div>
    ${select('finish','Owned finish',[['','Any finish'],['normal','Nonfoil'],['foil','Foil'],['etched','Etched']],filters.finish)}
    ${select('set','Set',[['','Every set'],...sets.map(s=>[s,s])],filters.set)}
    ${select('rarity','Rarity',[['','Every rarity'],...['common','uncommon','rare','mythic','special','bonus'].map(s=>[s,s])],filters.rarity)}
    ${draft.format==='commander'?`<label class="wb-check"><input type="checkbox" data-filter="fit"${filters.fit ? ' checked' : ''}>Fit commander colors</label>`:''}
    ${standard()?`<label class="wb-check"><input type="checkbox" data-filter="legal"${filters.legal ? ' checked' : ''}>Standard legal only</label><p class="wb-help">Uses indexed Scryfall legality, across printings. Unknown cards stay visible when this filter is off.</p>`:''}
    <p class="wb-help">Effect groups use Oracle text. A shared group is a starting point for comparison.</p><button class="btn small" data-wb="facts"${hydrating ? ' disabled' : ''}>Refresh card facts</button>`;
  }
  function filtered() {
    const check = C.validateDeck(draft, facts), query = filters.search.toLowerCase().trim(), colors = filters.colors.replace('C','');
    const list = catalog.filter(c => {
      const record = displayRecord(c), f = byId[record?.scryfallId] || c.fact, ci = C.identity(f);
      if (query && !(c.name + ' ' + C.text(f) + ' ' + C.type(f)).toLowerCase().includes(query)) return false;
      if (filters.binder && !c.own.records.some(r => r.binder === filters.binder)) return false;
      if (!c.own.records.some(r => (!filters.finish || r.finish === filters.finish) && (!filters.binder || r.binder === filters.binder) && (!filters.set || r.set === filters.set))) return false;
      if (filters.rarity && f?.rarity !== filters.rarity) return false;
      if (filters.availability === 'free' && !c.own.available) return false;
      if (filters.availability === 'protected' && !c.own.copiesInOtherDecks) return false;
      if (filters.availability === 'proxy' && !c.own.proxyQuantity) return false;
      if (filters.type && (!f || !C.type(f).includes(filters.type))) return false;
      if (filters.role && !c.roles.includes(filters.role)) return false;
      if (filters.colors && (!f || ci.some(x => !colors.includes(x)))) return false;
      if (draft.format==='commander' && filters.fit && (!check.ci || !f || ci.some(x => !check.ci.includes(x)))) return false;
      if (standard() && filters.legal && f?.legalities?.standard!=='legal') return false;
      if (filters.mv && (!f || (filters.mv === '7+' ? C.mv(f) < 7 : C.mv(f) !== Number(filters.mv)))) return false;
      if (filters.maxPrice !== '' && (price(f, filters.finish || record?.finish || 'normal') == null || price(f, filters.finish || record?.finish || 'normal') > Number(filters.maxPrice) * 100)) return false;
      return true;
    });
    return list.sort((a,b) => filters.sort === 'mana' ? (C.mv(a.fact) ?? 999) - (C.mv(b.fact) ?? 999) || a.name.localeCompare(b.name) : filters.sort === 'price' ? (price(b.fact) ?? -1) - (price(a.fact) ?? -1) : filters.sort === 'available' ? b.own.available-a.own.available || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  }
  function displayRecord(c) { return c.own.records.find(r=>(!filters.binder||r.binder===filters.binder)&&(!filters.finish||r.finish===filters.finish)&&(!filters.set||r.set===filters.set)&&(!filters.rarity||(byId[r.scryfallId]||fact(r.name))?.rarity===filters.rarity)&&!r.proxy) || c.own.records.find(r=>(!filters.binder||r.binder===filters.binder)&&(!filters.finish||r.finish===filters.finish)&&(!filters.set||r.set===filters.set)&&(!filters.rarity||(byId[r.scryfallId]||fact(r.name))?.rarity===filters.rarity)) || c.own.records[0]; }
  function libraryBody() {
    if (tab === 'deck-art') {
      const rows=coverage(), cards=rows.map(c=>({name:c.n,fact:fact(c.n),sid:c.inventory.records.find(r=>!r.proxy)?.scryfallId||fact(c.n)?.id,own:c.inventory}));
      return `<div class="wb-panel-heading"><h2>${esc(draft.name)}</h2><p>${rows.reduce((s,c)=>s+c.q,0)} cards including commanders. Sideboard cards stay in the editor. Click any card to inspect or compare it.</p></div><div class="wb-cards">${cards.map(tile).join('') || '<p class="wb-empty">Add cards or import a list to see the deck’s art.</p>'}</div>`;
    }
    if (tab === 'shopping') return shoppingHtml();
    if (tab === 'interactions') return interactionsHtml();
    const cards = filtered(), pages = Math.max(1, Math.ceil(cards.length / 48)); filters.page = Math.min(filters.page, pages);
    return `<div class="wb-library-tools"><strong>${cards.length.toLocaleString()} cards</strong><div><label class="wb-sr">Sort cards</label><select data-filter="sort" aria-label="Sort cards">${[['name','Name A–Z'],['mana','Mana value'],['price','Price: high first'],['available','Available copies']].map(([v,t])=>`<option value="${v}"${filters.sort===v?' selected':''}>${t}</option>`).join('')}</select><button class="btn small" data-wb="view">${filters.view === 'art' ? 'List view' : 'Card art'}</button></div></div>
    ${filters.fit && !C.validateDeck(draft,facts).ci ? '<p class="wb-empty">Set your commander first, then filter by its color identity.</p>' : ''}
    ${cards.length ? `<div class="wb-cards ${filters.view === 'list' ? 'wb-list' : ''}">${cards.slice((filters.page-1)*48,filters.page*48).map(tile).join('')}</div>` : `<div class="wb-empty"><h3>${loading ? 'Opening your collection…' : snapshot?.records.length ? 'No cards match these filters' : 'Your binder is ready'}</h3><p>${snapshot?.records.length ? 'Reset a filter or refresh card facts to search all Oracle text.' : 'Use Collection & allocations to load your saved baseline or upload a ManaBox CSV.'}</p></div>`}
    <div class="wb-pagination"><button class="btn small" data-wb="page" data-id="-1"${filters.page===1?' disabled':''}>Previous</button><span>Page ${filters.page} of ${pages}</span><button class="btn small" data-wb="page" data-id="1"${filters.page===pages?' disabled':''}>Next</button></div>`;
  }
  function tile(c) {
    const selectedRecord = displayRecord(c);
    const sid = selectedRecord?.scryfallId || c.sid, f = byId[sid] || c.fact, p = price(f, selectedRecord?.finish || 'normal');
    const inDeck = draft.cards.filter(x=>inventory.canonical(x.n)===inventory.canonical(c.name) && x.zone!=='sideboard').reduce((s,x)=>s+x.q,0);
    return `<article class="wb-card" draggable="false" data-card="${esc(c.name)}"><button class="wb-art" data-wb="inspect" data-name="${esc(c.name)}" data-sid="${esc(sid)}" aria-label="Inspect ${esc(c.name)}">${cardImage(c.name,sid)}${inDeck ? `<span class="wb-in-deck">${inDeck} in deck</span>` : ''}</button><div class="wb-card-info"><div class="wb-card-heading"><button class="wb-card-name" data-wb="inspect" data-name="${esc(c.name)}" data-sid="${esc(sid)}">${esc(c.name)}</button><button class="wb-add" data-wb="add" data-name="${esc(c.name)}" aria-label="Add ${esc(c.name)} to deck">+</button></div><div class="wb-card-line"><span class="${c.own.available ? 'wb-free':'wb-held'}">${c.own.available} available <span>/ ${c.own.totalOwned} owned</span></span><span title="${esc(selectedRecord?.finish)} Scryfall reference price; ${esc(f?._fetchedAt || 'not retrieved')}">${p == null ? '—' : money(p)}</span></div><div class="wb-card-tags">${tags(f,2)}</div></div></article>`;
  }
  function deckHtml() {
    const check = C.validateDeck(draft,facts), cov = coverage(), missing = cov.reduce((s,c)=>s+c.missing,0);
    const buckets = new Map();
    draft.cards.forEach((c,i) => {
      const f = fact(c.n); let g = c.zone === 'commander' ? 'Command zone' : c.zone === 'sideboard' ? (standard()?'Sideboard':'Sideboard / considering') : group === 'effect' ? labelFor(C.roles(f).find(x=>!['double-strike','etb'].includes(x)) || 'Other effects') : group === 'mana' ? 'Mana value ' + (C.mv(f) ?? '?') : group === 'color' ? C.identity(f).join('') || (f?'Colorless':'Unknown') : ['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Battle'].find(t=>C.type(f).includes(t.toLowerCase())) || 'Needs card facts';
      if (!buckets.has(g)) buckets.set(g,[]); buckets.get(g).push({c,i});
    });
    const order = [...buckets.entries()].sort((a,b)=> (a[0]==='Command zone'?-1:b[0]==='Command zone'?1:a[0].startsWith('Sideboard')?1:b[0].startsWith('Sideboard')?-1:a[0].localeCompare(b[0])));
    return `<div class="wb-deck-head"><label class="wb-sr" for="wb-deck-name">Deck name</label><input id="wb-deck-name" value="${esc(draft.name)}" maxlength="150"><div class="wb-deck-meta"><span>${standard()?check.total+' / 60+ main · '+check.sideboardTotal+' / 15 sideboard':check.total+(draft.format==='commander'?' / 100':'')+' cards'}</span><span>${missing} to source</span><button data-wb="undo" class="wb-link"${undo.length?'':' disabled'}>Undo</button></div><div class="wb-deck-options"><select aria-label="Deck format" id="wb-format">${[...new Set(['commander','standard',draft.format])].map(v=>`<option${draft.format===v?' selected':''}>${v}</option>`).join('')}</select><select id="wb-group" aria-label="Group deck cards">${[['type','Group by type'],['effect','Group by effect'],['mana','Group by mana'],['color','Group by color']].map(([v,t])=>`<option value="${v}"${v===group?' selected':''}>${t}</option>`).join('')}</select></div>
    ${standard()?`<label class="wb-target">Add or drag cards into<select id="wb-add-zone"><option value="main"${addZone==='main'?' selected':''}>Main deck</option><option value="sideboard"${addZone==='sideboard'?' selected':''}>Sideboard</option></select></label>`:''}
    <label class="wb-target">Use this deck’s own copies<select id="wb-target"><option value="">New build · keep every deck intact</option>${ledger.decks.map(d=>`<option value="${esc(d.id)}"${draft.targetDeckId===d.id?' selected':''}>${esc(d.name)}${d.status==='inferred'?' (inferred)':''}</option>`).join('')}</select></label></div>
    <div class="wb-deck-scroll" id="wb-drop" tabindex="0" aria-label="Deck card list. Drag cards here or use their Add buttons.">${draft.cards.length ? order.map(([name,items])=>`<section class="wb-deck-group"><h3>${esc(name)}<span>${items.reduce((s,{c})=>s+c.q,0)}</span></h3>${items.map(({c,i})=>deckRow(c,i)).join('')}</section>`).join('') : '<div class="wb-drop-empty"><span>＋</span><h3>Start with a card</h3><p>Drag cards from your binder, use +, or import a decklist.</p><p>Choose a format above. Inspect cards to manage their zones.</p></div>'}</div>
    <div class="wb-deck-bottom">${curveHtml()}<details class="wb-checks"><summary>Construction checks${check.issues.length ? ' · ' + check.issues.length + ' to review' : ' · preliminary checks passed'}</summary><ul>${check.issues.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p>${esc(check.note)}</p></details><div class="wb-actions"><button class="btn small" data-wb="export">Export list</button><button class="btn small" data-wb="save-legacy">Copy to Decks</button></div><small>Draft saved in this browser. Physical cards stay in their binders.</small></div>`;
  }
  function deckRow(c,i) {
    const f = fact(c.n), own = inventory.get(c.n), role = C.ROLES.find(r=>C.roles(f).includes(r.id));
    return `<div class="wb-deck-row" style="--role:${role?.color || '#aaa'}"><input class="wb-qty" type="number" min="0" max="1000" aria-label="Quantity of ${esc(c.n)}" data-qty="${i}" value="${c.q}"><button data-wb="inspect" data-name="${esc(c.n)}" class="wb-deck-card"><strong>${esc(c.n)}</strong><small>${esc(f?.mana_cost || f?.card_faces?.[0]?.mana_cost || '')} <span class="${own.available>=c.q?'wb-free':'wb-held'}">${own.available>=c.q?'Available':own.totalOwned ? 'Owned · check copies' : 'Not owned'}</span></small></button><button data-wb="qty" data-index="${i}" data-delta="-1" aria-label="Remove one ${esc(c.n)}">−</button><button data-wb="qty" data-index="${i}" data-delta="1" aria-label="Add one ${esc(c.n)}">+</button></div>`;
  }
  function curveHtml() {
    const counts = Array(8).fill(0); draft.cards.filter(c=>c.zone!=='sideboard').forEach(c=>{ const f=fact(c.n); if(f&&!C.type(f).includes('land'))counts[Math.min(7,Math.floor(C.mv(f)||0))]+=c.q; });
    const max = Math.max(1,...counts); return `<div class="wb-curve" aria-label="Nonland mana curve">${counts.map((n,i)=>`<div title="Mana value ${i===7?'7+':i}: ${n} cards"><span>${n||''}</span><i style="height:${n/max*36}px"></i><small>${i===7?'7+':i}</small></div>`).join('')}</div>`;
  }
  function shoppingHtml() {
    const rows = coverage(), total = rows.reduce((s,c)=>s+c.q,0), avail = rows.reduce((s,c)=>s+Math.min(c.q,c.inventory.available),0), missing=total-avail;
    return `<div class="wb-panel-heading"><h2>Collection check</h2><p>Exact quantities, with your other decks kept intact.</p></div><div class="wb-coverage"><strong>${avail}<small>available</small></strong><strong>${missing}<small>copies to source</small></strong><strong>${rows.reduce((s,c)=>s+c.notOwned,0)}<small>not owned at all</small></strong></div>
    <div class="wb-quote-actions"><button class="btn primary" data-wb="quote"${busy||!rows.length||!local?' disabled':''}>${report ? 'Refresh purchase quote' : 'Get live purchase quote'}</button><label>Finish <select id="wb-quote-finish"><option value="normal">Nonfoil</option><option value="foil">Foil</option><option value="etched">Etched</option></select></label>${report ? '<button class="btn small" data-wb="quote-export">Download quote</button>' : ''}</div>
    ${!local ? '<p class="wb-help">Exact printing comparisons use the local companion: node tools/workbench-server.js.</p>' : ''}
    ${report ? `<div class="wb-quote-total"><strong>${money(report.purchaseTotalCents)}</strong><span>to buy while keeping decks intact</span><p>${report.purchaseComplete?'Complete reference estimate':'Incomplete estimate · known subtotal '+money(report.knownPurchaseSubtotalCents)} · ${new Date(report.generatedAt).toLocaleString()}</p><p>Reusing other decks’ copies: ${money(report.purchaseTotalIfReusingDeckCopiesCents)}. Donor decks are listed below.</p></div>` : '<p class="wb-help">Fetches current prices across English paper printings. Unknown prices stay unknown. '+(standard()?'Main deck and sideboard are included.':'Considering cards are excluded.')+'</p>'}
    <div class="wb-check-list">${rows.map(c=>{
      const line=report?.lines.find(l=>C.key(l.requestedName)===C.key(c.n)), own=c.inventory;
      return `<article class="wb-check-card"><div><button class="wb-card-name" data-wb="inspect" data-name="${esc(c.n)}">${c.q} × ${esc(c.n)}</button><p><span class="wb-free">${own.available} available</span> · ${own.totalOwned} owned · <strong>${c.missing} to buy</strong>${own.proxyQuantity?' · '+own.proxyQuantity+' proxies':''}</p><p>${own.usedInDecks.map(d=>esc(d.deckName)+' ×'+d.quantity+(d.status==='inferred'?' (inferred)':'')+(d.accessibleForPlan?' (usable)':'')).join(' · ') || 'No copies assigned to a named deck'}</p>${line?`<p>${line.printing?`<a href="${esc(safeUrl(line.printing.source))}" target="_blank" rel="noopener">${esc(line.printing.set.toUpperCase())} #${esc(line.printing.collectorNumber)} · ${esc(line.printing.finish)}</a> · ${money(line.unitCents)} each`:'Price '+esc(line.status)}${line.error?' · '+esc(line.error):''}</p>`:''}</div><div><strong>${line?money(line.purchaseSubtotalCents):'—'}</strong>${c.missing?`<button class="wb-link" data-wb="inspect" data-name="${esc(c.n)}">Find owned alternatives</button>`:''}</div></article>`;
    }).join('') || '<div class="wb-empty">Import or build a deck to compare it with your collection.</div>'}</div><p class="wb-help">Scryfall USD reference prices exclude shipping, tax, condition and stock verification. Reuse is an option to review, never an automatic move.</p>`;
  }
  const safeUrl = value => { try { const u=new URL(value); return u.protocol==='https:'?u.href:'#'; } catch(_){return '#';} };
  function interactionsHtml() {
    const cards=draft.cards.filter(c=>c.zone!=='sideboard'), groups=C.ROLES.map(r=>({...r,cards:cards.filter(c=>C.roles(fact(c.n)).includes(r.id))})).filter(r=>r.cards.length);
    const flicker=groups.find(g=>g.id==='flicker'), etb=groups.find(g=>g.id==='etb');
    return `<div class="wb-panel-heading"><h2>How the deck connects</h2><p>See shared jobs, potential partners and the actual text behind them.</p></div>${flicker&&etb?'<div class="wb-interaction-note"><strong>Flicker + enters triggers</strong><p>Your deck has both enablers and payoffs. Compare targets and return timing before treating a pair as an engine.</p></div>':''}
    <div class="wb-role-groups">${groups.map(r=>`<section style="--role:${r.color}"><h3>${esc(r.label)} <span>${r.cards.reduce((s,c)=>s+c.q,0)}</span></h3>${r.cards.map(c=>`<button data-wb="inspect" data-name="${esc(c.n)}">${esc(c.n)}</button>`).join('')}</section>`).join('') || '<p class="wb-empty">Add cards and load their Oracle text to see effect groups.</p>'}</div>
    <div class="wb-panel-heading"><h2>Commander Spellbook</h2><p>Discover included and near-complete combinations. Database matches still need rules and prerequisite review.</p>${local?`<button class="btn" data-wb="combos"${comboBusy||!cards.length?' disabled':''}>${comboBusy?'Finding combinations…':'Find deck combinations'}</button>`:cards.length?`<a class="btn" href="${esc(C.comboLink(draft,facts).length<12000?C.comboLink(draft,facts):'https://commanderspellbook.com/find-my-combos/')}" target="_blank" rel="noopener noreferrer">Find deck combinations ↗</a><button class="btn small" data-wb="copy-combos">Copy combo-search list</button><p class="wb-help">Opens the official Spellbook finder with your main deck and commanders. ${C.comboLink(draft,facts).length>=12000?'This list is too long for a link; copy it and paste into the finder. ':''}Run Open Workbench.cmd for results inside Aether Vault. The hosted page cannot call Spellbook directly.</p>`:'<p class="wb-help">Add cards to search for combinations.</p>'}<p class="wb-help">Main deck only; sideboard is excluded.${standard()?' Spellbook is focused on Commander. Matches are research leads, not proof of Standard legality.':''}</p></div><div id="wb-combo-results" role="status" aria-live="polite" aria-busy="${comboBusy}">${comboBusy?'<p class="wb-interaction-note">Searching Commander Spellbook for this deck…</p>':''}${comboError?`<p class="wb-notice">${esc(comboError)} <a href="${esc(C.comboLink(draft,facts))}" target="_blank" rel="noopener noreferrer">Try the official finder</a></p>`:''}${comboHtml()}</div>`;
  }
  function comboHtml() {
    if (!comboResult) return '';
    const groups=Object.entries(comboResult.results || {}).filter(([,v])=>Array.isArray(v)&&v.length);
    const count=groups.reduce((sum,[,v])=>sum+v.length,0), unknown=draft.cards.filter(c=>c.zone!=='sideboard'&&!fact(c.n));
    const labels={included:'Included in your deck',includedByChangingCommanders:'Requires changing commanders',almostIncluded:'Almost included',almostIncludedByAddingColors:'Requires additional colors',almostIncludedByChangingCommanders:'Almost included · change commanders',almostIncludedByAddingColorsAndChangingCommanders:'Requires new colors and commanders'};
    return `<p class="wb-interaction-note"><strong>${count?count+' candidate combinations found':'No combinations found for these cards'}</strong>${!count?'<br>This does not mean the deck has no synergies. Check card names and use the effect groups above.':''}${unknown.length?'<br>'+unknown.length+' names still need Oracle lookup; Spellbook may ignore unrecognized names.':''}</p><p class="wb-help">Retrieved ${new Date(comboResult.fetchedAt).toLocaleString()} · <a href="https://commanderspellbook.com/" target="_blank" rel="noopener">Commander Spellbook</a> · This response is a discovery page, not an exhaustive scan.${comboResult.next?' Additional pages are available at the source.':''}</p><button class="btn small" data-wb="combo-export">Download full combo evidence</button>${groups.map(([label,variants])=>`<section class="wb-combos"><h3>${esc(labels[label] || label.replace(/([A-Z])/g,' $1'))} (${variants.length})</h3>${variants.map(v=>`<details><summary>${esc((v.uses || []).map(c=>c.card.name).join(' + ') || v.id)}</summary>${variantHtml(v)}</details>`).join('')}</section>`).join('')}`;
  }
  function variantHtml(v) {
    const lines = field => esc(v[field] || 'Not specified').replace(/\n/g,'<br>');
    return `<p><a href="https://commanderspellbook.com/combo/${encodeURIComponent(v.id)}/" target="_blank" rel="noopener">Open full variant ${esc(v.id)}</a></p><p>${esc((v.produces || []).map(p=>p.feature.name).join(' · '))}</p><h4>Components and starting state</h4><ul>${(v.uses || []).map(c=>`<li>${c.quantity} × ${esc(c.card.name)}${c.mustBeCommander?' · must be commander':''} · ${esc((c.zoneLocations || []).map(z=>({B:'battlefield',H:'hand',G:'graveyard',E:'exile',L:'library',C:'command zone'})[z]||z).join(', '))}${c.battlefieldCardState?' · '+esc(c.battlefieldCardState):''}${c.handCardState?' · '+esc(c.handCardState):''}${c.graveyardCardState?' · '+esc(c.graveyardCardState):''}${c.exileCardState?' · '+esc(c.exileCardState):''}${c.libraryCardState?' · '+esc(c.libraryCardState):''}</li>`).join('')}</ul>${(v.requires || []).length?`<h4>Unresolved templates</h4><ul>${v.requires.map(r=>`<li>${r.quantity} × ${esc(r.template.name)} · ${esc(r.template.scryfallQuery || '')}${r.mustBeCommander?' · must be commander':''}</li>`).join('')}</ul>`:''}<p>Database ${esc(draft.format)} legality: ${v.legalities?.[draft.format] === true ? "legal" : v.legalities?.[draft.format] === false ? "not legal" : "not provided"} · identity ${esc(v.identity || "not provided")}</p><h4>Starting mana</h4><p>${lines('manaNeeded')}</p><h4>Prerequisites</h4><p>${lines('easyPrerequisites')}<br>${lines('notablePrerequisites')}</p><h4>Sequence</h4><p>${lines('description')}</p><p class="wb-help">Candidate only. Verify template replacements, legality, states, opponents’ choices and each action under current rules.</p>`;
  }
  function redrawStatus() { const el=document.getElementById('wb-status'); if(el)el.innerHTML=status(); }
  function redrawPanels() { if(!visible()||dialog)return; const library=document.getElementById('wb-library-body'), deck=document.querySelector('.wb-deck'); if(library)library.innerHTML=libraryBody(); if(deck&&!deck.contains(document.activeElement)){const s=deck.querySelector('.wb-deck-scroll')?.scrollTop||0;deck.innerHTML=deckHtml();deck.querySelector('.wb-deck-scroll').scrollTop=s;} redrawStatus(); }
  function redraw() {
    if(!visible())return; const root=document.getElementById('view'); if(!root)return;
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    const attrs=['id','data-wb','data-name','data-id','data-qty','aria-label'];
    const identity=focused?attrs.filter(a=>focused.hasAttribute(a)).map(a=>[a,focused.getAttribute(a)]):[];
    const scroll=root.querySelector('.wb-deck-scroll')?.scrollTop||0;
    root.innerHTML=shell(); const deck=root.querySelector('.wb-deck-scroll');if(deck)deck.scrollTop=scroll;bind(root);
    if(identity.length){const match=[...root.querySelectorAll('button,input,select')].find(el=>el.tagName===focused.tagName&&identity.every(([a,v])=>el.getAttribute(a)===v));match?.focus({preventScroll:true});}
  }
  function closeDialog() { const old=dialog;dialog=null;if(old){old.close();old.remove();} }
  function showDialog(title, content, wide=false) {
    closeDialog(); dialog=document.createElement('dialog');dialog.className='wb-dialog'+(wide?' wb-dialog-wide':'');dialog.innerHTML=`<div class="wb-dialog-heading"><h2>${esc(title)}</h2><button class="btn small" data-wb="close" aria-label="Close dialog">✕</button></div><div class="wb-dialog-body">${content}</div>`;
    const opened=dialog;document.body.appendChild(opened);opened.addEventListener('click',handleClick);opened.addEventListener('close',()=>{opened.remove();if(dialog===opened)dialog=null;});opened.showModal();
  }
  function inspect(name,sid,face=0) {
    selected=name;const f=byId[sid]||fact(name), own=inventory.get(name), inDeck=draft.cards.find(c=>inventory.canonical(c.n)===inventory.canonical(name)), ci=C.validateDeck(draft,facts).ci;
    const matches=C.alternatives(f,standard()?catalog.filter(c=>c.fact?.legalities?.standard==='legal'):catalog,ci), imgSid=sid||own.records.find(r=>!r.proxy)?.scryfallId||f?.id;
    showDialog(name,`<div class="wb-inspect"><div class="wb-inspect-art">${cardImage(name,imgSid,'',face)}${f?.card_faces?.some(x=>x.image_uris)?`<button class="btn" data-wb="flip" data-name="${esc(name)}" data-sid="${esc(imgSid)}" data-face="${face?0:1}">Show ${face?'front':'back'} face</button>`:''}<div class="wb-actions"><button class="btn primary" data-wb="add" data-name="${esc(name)}">Add to deck</button>${draft.format==='commander'?`<button class="btn" data-wb="commander" data-name="${esc(name)}">Set commander</button>`:''}<button class="btn" data-wb="sideboard" data-name="${esc(name)}">${standard()?'Add to sideboard':'Consider'}</button>${standard()?['main','sideboard'].filter(z=>draft.cards.some(c=>C.key(c.n)===C.key(name)&&c.zone===z)).map(z=>`<button class="btn small" data-wb="move-zone" data-name="${esc(name)}" data-zone="${z}">Move 1 to ${z==='main'?'sideboard':'main deck'}</button>`).join(''):''}</div></div><div class="wb-inspect-copy"><p class="wb-card-type">${esc(f?.type_line||'Card facts not loaded')} · Mana value ${C.mv(f)??'?'}</p><p>${esc(f?.mana_cost||'')}</p><div class="wb-card-tags">${tags(f,20)}</div><div class="wb-oracle">${esc(f?.oracle_text || (f?.card_faces||[]).map(x=>x.name+'\n'+(x.mana_cost||'')+'\n'+(x.oracle_text||'')).join('\n\n') || 'Use Look up card facts to retrieve Oracle text.').replace(/\n/g,'<br>')}</div><div class="wb-traits">${C.traits(f).map(t=>`<span>${esc(t)}</span>`).join('')}</div><h3>Your copies</h3><p><strong>${own.available} available · ${own.totalOwned} owned</strong>${own.proxyQuantity?' · '+own.proxyQuantity+' proxies':''}</p><ul>${own.locations.map(l=>`<li>${esc(l.binder)} × ${l.quantity}${l.proxyQuantity?' (plus '+l.proxyQuantity+' proxies)':''}</li>`).join('')}</ul><p>${own.usedInDecks.map(d=>esc(d.deckName)+' ×'+d.quantity+(d.status==='inferred'?' (inferred)':'')).join(' · ')}</p>${own.records.length?`<label class="wb-field">Owned printing<select id="wb-printing">${own.records.map(r=>`<option value="${esc(r.scryfallId||'')}"${r.scryfallId===imgSid?' selected':''}>${esc(r.set)} #${esc(r.collectorNumber)} · ${esc(r.finish)} · ${esc(r.binder)}</option>`).join('')}</select></label>`:''}<p>Printing reference: ${money(price(f,own.records.find(r=>r.scryfallId===imgSid)?.finish || 'normal'))}</p>${historyHtml(f)}<p class="wb-help">${f?._fetchedAt?'Facts retrieved '+new Date(f._fetchedAt).toLocaleString():''}</p><div class="wb-actions"><button class="btn small" data-wb="lookup" data-name="${esc(name)}" data-sid="${esc(imgSid)}">Look up card facts</button>${f?.scryfall_uri?`<a class="btn small" href="${esc(safeUrl(f.scryfall_uri))}" target="_blank" rel="noopener">Scryfall & rulings</a>`:''}</div></div></div>
    <section class="wb-alternatives"><h3>Owned cards with similar jobs</h3><p>Compare Oracle text, targets, timing, card type and mana. These are candidates, not guaranteed equivalents.${standard()?' Only cards with Standard-legal facts are suggested.':ci?' Filtered to commander colors.':''}</p><div>${matches.map(c=>`<article><button data-wb="inspect" data-name="${esc(c.name)}">${cardImage(c.name,c.sid)}<strong>${esc(c.name)}</strong></button><p>${c.fact.faceName ? esc(c.fact.faceName) + " · " : ""}${esc(c.fact.mana_cost||'')} · MV ${C.mv(c.fact)} (${(C.mv(c.fact)||0)-(C.mv(c.baseEffect)||0)>=0?'+':''}${(C.mv(c.fact)||0)-(C.mv(c.baseEffect)||0)}) · ${c.own.available} available / ${c.own.totalOwned} owned</p><p>${esc(c.shared.map(labelFor).join(' · '))}</p><p class="wb-compare-oracle">${esc(c.fact.oracle_text || C.text(c.fact))}</p><p>${esc(C.traits(c.fact).join(' · '))}</p><p>${esc(c.own.usedInDecks.map(d=>d.deckName+" ×"+d.quantity+(d.status==="inferred"?" (inferred)":"")).join(" · "))}</p>${inDeck?`<button class="btn small" data-wb="swap" data-from="${esc(name)}" data-name="${esc(c.name)}">Replace one ${esc(name)}</button>`:`<button class="btn small" data-wb="add" data-name="${esc(c.name)}">Add to deck</button>`}</article>`).join('')||'<p class="wb-help">No indexed owned cards share this effect within the selected format. Refresh facts or explore another effect filter.</p>'}</div></section>`,true);
    const printing=dialog.querySelector('#wb-printing');if(printing)printing.onchange=()=>inspect(name,printing.value);
  }
  function importDialog() {
    showDialog('Import a decklist',`<p>Paste a list from ManaBox, Moxfield, Archidekt or Arena. Commander and sideboard sections are preserved. Review before replacing this draft.</p><label class="wb-field">Format<select id="wb-import-format"><option value="commander"${!standard()?' selected':''}>Commander</option><option value="standard"${standard()?' selected':''}>Standard</option></select></label><label class="wb-field">Decklist<textarea id="wb-import-text" rows="12" placeholder="Commander\n1 Your commander\n\nDeck\n1 Sol Ring\n10 Island"></textarea></label><input type="file" id="wb-import-file" accept=".txt,.dec,.dek,text/plain"><div class="wb-actions"><button class="btn primary" data-wb="parse">Preview import</button></div><div id="wb-import-preview" aria-live="polite"></div>`);
    dialog.querySelector('#wb-import-file').onchange=async e=>{if(e.target.files[0])dialog.querySelector('#wb-import-text').value=await e.target.files[0].text();};
  }
  function openDialog() {
    showDialog('Open a deck',`<h3>Workbench drafts</h3><div class="wb-open-list">${drafts.filter(d=>!d.archived).map(d=>`<div class="wb-open-row"><button class="btn" data-wb="draft" data-id="${esc(d.id)}">${esc(d.name)} <span>${d.cards.reduce((s,c)=>s+c.q,0)} cards</span></button><button class="wb-link" data-wb="archive-draft" data-id="${esc(d.id)}">Archive</button></div>`).join('')}<details><summary>Archived drafts (${drafts.filter(d=>d.archived).length})</summary>${drafts.filter(d=>d.archived).map(d=>`<button class="btn" data-wb="restore-draft" data-id="${esc(d.id)}">Restore ${esc(d.name)}</button>`).join('')}</details></div><h3>Protected deck binders</h3><p>Open a working copy and use its own cards. The allocation ledger remains unchanged.</p><div class="wb-open-list">${ledger.decks.map(d=>`<button class="btn" data-wb="binder-deck" data-id="${esc(d.id)}">${esc(d.name)}${d.status==='inferred'?' (inferred)':''}</button>`).join('')}</div><h3>Existing Aether Vault decks</h3><div class="wb-open-list">${Store.state.userdecks.map(d=>`<button class="btn" data-wb="legacy-deck" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('')||'<p>No saved decks in this browser origin. Restore an Aether Vault backup on the Data page to bring them here.</p>'}</div>`);
  }
  function collectionDialog() {
    showDialog('Collection & allocations',`<p><strong>${esc(sourceLabel())}</strong> · ${(snapshot?.records||[]).length.toLocaleString()} printing rows</p><p>Only named free binders and the selected target deck count as available. Drafts do not reserve physical cards.</p><h3>Free binders</h3><p>${esc(ledger.availableBinders.join(', ')||'None')}</p><h3>Protected decks</h3><ul>${ledger.decks.map(d=>`<li>${esc(d.name)} · ${esc(d.mode)} · ${esc(d.status||'recorded')}</li>`).join('')}</ul><h3>Needs classification</h3><p>${esc((audit.unclassifiedBinders||[]).join(', ')||'No unclassified binders reported.')}</p>${audit.conflicts?.length?'<p class="wb-notice">Allocation conflicts exist. Review your ledger before buying or moving cards.</p>':''}${audit.missingBinders?.length?`<p class="wb-notice">Missing binders: ${esc(audit.missingBinders.join(', '))}</p>`:''}<p class="wb-help">Allocation changes use the existing mtg deck-save workflow. Inferred assignments remain labeled. Uploading a CSV here creates a Workbench override; it does not replace your archived baseline.</p><label class="wb-field">Load a ManaBox CSV into Workbench<input id="wb-collection-file" type="file" accept=".csv,text/csv"${local?'':' disabled'}></label><div class="wb-actions"><button class="btn" data-wb="baseline"${local?'':' disabled'}>Use saved baseline</button><button class="btn" data-wb="backup">Download Workbench backup</button></div><label class="wb-field">Restore Workbench backup<input id="wb-restore" type="file" accept=".json,application/json"></label>`);
    dialog.querySelector('#wb-collection-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{busy='Validating ManaBox export…';const v=await api('import-collection',{csv:await file.text(),name:file.name});custom=v;adopt(v);persist();closeDialog();note='Workbench collection replaced. Existing decks and the archived baseline are unchanged.';redraw();await hydrate();}catch(err){note=err.message;redrawStatus();}finally{busy='';redrawStatus();}};
    dialog.querySelector('#wb-restore').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const v=JSON.parse(await file.text());validateBackup(v);download('aether-workbench-before-restore.json',{app:'aether-workbench',version:1,drafts,active:draft.id,custom});drafts=v.drafts;draft=drafts.find(d=>d.id===v.active)||drafts[0];custom=v.custom||null;if(custom)adopt(custom);else if(local)adopt(await api('vault'));else adopt(browserCollection());undo=[];report=null;comboResult=null;comboError='';comboGeneration++;persist();closeDialog();redraw();await hydrate();}catch(err){note='Restore failed: '+err.message;redrawStatus();}};
  }
  function validateBackup(v) {
    if(v?.app!=='aether-workbench'||v.version!==1||!Array.isArray(v.drafts)||!v.drafts.length||v.drafts.length>200)throw Error('Not a supported Workbench backup.');
    const ids=new Set();for(const d of v.drafts){if(typeof d.id!=='string'||ids.has(d.id)||typeof d.name!=='string'||!Array.isArray(d.cards)||d.cards.length>600)throw Error('Invalid draft.');ids.add(d.id);for(const c of d.cards)if(typeof c.n!=='string'||!c.n.trim()||!Number.isSafeInteger(c.q)||c.q<1||c.q>1000||!['main','commander','sideboard'].includes(c.zone))throw Error('Invalid deck card.');}
    if(v.custom){
      const s=v.custom.snapshot,l=v.custom.ledger;
      if(s?.schemaVersion!==1||!Array.isArray(s.records)||s.records.length>50000||!Array.isArray(l?.decks)||!Array.isArray(l.availableBinders))throw Error('Invalid custom collection.');
      if(s.records.some(r=>typeof r.name!=='string'||!r.name.trim()||!Number.isSafeInteger(r.quantity)||r.quantity<1||typeof r.proxy!=='boolean'||typeof r.binder!=='string'||typeof r.binderType!=='string'))throw Error('Invalid collection record.');
      if(l.availableBinders.some(b=>typeof b!=='string')||l.decks.some(d=>typeof d.id!=='string'||typeof d.name!=='string'||!['binder','list'].includes(d.mode)||(d.mode==='binder'?typeof d.binder!=='string':!Array.isArray(d.cards)||d.cards.some(c=>typeof c.name!=='string'||!Number.isSafeInteger(c.quantity)||c.quantity<1))))throw Error('Invalid allocation ledger.');
    }
  }
  function historyHtml(f) {
    const history=(f?._priceHistory || []).filter(p=>p.prices?.usd!=null), values=history.map(p=>Number(p.prices.usd));
    if(!history.length)return '<p class="wb-help">Price tracking begins with a fresh card-facts retrieval. Refresh on later days to build history.</p>';
    const low=Math.min(...values),high=Math.max(...values),span=high-low||1;
    const points=values.map((v,i)=>(i/Math.max(1,values.length-1)*250).toFixed(1)+','+(40-(v-low)/span*32).toFixed(1)).join(' ');
    return `<details class="wb-history"><summary>Printing price history · ${history.length} daily observations</summary>${history.length>1?`<svg viewBox="0 0 260 48" role="img" aria-label="Recorded nonfoil price trend"><polyline points="${points}" fill="none" stroke="#5457d6" stroke-width="2"/></svg>`:''}<ul>${history.slice(-10).map(p=>`<li>${esc(p.date)} · ${money(Math.round(Number(p.prices.usd)*100))}</li>`).join('')}</ul><p class="wb-help">Recorded on retrieval, up to 90 days per printing. No historical prices are invented.</p></details>`;
  }
  async function runQuote() {
    const cards=coverage().map(c=>({name:c.n,quantity:c.q,finish:document.getElementById('wb-quote-finish')?.value||'normal'}));
    const fingerprint=JSON.stringify(draft), version=inventoryVersion;
    busy='Starting live printing comparison…';redraw();
    try{const job=await api('quote',{expectedHash:snapshot.sha256,plan:{cards,targetDeckId:draft.targetDeckId||undefined},...(custom||!local?{snapshot,ledger}:{})});let j;
      do{await new Promise(r=>setTimeout(r,1500));j=await api('jobs/'+job.id);busy=`Pricing ${j.completed || 0} / ${j.total || cards.length} names; comparing all printings…`;redrawStatus();}while(j.status==='running');
      if(j.status==='error')throw Error(j.error);
      if(fingerprint!==JSON.stringify(draft)||version!==inventoryVersion){note='The deck changed during pricing. Refresh the quote for the current deck.';}else{report=j.result;note='Live purchase quote updated.';}
    }catch(e){note='Could not complete quote: '+e.message;}finally{busy='';redraw();}
  }
  function openNew(d) { addZone='main';filters.fit=false;filters.legal=false;drafts.push(d);draft=d;undo=[];report=null;comboResult=null;comboError='';comboGeneration++;rebuild();persist();closeDialog();redraw();hydrate(false,d.cards.map(c=>c.n)); }
  async function handleClick(e) {
    const b=e.target.closest('[data-wb]');if(!b||b.disabled)return;const action=b.dataset.wb,name=b.dataset.name;
    try {
      if(action==='close')return closeDialog();
      if(action==='inspect')return inspect(name,b.dataset.sid);
      if(action==='flip')return inspect(name,b.dataset.sid,Number(b.dataset.face));
      if(action==='add'||action==='sideboard'){add(name,action==='sideboard'?'sideboard':dialog?'main':addZone);if(dialog)inspect(selected);return;}
      if(action==='move-zone'){change(()=>{const from=draft.cards.find(c=>C.key(c.n)===C.key(name)&&c.zone===b.dataset.zone);if(!from)return;from.q--;const zone=from.zone==='main'?'sideboard':'main',to=draft.cards.find(c=>C.key(c.n)===C.key(name)&&c.zone===zone);if(to)to.q++;else draft.cards.push({n:name,q:1,zone});draft.cards=draft.cards.filter(c=>c.q>0);});inspect(name);return;}
      if(action==='commander' && draft.format==='commander'){change(()=>{const existing=draft.cards.find(c=>inventory.canonical(c.n)===inventory.canonical(name));if(existing){existing.zone='commander';existing.q=1;}else draft.cards.push({n:name,q:1,zone:'commander'});});closeDialog();return;}
      if(action==='swap'){change(()=>{const from=draft.cards.find(c=>inventory.canonical(c.n)===inventory.canonical(b.dataset.from)&&c.zone!=='sideboard');if(!from)return;const z=from.zone;from.q--;draft.cards=draft.cards.filter(c=>c.q>0);const to=draft.cards.find(c=>inventory.canonical(c.n)===inventory.canonical(name)&&c.zone===z);if(to)to.q++;else draft.cards.push({n:name,q:1,zone:z});});inspect(name);return;}
      if(action==='lookup'){const sid=b.dataset.sid;closeDialog();await hydrate(true,[name],sid);inspect(name,sid);return;}
      if(action==='qty')return change(()=>{const c=draft.cards[Number(b.dataset.index)];c.q+=Number(b.dataset.delta);draft.cards=draft.cards.filter(c=>c.q>0);});
      if(action==='undo'){if(undo.length){const d=JSON.parse(undo.pop());Object.assign(draft,d);report=null;comboResult=null;comboError='';comboGeneration++;rebuild();persist();redraw();}return;}
      if(action==='new')return showDialog('Create a deck',`<p>Choose the rules for this deck. You can change the format later.</p><div class="wb-format-choices"><button class="btn" data-wb="new-format" data-id="commander"><strong>Commander</strong><span>100 cards · singleton · commander identity</span></button><button class="btn" data-wb="new-format" data-id="standard"><strong>Standard</strong><span>60+ main · up to 15 sideboard · four copies</span></button></div>`);
      if(action==='new-format')return openNew(blank('New '+b.dataset.id+' deck',b.dataset.id));
      if(action==='open')return openDialog();
      if(action==='archive-draft'){const d=drafts.find(d=>d.id===b.dataset.id);if(d){d.archived=true;undo=[];report=null;comboResult=null;comboError='';comboGeneration++;if(d===draft){draft=drafts.find(x=>!x.archived)||blank();if(!drafts.includes(draft))drafts.push(draft);}rebuild();persist();redraw();openDialog();}return;}
      if(action==='restore-draft'){const d=drafts.find(d=>d.id===b.dataset.id);if(d)d.archived=false;persist();return openDialog();}
      if(action==='draft'){draft=drafts.find(d=>d.id===b.dataset.id)||draft;undo=[];report=null;comboResult=null;comboError='';comboGeneration++;rebuild();persist();closeDialog();redraw();return hydrate(false,draft.cards.map(c=>c.n));}
      if(action==='binder-deck'){
        const d=ledger.decks.find(d=>d.id===b.dataset.id), cs=new Map();
        const records=d.mode==='binder'?(snapshot.records||[]).filter(r=>r.binder===d.binder&&!r.proxy):d.cards.map(c=>({name:c.name,quantity:c.quantity}));
        records.forEach(r=>{const k=inventory.canonical(r.name);if(cs.has(k))cs.get(k).q+=r.quantity;else cs.set(k,{n:fact(r.name)?.name||r.name,q:r.quantity,zone:'main'});});
        return openNew({...blank(d.name+' · working copy'),targetDeckId:d.id,cards:[...cs.values()]});
      }
      if(action==='legacy-deck')return openStored(b.dataset.id);
      if(action==='import')return importDialog();
      if(action==='parse'){
        const parsed=C.parseDeck(dialog.querySelector('#wb-import-text').value);const preview=dialog.querySelector('#wb-import-preview');
        preview.innerHTML=`<p>${parsed.cards.reduce((s,c)=>s+c.q,0)} cards · ${parsed.cards.filter(c=>c.zone==='commander').length} commanders · ${parsed.cards.filter(c=>c.zone==='sideboard').reduce((s,c)=>s+c.q,0)} sideboard cards</p>${parsed.errors.map(s=>`<p class="wb-notice">${esc(s)}</p>`).join('')}${parsed.ignored.length?`<p>Ignored metadata: ${parsed.ignored.map(x=>esc(x.text)).join('; ')}</p>`:''}<div class="wb-import-review">${parsed.cards.map(c=>`<div>${c.q} ${esc(c.n)} <small>${esc(c.zone)}</small></div>`).join('')}</div><button class="btn primary" data-wb="apply-import"${parsed.errors.length||!parsed.cards.length?' disabled':''}>Replace draft with this list</button>`;return;
      }
      if(action==='apply-import'){const parsed=C.parseDeck(dialog.querySelector('#wb-import-text').value);if(parsed.errors.length||!parsed.cards.length)return;const format=dialog.querySelector('#wb-import-format').value;change(()=>{draft.cards=parsed.cards;C.setFormat(draft,format);filters.fit=false;addZone='main';});closeDialog();return hydrate(false,draft.cards.map(c=>c.n));}
      if(action==='backup')return download('aether-workbench-backup.json',{app:'aether-workbench',version:1,drafts,active:draft.id,custom});
      if(action==='collection')return collectionDialog();
      if(action==='baseline'){if(hydrating)throw Error('Wait for card indexing to finish before switching collection.');custom=null;adopt(await api('vault'));persist();closeDialog();redraw();return hydrate();}
      if(action==='export')return download(draft.name.replace(/[^a-z0-9 -]/gi,'')+'.txt',C.deckText(draft),'text/plain');
      if(action==='save-legacy'){
        const cmds=draft.cards.filter(c=>c.zone==='commander');if(cmds.length>1)throw Error('The existing Decks page supports one commander. Keep this paired-commander deck in Workbench or export it.');
        showDialog('Copy to existing Decks',`<p>This creates a separate deck in Aether Vault’s existing Decks page. The format and all sideboard cards are preserved. Any sync you have configured for Aether Vault applies to that copy.</p><button class="btn primary" data-wb="confirm-legacy">Create deck copy</button>`);return;
      }
      if(action==='confirm-legacy'){const d=Store.createUserDeck(draft.name,draft.cards.filter(c=>c.zone!=='sideboard').map(c=>({n:c.n,q:c.q,sid:fact(c.n)?.id||''})),draft.cards.find(c=>c.zone==='commander')?.n||'',{format:draft.format,sideboard:draft.cards.filter(c=>c.zone==='sideboard')});closeDialog();note='Created '+d.name+' on the Decks page with its format and sideboard.';redraw();return;}
      if(action==='tab'){tab=b.dataset.id;return redraw();}
      if(action==='view'){filters.view=filters.view==='art'?'list':'art';return redrawPanels();}
      if(action==='page'){filters.page+=Number(b.dataset.id);redrawPanels();document.getElementById('wb-library-body')?.scrollIntoView({block:'start'});return;}
      if(action==='color'){filters.colors=filters.colors.includes(b.dataset.id)?filters.colors.replace(b.dataset.id,''):filters.colors+b.dataset.id;filters.page=1;return redraw();}
      if(action==='clear-filters'){Object.assign(filters,{search:'',binder:'',type:'',role:'',colors:'',availability:'all',mv:'',maxPrice:'',finish:'',set:'',rarity:'',fit:false,legal:false,page:1});return redraw();}
      if(action==='facts')return hydrate(true);
      if(action==='quote')return runQuote();
      if(action==='quote-export')return download('aether-purchase-quote.json',report);
      if(action==='combo-export')return download('aether-spellbook-evidence.json',comboResult);
      if(action==='copy-combos'){
        await navigator.clipboard.writeText(C.deckText({...draft,cards:draft.cards.filter(c=>c.zone!=='sideboard')}));note='Main deck and commanders copied for Spellbook.';redrawStatus();return;
      }
      if(action==='combos'){
        if(comboBusy)return;
        const fingerprint=JSON.stringify(draft), generation=++comboGeneration;
        comboBusy=true;comboError='';comboResult=null;redraw();
        document.getElementById('wb-combo-results')?.scrollIntoView({block:'nearest'});
        try{
          const r=await api('combos',C.comboPayload(draft,facts),150000);
          if(generation===comboGeneration && fingerprint===JSON.stringify(draft))comboResult=r;
          else comboError='The deck changed during the search. Find combinations again for the current deck.';
        }catch(err){comboError=err.name==='TimeoutError'?'Combo search timed out. Please retry or use the official finder.':'Combo search failed: '+err.message;}
        finally{comboBusy=false;redraw();if(tab==='interactions')document.getElementById('wb-combo-results')?.scrollIntoView({block:'nearest'});}
        return;
      }
    } catch(err){note=err.message;redrawStatus();if(dialog){let el=dialog.querySelector('.wb-dialog-error');if(!el){el=document.createElement('p');el.className='wb-dialog-error wb-notice';dialog.querySelector('.wb-dialog-body').appendChild(el);}el.textContent=err.message;}}
  }
  function bind(root) {
    let drag=null,ghost=null,suppressClick=false;
    const clearDrag=()=>{ghost?.remove();ghost=null;root.querySelector('.wb-drop-active')?.classList.remove('wb-drop-active');drag=null;};
    root.onclick=e=>{const action=e.target.closest('[data-wb]');if(action?.dataset.wb==='filters'){mobileFiltersOpen=!mobileFiltersOpen;redraw();return;}if(action?.dataset.wb==='jump'){root.querySelector('.wb-'+action.dataset.id)?.scrollIntoView({block:'start'});return;}if(suppressClick){e.preventDefault();suppressClick=false;return;}handleClick(e);};
    root.oninput=e=>{const el=e.target;if(el.id==='wb-deck-name'){draft.name=el.value.trim()||'Untitled deck';draft.updated=new Date().toISOString();persist();}if(el.dataset.filter && (el.type==='search'||el.type==='number')){filters[el.dataset.filter]=el.value;filters.page=1;redrawPanels();}};
    root.onchange=e=>{const el=e.target;
      if(el.dataset.qty!==undefined){const q=Number(el.value);if(Number.isInteger(q)&&q>=0&&q<=1000)change(()=>{draft.cards[Number(el.dataset.qty)].q=q;draft.cards=draft.cards.filter(c=>c.q>0);});else{note='Use a whole quantity from 0 to 1000.';redraw();}return;}
      if(el.dataset.filter){filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;filters.page=1;redrawPanels();}
      if(el.id==='wb-deck-name')change(()=>{draft.name=el.value.trim()||'Untitled deck';});
      if(el.id==='wb-format')change(()=>{C.setFormat(draft,el.value);filters.fit=false;filters.legal=false;addZone='main';});
      if(el.id==='wb-add-zone'){addZone=el.value;}
      if(el.id==='wb-target')change(()=>{draft.targetDeckId=el.value;});
      if(el.id==='wb-group'){group=el.value;redrawPanels();}
    };
    root.ondragstart=e=>{const card=e.target.closest('[data-card]');if(card){e.dataTransfer.setData('application/x-aether-card',card.dataset.card);e.dataTransfer.setData('text/plain',card.dataset.card);e.dataTransfer.effectAllowed='copy';}};
    root.ondragover=e=>{if(e.target.closest('#wb-drop')){e.preventDefault();e.dataTransfer.dropEffect='copy';root.querySelector('#wb-drop').classList.add('wb-drop-active');}};
    root.ondragleave=e=>{if(e.target.id==='wb-drop')e.target.classList.remove('wb-drop-active');};
    root.ondrop=e=>{const drop=e.target.closest('#wb-drop');if(drop){e.preventDefault();drop.classList.remove('wb-drop-active');const name=e.dataTransfer.getData('application/x-aether-card');if(name&&catalog.some(c=>C.key(c.name)===C.key(name)))add(name);}};
    // Mouse/pen can drag; touch keeps natural scrolling and uses the Add button.
    root.onpointerdown=e=>{const card=e.target.closest('[data-card]');if(e.pointerType==='touch'||e.button!==0||!card||e.target.closest('.wb-add'))return;drag={name:card.dataset.card,x:e.clientX,y:e.clientY,id:e.pointerId,active:false};};
    root.onpointermove=e=>{
      if(!drag||drag.id!==e.pointerId)return;
      if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){drag.active=true;root.setPointerCapture(e.pointerId);ghost=document.createElement('div');ghost.className='wb-drag-ghost';ghost.textContent=drag.name;document.body.appendChild(ghost);}
      if(drag.active){e.preventDefault();ghost.style.left=(e.clientX+14)+'px';ghost.style.top=(e.clientY+12)+'px';const over=document.elementFromPoint(e.clientX,e.clientY)?.closest('.wb-deck');root.querySelector('#wb-drop')?.classList.toggle('wb-drop-active',!!over);}
    };
    root.onpointerup=e=>{if(!drag)return;const current=drag,over=document.elementFromPoint(e.clientX,e.clientY)?.closest('.wb-deck');if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);clearDrag();if(current.active){suppressClick=true;setTimeout(()=>{suppressClick=false;},100);if(over)add(current.name);}};
    root.onpointercancel=clearDrag;
    root.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.classList.add('wb-image-failed');e.target.alt+=' · image unavailable';}},true);
  }
  function render() { if(!inventory)rebuild();return shell(); }
  function openStored(id) {const d=Store.userDeck(id);if(d)openNew({...blank(),...C.fromStoredDeck(d),name:d.name+' · working copy'});}
  function mount(root) {bind(root);init().then(()=>{const id=new URLSearchParams(location.hash.split('?')[1]||'').get('deck');if(id&&visible()){history.replaceState(null,'','#/workbench');openStored(id);}});}
  return { render, mount, close:closeDialog, validateBackup };
})();
