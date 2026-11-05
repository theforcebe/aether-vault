// Aether Vault: rendering and interaction. v3.

const UI = (() => {
  const P=window.Printings;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => '$' + (v || 0).toFixed(2);
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const CI_COLORS = { W: '#f2ecd7', U: '#5b8fc9', B: '#4a4550', R: '#d96b5a', G: '#5a9a72', C: '#c2c4cb' };

  let dragCard = null;
  const reports = {}; // deckId -> analysis result (session memory)

  const versionAttr = p => ' data-printing="'+esc(JSON.stringify(p || null))+'"';
  function elementPrinting(el) { try{return JSON.parse(el?.closest('[data-printing]')?.dataset.printing || 'null');}catch(_){return null;} }
  function versionHtml(p) {
    if(!p)return '<small class="printing-label">Version not selected</small>';
    const f=Store.state.prices[p.id], m=P.metadata(p,f);
    const setName=m.setName || window.VAULT_SETS?.sets.find(s=>s.c.toUpperCase()===p.set)?.n || '';
    return '<span class="printing-label"><span>'+esc(setName || p.set || 'Unknown set')+'</span><span class="printing-details">'+esc([setName?p.set:'',p.collectorNumber?'#'+p.collectorNumber:'',P.finishLabel(p.finish)].filter(Boolean).join(' · '))+'</span>'+ (m.styles.length?'<span class="printing-style">'+esc(m.styles.join(' · '))+'</span>':'')+'</span>';
  }
  // ---------- primitives ----------
  function pips(ci) {
    if (!ci) return '';
    return [...ci].map((c) => '<span class="pip" style="background:' + (CI_COLORS[c] || '#999') + '"></span>').join('');
  }
  function cardImgHtml(n, sid, cls) {
    const src = sid ? Scry.img(sid, 'normal') : '';
    return '<div class="card-img ' + (cls || '') + '" data-name="' + esc(n) + '">' +
      (src ? '<img loading="lazy" src="' + src + '" alt="' + esc(n) + '">' : '<div class="card-ph">' + esc(n) + '</div>') +
      '</div>';
  }
  const thumb = (sid) => sid ? '<img class="thumb" loading="lazy" src="' + Scry.img(sid, 'small') + '" alt="">' : '<span class="thumb ph"></span>';

  // ManaBox-style movement since the app first saw a price for this printing:
  // +24.36 (+33.2%) in green, or red when down.
  function tickFmt(t) {
    if (!t) return '';
    const up = t.d >= 0;
    const sign = up ? '+' : '-';
    return '<span class="tick ' + (up ? 'up' : 'down') + '"><span class="tick-amount">' + sign + Math.abs(t.d).toFixed(2) +
      '</span> <span class="tick-percent">(' + sign + Math.abs(t.pct).toFixed(1) + '%)</span></span>';
  }
  function tickerHtml(n, sid, f) {
    return tickFmt(Store.ticker(n, sid, f || ''));
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
  }

  function dl(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = filename;
    a.click();
  }

  function hoverPreview() {
    let tip = $('#hover-card');
    if (!tip) { tip = document.createElement('div'); tip.id = 'hover-card'; document.body.appendChild(tip); }
    tip.setAttribute('aria-hidden', 'true');
    let active = null, timer;
    const hide = () => { clearTimeout(timer); active = null; tip.style.display = 'none'; };
    const eligible = e => {
      if (e.pointerType && e.pointerType !== 'mouse') return null;
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || window.innerWidth <= 900) return null;
      const el = e.target.closest('[data-hover-sid]');
      if (!el || !el.getAttribute('data-hover-sid')) return null;
      // Actions and prices must never summon art. List previews belong to the
      // name/thumbnail, and are placed outside the complete active row.
      if (el.matches('.list-row, .d-row, .sugg-row, .hold-row') && !e.target.closest('.thumb, .list-n, .d-n, .sugg-n, .hold-n')) return null;
      if (e.target.closest('input, select, textarea, [data-move], [data-remove], [data-inc], [data-dec], [data-bought], [data-cpadd]')) return null;
      return el;
    };
    document.addEventListener('pointerover', e => {
      const el = eligible(e);
      if (el === active) return;
      hide(); if (!el) return; active = el;
      timer = setTimeout(() => {
        if (active !== el || !el.isConnected) return;
        const row = el.closest('.list-row, .d-row, .sugg-row, .hold-row') || el;
        const r = row.getBoundingClientRect(), margin = 12, gap = 12;
        const top = Math.max(margin, $('.topbar')?.getBoundingClientRect().bottom || 0) + gap;
        const above = r.top - top - gap, below = window.innerHeight - margin - r.bottom - gap;
        const side = below >= 320 || below >= above ? 'below' : 'above';
        const height = Math.min(334, side === 'below' ? below : above);
        if (height < 160) { hide(); return; }
        const width = height * 488 / 680;
        tip.style.width = width + 'px';
        tip.style.left = Math.max(margin, Math.min(e.clientX - width / 2, window.innerWidth - width - margin)) + 'px';
        tip.style.top = (side === 'below' ? r.bottom + gap : r.top - gap - height) + 'px';
        tip.innerHTML = '<img src="' + Scry.img(el.getAttribute('data-hover-sid'), 'normal') + '" alt="">';
        tip.style.display = 'block';
      }, 180);
    });
    document.addEventListener('pointerout', e => {
      if (active && (!e.relatedTarget || !active.contains(e.relatedTarget))) hide();
    });
    for (const event of ['scroll', 'pointerdown', 'keydown']) document.addEventListener(event, hide, true);
    for (const event of ['resize', 'blur', 'hashchange']) window.addEventListener(event, hide);
  }

  function sheet(title, options) {
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    w.innerHTML = '<div class="sheet"><div class="sheet-title">' + esc(title) + '</div>' +
      options.map((o, i) => '<button class="sheet-opt" data-i="' + i + '">' + esc(o.label) + '</button>').join('') +
      '<button class="sheet-opt cancel">Cancel</button></div>';
    document.body.appendChild(w);
    w.addEventListener('click', (e) => {
      if (e.target === w || e.target.classList.contains('cancel')) { w.remove(); return; }
      const b = e.target.closest('.sheet-opt[data-i]');
      if (b) { w.remove(); options[parseInt(b.getAttribute('data-i'), 10)].cb(); }
    });
  }

  function moveSheet(cardName, fromKey, printing) {
    const opts = [];
    for (const ref of Store.allDeckRefs()) {
      if (ref.key === fromKey) continue;
      opts.push({ label: 'Add to ' + ref.name, cb: () => { Store.addToUserDeck(ref.key, cardName, 1, 'main', printing); Store.addMove(cardName, fromKey, ref.key); toast('Added, and logged in Moves.'); App.refresh(); } });
    }
    if (fromKey !== 'collection') opts.push({ label: 'Log move back to collection', cb: () => { Store.addMove(cardName, fromKey, 'collection'); toast('Logged in Moves.'); App.refresh(); } });
    if (!opts.length) opts.push({ label: 'Create a deck first (Decks page)', cb: () => { location.hash = '#/decks'; } });
    sheet(cardName, opts);
  }

  // ---------- charts ----------
  function curveChart(cards) {
    const bins = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const c of cards) {
      const f = Store.card(c.n);
      if (f && (f.t || '').toLowerCase().includes('land')) continue;
      bins[Math.min(Math.floor((f && f.mv) || 0), 7)] += c.q;
    }
    const max = Math.max(...bins, 1);
    return '<div class="curve">' + bins.map((v, i) =>
      '<div class="cv-col"><div class="cv-bar" style="height:' + Math.round((v / max) * 66) + 'px"></div>' +
      '<div class="cv-n">' + v + '</div><div class="cv-l">' + (i === 7 ? '7+' : i) + '</div></div>').join('') + '</div>';
  }
  function donutFrom(counts, size) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) return '';
    const R = 34, CIRC = 2 * Math.PI * R;
    let off = 0, segs = '';
    for (const [ch, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const len = (v / total) * CIRC;
      segs += '<circle r="' + R + '" cx="45" cy="45" class="donut-seg" stroke="' + (CI_COLORS[ch] || '#b9bcc4') +
        '" stroke-dasharray="' + len.toFixed(1) + ' ' + (CIRC - len).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '"/>';
      off += len;
    }
    return '<svg viewBox="0 0 90 90" class="donut" style="width:' + (size || 88) + 'px;height:' + (size || 88) + 'px">' + segs + '</svg>';
  }
  function pipDonut(cards) {
    const counts = {};
    for (const c of cards) {
      const f = Store.card(c.n);
      if (!f || (f.t || '').toLowerCase().includes('land')) continue;
      for (const ch of (f.ci || 'C') === '' ? 'C' : (f.ci || 'C')) counts[ch] = (counts[ch] || 0) + c.q;
    }
    return donutFrom(counts);
  }
  function lineChart(points, opts) {
    const o = opts || {};
    if (!points || points.length < 2) {
      return '<div class="chart-empty">' + (o.empty || 'Refresh prices on different days to build value history. One snapshot per day.') + '</div>';
    }
    const W = 640, H = 190, P = { l: 46, r: 12, t: 14, b: 24 };
    const vs = points.map((p) => p.v);
    let min = Math.min(...vs), max = Math.max(...vs);
    if (max - min < 1) { max += 1; min = Math.max(0, min - 1); }
    const pad = (max - min) * 0.12;
    min = Math.max(0, min - pad); max += pad;
    const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
    const pts = points.map((p, i) => x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
    const area = 'M' + x(0).toFixed(1) + ',' + y(points[0].v).toFixed(1) +
      points.map((p, i) => 'L' + x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join('') +
      'L' + x(points.length - 1).toFixed(1) + ',' + (H - P.b) + 'L' + x(0).toFixed(1) + ',' + (H - P.b) + 'Z';
    const last = points[points.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="line-chart">' +
      [min, (min + max) / 2, max].map((v) => '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (P.l - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" class="axis" text-anchor="end">' + money0(v) + '</text>').join('') +
      '<path d="' + area + '" class="area"/><polyline points="' + pts + '" class="line"/>' +
      '<circle cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '" r="3.5" class="dot"/>' +
      '<text x="' + P.l + '" y="' + (H - 6) + '" class="axis">' + points[0].d + '</text>' +
      '<text x="' + (W - P.r) + '" y="' + (H - 6) + '" class="axis" text-anchor="end">' + last.d + '</text></svg>';
  }
  function hbars(entries) {
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return '<div class="hbars">' + entries.map(([label, v]) =>
      '<div class="hbar-row"><span class="hbar-l">' + esc(label) + '</span>' +
      '<span class="hbar-track"><span class="hbar-fill" style="width:' + ((v / max) * 100).toFixed(1) + '%"></span></span>' +
      '<span class="hbar-v">' + v.toLocaleString() + '</span></div>').join('') + '</div>';
  }

  function onboardHtml() {
    return '<div class="onboard"><h1>Your vault is empty</h1>' +
      '<p class="dim">This is a private workspace. Everything you load stays in this browser.</p>' +
      '<div class="onboard-grid">' +
      '<label class="onboard-card" for="file-csv"><strong>Upload a ManaBox export</strong><span class="dim">Collection CSV with binders, foils, and exact printings. Parsed locally.</span></label>' +
      '<a class="onboard-card" href="#/import"><strong>Import a decklist</strong><span class="dim">Paste any list. Images and prices load from Scryfall.</span></a>' +
      '<a class="onboard-card" href="#/build"><strong>Suggest me a deck</strong><span class="dim">Pick a theme and bracket; get a popular build with a costed buy list.</span></a>' +
      (Store.seedAvailable() && !Store.state.seeded
        ? '<button class="onboard-card" id="seed-import"><strong>Load the built-in vault</strong><span class="dim">One-time import of Keanen’s collection and seven decks, as editable copies.</span></button>'
        : '') +
      '</div></div>';
  }

  // ---------- views ----------
  function viewDashboard(params) {
    if (!Store.hasCollection() && !Store.state.userdecks.length && !Store.state.sessions.length) return onboardHtml();

    const total = Store.collectionTotal();
    const age = Store.priceAge();
    const rows = Store.rows();
    const nCards = rows.reduce((s, r) => s + r.q, 0);
    const nUnique = Object.keys(Store.byName).length;
    const snaps = Store.state.snapshots;
    const chartKey = params.series || 'collection';
    const series = snaps.map((s) => ({ d: s.date, v: chartKey === 'collection' ? s.total : (s.decks && s.decks[chartKey]) }))
      .filter((p) => p.v != null);
    const deckRefs = Store.allDeckRefs();
    const chips = '<div class="chips"><button class="chip ' + (chartKey === 'collection' ? 'on' : '') + '" data-series="collection">Collection</button>' +
      deckRefs.map((r) => '<button class="chip ' + (chartKey === r.key ? 'on' : '') + '" data-series="' + r.key + '">' + esc(r.name.split(',')[0]) + '</button>').join('') + '</div>';

    const mv = Store.movers(8);
    const moversHtml = mv.length
      ? mv.map((m) => '<div class="mover" data-hover-sid="' + m.sid + '"><span>' + esc(m.n) + versionHtml(m.printing) + '</span>' +
        '<span class="' + (m.delta > 0 ? 'up' : 'down') + '">' + (m.delta > 0 ? '+' : '') + m.delta.toFixed(2) + '</span></div>').join('')
      : '<div class="dim">Movement appears after two price refreshes on different days.</div>';
    const holdings = Store.topHoldings(8).map((h) => {
      const tick = tickerHtml(h.n, h.sid, h.f);
      return '<div class="hold-row" data-hover-sid="' + (h.sid || '') + '">' + thumb(h.sid) +
        '<span class="hold-n">' + esc(h.n) +
        versionHtml(h.printing) +
        ' <span class="dim">x' + h.q + '</span></span>' +
        '<span class="hold-v">' + money(h.total) + (tick ? '<br>' + tick : '') + '</span></div>';
    }).join('');
    const dist = Store.distribution();
    const deckVals = deckRefs.map((r) => [r.name.split(',')[0], Math.round(Store.userDeckTotal(r.key))])
      .sort((a, b) => b[1] - a[1]);

    const colBar = Store.hasCollection()
      ? '<div class="ws-bar"><div><span class="ws-label">Collection</span> <strong>' + esc(Store.collectionLabel()) + '</strong> <span class="dim">' + nCards.toLocaleString() + ' cards</span></div>' +
        '<div class="ws-actions"><label class="btn small" for="file-csv">Replace CSV</label>' +
        '<button class="btn small" id="ws-clear">Remove</button></div></div>'
      : '<div class="ws-bar"><div><span class="ws-label">No collection loaded.</span> <span class="dim">Deck features work without one.</span></div>' +
        '<div class="ws-actions"><label class="btn small" for="file-csv">Upload ManaBox CSV</label></div></div>';

    return colBar +
      '<section class="stat-row">' +
      '<div class="stat-tile"><div class="stat-label">Collection value</div><div class="stat-value">' + money(total) +
      (Store.collectionTicker() ? ' <span class="stat-tick">' + tickFmt(Store.collectionTicker()) + '</span>' : '') + '</div>' +
      '<div class="dim">' + (age == null ? 'Baseline estimate. Refresh for live prices.' : 'Prices ' + age.toFixed(1) + 'h old.') + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Cards</div><div class="stat-value">' + nCards.toLocaleString() + '</div><div class="dim">' + nUnique.toLocaleString() + ' unique</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Decks</div><div class="stat-value">' + deckRefs.length + '</div><div class="dim">' + Store.state.sessions.length + ' imported lists</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Snapshots</div><div class="stat-value">' + snaps.length + '</div><div class="dim">' + (snaps.length ? 'since ' + snaps[0].date : 'refresh prices to start') + '</div></div>' +
      '</section>' +
      '<section class="panel"><div class="panel-h">Value over time</div>' +
      chips + lineChart(series) + '</section>' +
      '<div class="two-col">' +
      '<section class="panel"><div class="panel-h">Top holdings</div>' + (holdings || '<div class="dim">Upload a collection to see holdings.</div>') + '</section>' +
      '<section class="panel"><div class="panel-h">Price movers</div>' + moversHtml + '</section></div>' +
      '<div class="two-col">' +
      '<section class="panel"><div class="panel-h">Deck value</div>' + (deckVals.length ? hbars(deckVals) : '<div class="dim">No decks yet.</div>') + '</section>' +
      '<section class="panel"><div class="panel-h">Collection makeup</div><div class="makeup">' + donutFrom(dist.color, 96) + hbars(Object.entries(dist.type).sort((a, b) => b[1] - a[1])) + '</div></section></div>';
  }

  function viewCollection(params) {
    const collectionHeader=CollectionUI.header();
    if (!Store.hasCollection()) {
      return collectionHeader+'<div class="onboard"><h1>No collection loaded</h1>' +
        '<p class="dim">Upload a ManaBox export to browse it here with binders, foils, and live prices.</p>' +
        '<div class="onboard-grid"><label class="onboard-card" for="file-csv"><strong>Upload ManaBox CSV</strong><span class="dim">Parsed in your browser. Nothing is uploaded to a server.</span></label>' +
        (Store.seedAvailable() && !Store.state.seeded ? '<button class="onboard-card" id="seed-import"><strong>Load the built-in vault</strong><span class="dim">Keanen’s collection and decks, one-time import.</span></button>' : '') +
        '</div></div>';
    }
    const q = (params.q || '').toLowerCase();
    const color = params.color || '';
    const type = params.type || '';
    const binder = params.binder || '';
    const sort = params.sort || 'name';
    const mode = params.mode || 'grid';
    const show = parseInt(params.show || '400', 10);

    const binders = Store.binderSummary().map((b) => b.name);
    const deckMap = Store.deckOf();
    const agg = {};
    for (const r of Store.rows()) {
      if(binder && r.b!==binder || params.set && r.s!==params.set || params.finish && P.finish(r.f)!==params.finish)continue;
      const k=Store.norm(r.n)+'|'+P.key(r), printing=P.selection(r);
      agg[k] ||= {n:r.n,q:0,sid:r.sid,printing,b:new Set()};
      agg[k].q+=r.q;agg[k].b.add(r.b);
    }
    let items = Object.values(agg).filter((it) => {
      if (q && !it.n.toLowerCase().includes(q)) return false;
      const c = Store.card(it.n);
      if (color) {
        const ci = c ? (c.ci || '') : '';
        if (color === 'C' ? ci !== '' : !ci.includes(color)) return false;
      }
      if (type && !(c && c.t.includes(type))) return false;
      if (binder && ![...it.b].includes(binder)) return false;
      return true;
    });
    const val = (it) => Store.knownCardValue(it.n, it.sid, it.printing?.finish);
    if (sort === 'price') items.sort((a, b) => val(b) - val(a));
    else if (sort === 'qty') items.sort((a, b) => b.q - a.q);
    else items.sort((a, b) => a.n.localeCompare(b.n));

    const shown = items.slice(0, show);
    const badgeRow = (it) => {
      const inDecks = deckMap[Store.norm(it.n)] || [];
      return inDecks.length ? '<div class="c-decks">' + inDecks.slice(0, 3).map((d) => '<span class="badge">' + esc(d) + '</span>').join('') + '</div>' : '';
    };
    const priceText=it=>val(it)==null?'Unknown':money(val(it));
    const ticker=it=>tickerHtml(it.n,it.sid,it.printing?.finish==='normal'?'':it.printing?.finish);
    const attrs=it=>' data-card="'+esc(it.n)+'" data-sid="'+esc(it.sid || '')+'"'+versionAttr(it.printing);
    const copyAttrs=it=>CollectionUI.copyAttributes(it.n,it.printing);
    const details=it=>'<button class="btn small collection-details" data-modal="'+esc(it.n)+'" aria-label="View details for '+esc(it.n)+'">Details</button>';
    let body='';
    if(mode==='list') {
      body='<div class="list-head"><span></span><span>Name</span><span>Version</span><span class="ra">Qty</span><span class="ra">Each</span><span></span></div>'+shown.map(it=>
        '<div class="list-row"'+attrs(it)+' data-hover-sid="'+esc(it.sid || '')+'"><button class="collection-thumb"'+copyAttrs(it)+'>'+thumb(it.sid)+'</button>'+
        '<button class="list-n"'+copyAttrs(it)+'>'+esc(it.n)+'</button><span class="list-sets">'+versionHtml(it.printing)+'</span>'+
        '<span class="ra dim list-qty">×'+it.q+'</span><span class="ra list-p"><span class="list-value">'+priceText(it)+'</span>'+ticker(it)+'</span>'+
        '<div class="collection-row-actions">'+CollectionUI.copyButton(it.n,it.printing)+details(it)+'<button class="btn small m-act" data-move="'+esc(it.n)+'" aria-label="Add '+esc(it.n)+' to a deck">To deck</button></div></div>').join('');
    } else {
      body='<div class="col-grid">'+shown.map(it=>'<div class="c-card" draggable="true"'+attrs(it)+'><button class="collection-card-open"'+copyAttrs(it)+'>'+cardImgHtml(it.n,it.sid)+
        '<div class="c-edition"><strong>'+esc(it.n)+'</strong>'+versionHtml(it.printing)+'</div></button><div class="c-meta"><span class="c-qty">×'+it.q+'</span><span class="c-price">'+priceText(it)+'<small> each</small></span>'+
        '<button class="m-act icon" data-move="'+esc(it.n)+'" aria-label="Add '+esc(it.n)+' to a deck">&#8942;</button></div>'+
        '<div class="c-copy-actions">'+CollectionUI.copyButton(it.n,it.printing)+details(it)+'</div>'+(ticker(it)?'<div class="c-tick">'+ticker(it)+'</div>':'')+badgeRow(it)+'</div>').join('')+'</div>';
    }
    const sel = (name, opts, cur, label) =>
      '<select data-filter="' + name + '"><option value="">' + label + '</option>' +
      opts.map((o) => '<option ' + (cur === o ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';

    return collectionHeader+'<div class="filter-bar">' +
      '<input id="col-search" type="search" placeholder="Search ' + Object.keys(agg).length + ' cards" value="' + esc(params.q || '') + '">' +
      sel('color', ['W', 'U', 'B', 'R', 'G', 'C'], color, 'Color') +
      sel('type', ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'], type, 'Type') +
      sel('binder', binders, binder, 'Binder') +
      sel('set', [...new Set(Store.rows().map(r=>r.s).filter(Boolean))].sort(), params.set, 'Every set') +
      '<select data-filter="finish" aria-label="Finish"><option value="">Every finish</option>'+['normal','foil','etched'].map(f=>'<option value="'+f+'"'+(params.finish===f?' selected':'')+'>'+P.finishLabel(f)+'</option>').join('')+'</select>' +
      sel('sort', ['name', 'price', 'qty'], sort, 'Sort') +
      '<div class="seg"><button class="seg-b ' + (mode === 'grid' ? 'on' : '') + '" data-mode="grid">Grid</button><button class="seg-b ' + (mode === 'list' ? 'on' : '') + '" data-mode="list">List</button></div>' +
      '<span class="dim">' + items.length.toLocaleString() + ' versions</span>' +
      (binder ? '<button class="btn small" id="binder-to-deck" data-binder="' + esc(binder) + '">Import binder as deck</button>' : '') +
      '</div>' + body +
      (items.length > show ? '<div class="show-more"><button class="btn" id="show-more" data-next="' + (show + 600) + '">Show ' + Math.min(600, items.length - show) + ' more</button></div>' : '');
  }

  function deckEstimate(cards) {
    let total=0,unknown=0;for(const c of cards){const p=Store.knownDeckCardValue(c);if(p==null)unknown+=c.q;else total+=p*c.q;}
    return unknown ? money(total)+' known · '+unknown+' unpriced' : money(total);
  }
  function viewDecks() {
    const refs = Store.allDeckRefs();
    const tiles = refs.map((r) => {
      const dv = Store.deckView(r.key);
      return '<a class="deck-tile" href="#/mydeck/' + r.key + '" data-deckdrop="' + r.key + '">' +
        cardImgHtml(dv.name, dv.commanderSid, 'tile-art') +
        '<div class="tile-body"><div class="tile-name">' + esc(dv.name) + '</div>' +
        '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
        '<div class="tile-price">' + deckEstimate(Store.deckCards(dv)) + '</div></div></a>';
    }).join('');
    let sess = '';
    for (const s of Store.state.sessions) {
      sess += '<div class="sess-row"><a href="#/session/' + s.id + '">' + esc(s.name) + '</a>' +
        '<span class="dim">' + s.cards.reduce((t, c) => t + c.q, 0) + ' cards</span>' +
        '<button class="btn small" data-delsess="' + s.id + '">delete</button></div>';
    }
    return '<div class="page-h"><h1>Decks</h1>' +
      '<div class="page-actions"><button class="btn primary" id="new-deck">New deck</button><a class="btn" href="#/import">Import a list</a>' +
      (Store.seedAvailable() && !Store.state.seeded ? '<button class="btn" id="seed-import">Load built-in vault</button>' : '') +
      '</div></div>' +
      (refs.length ? '<div class="deck-grid">' + tiles + '</div>'
        : '<p class="dim">No decks yet.</p>') +
      (sess ? '<div class="panel-h sub">Imported lists</div>' + sess : '');
  }

  function bucketOf(n) {
    const c = Store.card(n);
    const t = c ? (c.t || '').split(' // ')[0].toLowerCase() : '';
    if (/^basic land/.test(t)) return 'Basics';
    if (t.includes('land')) return 'Lands';
    if (t.includes('creature')) return 'Creatures';
    if (t.includes('planeswalker')) return 'Planeswalkers';
    if (t.includes('instant')) return 'Instants';
    if (t.includes('sorcery')) return 'Sorceries';
    if (t.includes('artifact')) return 'Artifacts';
    if (t.includes('enchantment')) return 'Enchantments';
    return 'Other';
  }

  const deckViewPref = () => { try { return localStorage.getItem('av_deckview') || 'list'; } catch (e) { return 'list'; } };

  function deckColumnsHtml(cards, opts) {
    const o = opts || {};
    const buckets = {};
    for (const c of cards) {
      if (c.src === 'commander') continue;
      (buckets[bucketOf(c.n)] ||= []).push(c);
    }
    const order = ['Creatures', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Planeswalkers', 'Lands', 'Basics', 'Other'];
    if (o.visual) {
      let vcols = '';
      for (const b of order) {
        if (!buckets[b]) continue;
        const list = buckets[b].sort((a, x) => ((Store.card(a.n) || {}).mv || 0) - ((Store.card(x.n) || {}).mv || 0));
        const count = list.reduce((s, c) => s + c.q, 0);
        let stack = '';
        for (const c of list) {
          const sid = c.sid || Store.sidFor(c.n);
          stack += '<div class="stackcard"'+versionAttr(c.printing)+' data-modal="' + esc(c.n) + '" role="button" tabindex="0" aria-label="' + esc(c.n) + '">' +
            (sid ? '<img loading="lazy" alt="" src="' + Scry.img(sid, 'normal') + '">' : '<div class="stack-noart">' + esc(c.n) + '</div>') +
            (c.q > 1 ? '<span class="stack-q">x' + c.q + '</span>' : '') + '</div>';
        }
        vcols += '<div class="v-col"><div class="d-col-h">' + b + ' <span class="dim">' + count + '</span></div><div class="stack">' + stack + '</div></div>';
      }
      return vcols;
    }
    let cols = '';
    for (const b of order) {
      if (!buckets[b]) continue;
      const list = buckets[b].sort((a, x) => ((Store.card(a.n) || {}).mv || 0) - ((Store.card(x.n) || {}).mv || 0));
      const count = list.reduce((s, c) => s + c.q, 0);
      let rowsH = '';
      for (const c of list) {
        const sid = c.sid || Store.sidFor(c.n);
        const warn = o.ci ? (() => { const f = Store.card(c.n); return f && [...(f.ci || '')].some((x) => !o.ci.includes(x)); })() : false;
        rowsH += '<div class="d-row"'+versionAttr(c.printing)+' data-zone="'+(o.zone || 'main')+'" draggable="true" data-card="' + esc(c.n) + '" data-hover-sid="' + (sid || '') + '">' +
          (o.editable
            ? '<span class="qty-ctl"><button class="qb" data-dec="' + esc(c.n) + '" aria-label="One fewer ' + esc(c.n) + '">&minus;</button><span class="d-q">' + c.q + '</span><button class="qb" data-inc="' + esc(c.n) + '" aria-label="One more ' + esc(c.n) + '">+</button></span>'
            : '<span class="d-q">' + c.q + '</span>') +
          '<span class="d-n"><span data-modal="' + esc(c.n) + '">' + esc(c.n) + '</span>' + ('printing' in c?versionHtml(c.printing):'') +
          (warn ? ' <span class="badge warn" title="Outside commander color identity">CI</span>' : '') +
          (o.showNeed && !/^(plains|island|swamp|mountain|forest|wastes|snow-covered)/i.test(c.n) && (!Store.byName[Store.norm(c.n)] || Store.byName[Store.norm(c.n)].qty < (o.required || cards).filter(x=>Store.norm(x.n)===Store.norm(c.n)).reduce((sum,x)=>sum+x.q,0))
            ? ' <button class="btn small buy-b" data-bought="' + esc(c.n) + '">Bought</button>' : '') + '</span>' +
          '<span class="d-p">' + (Store.knownDeckCardValue(c)==null?'Unknown':money(Store.knownDeckCardValue(c)*c.q)) + (Store.knownDeckCardValue(c)==null?'':tickerHtml(c.n,sid,c.printing?.finish==='normal'?'':c.printing?.finish)) + '</span>' +
          (o.editable
            ? '<button class="m-act icon" data-remove="' + esc(c.n) + '" title="Remove" aria-label="Remove ' + esc(c.n) + '">&times;</button>'
            : '<button class="m-act icon" data-move="' + esc(c.n) + '" title="Add to a deck" aria-label="Add ' + esc(c.n) + ' to a deck">&#8942;</button>') +
          '</div>';
      }
      cols += '<div class="d-col"><div class="d-col-h">' + b + ' <span class="dim">' + count + '</span></div>' + rowsH + '</div>';
    }
    return cols;
  }

  function completeProposalHtml(prop) {
    const buyCost = prop.adds.filter((a) => !a.owned).reduce((s, a) => s + (a.usd || 0), 0);
    const basicsN = prop.basics.reduce((s, b) => s + b.q, 0);
    const row = (a) =>
      '<div class="sugg-row" data-hover-sid="' + (a.sid || '') + '">' +
      '<span class="sugg-n">' + esc(a.n) + '</span>' +
      '<span class="dim">' + Math.round(a.f * 100) + '% of real decks' + (a.because && a.because.length ? ', fits ' + a.because.map(esc).join(' and ') : '') + '</span>' +
      (a.owned ? '<span class="badge own">owned</span>' : '<span class="badge buy">' + money(a.usd || 0) + '</span>') +
      '<button class="btn small" data-cpadd="' + esc(a.n) + '">Add</button></div>';
    return '<section class="panel"><div class="panel-h">Completing this deck <span class="dim">' +
      (prop.archetype ? 'reads as ' + esc(prop.archetype) + ', ' + Math.round(prop.matchScore * 100) + '% match' : 'no strong theme yet') + '</span></div>' +
      (prop.adds.length ? prop.adds.map(row).join('') : '<p class="dim">No spell suggestions; the deck mostly needs lands.</p>') +
      (basicsN ? '<div class="sugg-row"><span class="sugg-n">' + prop.basics.map((b) => b.q + ' ' + esc(b.n)).join(', ') + '</span>' +
        '<span class="dim">real ' + (prop.archetype ? esc(prop.archetype) : '') + ' decks average ' + prop.landTarget + ' lands</span><span class="badge basic">lands</span></div>' : '') +
      '<div class="page-actions" style="margin-top:10px"><button class="btn primary" id="cp-addall">Add all ' + (prop.adds.length + basicsN) + '</button>' +
      '<span class="dim">' + (buyCost > 0 ? 'about ' + money(buyCost) + ' to buy' : 'nothing to buy') + '</span></div></section>';
  }

  function reportHtml(r, ctx) {
    if (!r) return '';
    const bracketInfo = Rules.BRACKETS[r.bracket - 1];
    const feelInfo = Rules.BRACKETS[r.feel - 1];
    // baselines: prefer real decks of the matched archetype at this deck's
    // bracket; fall back to archetype-wide, then the generic ranges
    const matchedArch = (r.brainMatches && r.brainMatches[0] && window.VAULT_BRAIN)
      ? window.VAULT_BRAIN.archetypes[r.brainMatches[0].key] : null;
    const bucket = r.bracket <= 2 ? 'b2' : r.bracket === 3 ? 'b3' : 'b4plus';
    const brainComp = matchedArch
      ? ((matchedArch.compByBracket && matchedArch.compByBracket[bucket]) || matchedArch.comp)
      : null;
    const brainCompLabel = matchedArch
      ? (r.brainMatches[0].name + (matchedArch.compByBracket && matchedArch.compByBracket[bucket] ? ' B' + (r.bracket <= 2 ? '1-2' : r.bracket === 3 ? '3' : '4+') : '') + ' avg')
      : null;
    const compRow = (label, key) => {
      const [lo, hi] = Rules.BASELINES[key];
      const v = r.comp[key];
      const ref = brainComp && brainComp[key] != null ? brainComp[key] : null;
      const cls = ref != null
        ? (v < ref - 3 ? 'low' : v > ref + 4 ? 'high' : 'ok')
        : (v < lo ? 'low' : v > hi + 3 ? 'high' : 'ok');
      return '<div class="comp-row"><span>' + label + '</span><span class="comp-v ' + cls + '">' + v + '</span><span class="dim">' + (ref != null ? ref : lo + '-' + hi) + '</span></div>';
    };
    const compRef = brainComp
      ? '<div class="dim" style="font-size:11.5px;margin-bottom:4px">vs ' + esc(brainCompLabel) + ' (' + (brainComp.n || matchedArch.decks) + ' real decks)</div>'
      : '';
    const chipList = (label, arr) => arr.length
      ? '<div class="sig-row"><span class="sig-l">' + label + '</span>' + arr.map((n) => '<span class="badge">' + esc(n) + '</span>').join('') + '</div>' : '';
    return '<section class="panel report"><div class="panel-h">Deck doctor</div>' +
      '<div class="verdict"><div class="verdict-b"><div class="verdict-n">' + r.bracket + '</div><div class="verdict-t">Bracket ' + r.bracket + ': ' + bracketInfo.name + '</div></div>' +
      (r.feel !== r.bracket ? '<div class="dim">Rules floor is Bracket ' + r.bracket + ', but the power level plays closer to Bracket ' + r.feel + ' (' + feelInfo.name + ').</div>' : '<div class="dim">' + bracketInfo.blurb + '</div>') + '</div>' +
      (r.why.length ? '<ul class="why">' + r.why.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<div class="report-grid">' +
      '<div><div class="panel-h sub">Composition vs baseline</div>' + compRef +
      compRow('Lands', 'lands') + compRow('Ramp', 'ramp') + compRow('Card draw', 'draw') + compRow('Removal', 'removal') + compRow('Board wipes', 'wipes') +
      '<div class="comp-row"><span>Average mana value</span><span class="comp-v">' + r.avgMv + '</span><span class="dim">nonland</span></div>' +
      '<div class="comp-row"><span>Cards</span><span class="comp-v">' + r.totalCards + '</span><span class="dim">100</span></div></div>' +
      '<div><div class="panel-h sub">Signals</div>' +
      chipList('Game Changers', r.gcs) + chipList('Fast mana', r.fast) + chipList('Free interaction', r.free) +
      chipList('Tutors', r.tutors.slice(0, 8)) + chipList('Extra turns', r.turns) + chipList('Mass land denial', r.mld) +
      (r.combos.length ? '<div class="sig-row"><span class="sig-l">Combos</span>' + r.combos.map((p) => '<span class="badge ' + (Rules.comboIsFast(p) ? 'warn' : '') + '" title="' + esc(p.result || '') + '">' + esc(p.a + ' + ' + p.b) + '</span>').join('') + '</div>' : '') +
      (r.triples && r.triples.length ? '<div class="sig-row"><span class="sig-l">3-card lines</span>' + r.triples.slice(0, 6).map((t) => '<span class="badge" title="' + esc(t.r || '') + '">' + esc(t.c.join(' + ')) + '</span>').join('') + '</div>' : '') +
      (r.archetypes.length ? '<div class="sig-row"><span class="sig-l">Archetypes</span>' + r.archetypes.map((a) => '<span class="badge gc">' + esc(a.name) + ' (' + a.hits + ')</span>').join('') + '</div>' : '') +
      (r.brainMatches && r.brainMatches.length ? '<div class="sig-row"><span class="sig-l">Decks like yours</span>' + r.brainMatches.map((m) => '<span class="badge">' + esc(m.name) + ' ' + Math.round(m.score * 100) + '% (' + m.decks + ' decks)</span>').join('') + '</div>' : '') +
      (r.similarDecks && r.similarDecks.length ? '<div class="sig-row"><span class="sig-l">Closest real decks</span>' + r.similarDecks.map((s) =>
        '<a class="badge link" href="' + s.url + '" target="_blank" rel="noopener">' + esc(s.commander) + ' ' + Math.round(s.score * 100) + '%</a>').join('') + '</div>' : '') +
      '</div></div>' +
      (r.brainSuggestions ? '<div class="panel-h sub">What to add, from ' + r.brainSuggestions.decks + ' real ' + esc(r.brainSuggestions.arch) + ' decks</div>' +
        r.brainSuggestions.items.map((i) =>
          '<div class="sugg-row" data-hover-sid="' + (i.sid || '') + '">' +
          '<span class="sugg-n">' + esc(i.n) + '</span>' +
          '<span class="dim">' + Math.round(i.f * 100) + '% of decks' + (i.because && i.because.length ? ', with ' + i.because.slice(0, 2).map(esc).join(' and ') : '') + '</span>' +
          (i.owned ? '<span class="badge own">owned</span>' : '<span class="badge buy">' + (i.usd != null ? money(i.usd) : 'buy') + '</span>') +
          (ctx && ctx.editableId ? '<button class="btn small" data-addcard="' + esc(i.n) + '">Add</button>' : '') +
          '</div>').join('') +
        '<div class="page-actions" style="margin-top:10px"><button class="btn primary" data-upgrade="1">Create upgraded build</button></div>' : '') +
      (r.commanderSignature && r.commanderSignature.length
        ? '<div class="panel-h sub">Signature cards you are not running</div>' +
          '<div class="dim" style="margin-bottom:6px">Cards that show up far more in this commander’s decks than anywhere else:</div>' +
          r.commanderSignature.map((s) =>
            '<div class="sugg-row" data-hover-sid="' + (s.sid || '') + '">' +
            '<span class="sugg-n">' + esc(s.n) + '</span>' +
            '<span class="dim">' + (s.syn > 0 ? '+' + Math.round(s.syn * 100) + '% synergy' : s.inc + '% of decks') + '</span>' +
            (ctx && ctx.editableId ? '<button class="btn small" data-addcard="' + esc(s.n) + '">Add</button>' : '') +
            '</div>').join('') : '') +
      (r.suggestions.length ? '<div class="panel-h sub">Suggestions</div>' + r.suggestions.map((s) =>
        '<div class="sugg"><div>' + esc(s.text) + '</div>' +
        (s.picks.length ? '<div class="sig-row">' + s.picks.map((p) => '<span class="badge">' + esc(p) + '</span>').join('') + '</div>' : '') + '</div>').join('') : '') +
      (r.cuts.length ? '<div class="panel-h sub">Cut candidates</div><div class="dim" style="margin-bottom:6px">Expensive cards with no detected role in this deck’s plan:</div>' +
        '<div class="sig-row">' + r.cuts.map((c) => '<span class="badge">' + esc(c.n) + ' (mv ' + c.mv + ')</span>').join('') + '</div>' : '') +
      (r.unresolved ? '<div class="dim" style="margin-top:8px">' + r.unresolved + ' cards could not be identified and were skipped.</div>' : '') +
      '</section>';
  }

  function deckHeadHtml(dv, extra, deckId) {
    const cards = dv.cards;
    const total = cards.reduce((s, c) => s + c.q, 0);
    const value = (dv.format==='standard' ? cards.concat(dv.sideboard || []) : cards).reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0);
    return '<div class="deck-head">' +
      cardImgHtml(dv.name, dv.commanderSid, 'deck-art') +
      '<div class="deck-info"><h1>' + esc(dv.name) + '</h1>' +
      '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
      '<div class="deck-stats"><span>' + total + ' cards</span><span>' + deckEstimate(Store.deckCards(dv)) + '</span>' +
      (dv.format==='standard' ? (deckId.startsWith('session:') ? '' : '<button class="btn small primary" id="check-standard">Refresh Standard legality</button>') : '<button class="btn small primary" id="analyze" data-deck="' + deckId + '">Analyze deck</button>')+'</div>' +
      (extra || '') + '</div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>';
  }

  const standardFacts = {}, deckAddZones = {};
  function standardChecks(d) {
    const check=window.WorkbenchCore.validateDeck(window.WorkbenchCore.fromStoredDeck(d),standardFacts);
    const dates=Store.deckCards(d).map(c=>standardFacts[window.WorkbenchCore.key(c.n)]?._fetchedAt).filter(Boolean).sort();
    return '<section class="standard-checks"><h2>Standard construction</h2><p><strong>'+check.total+' / 60+ main · '+check.sideboardTotal+' / 15 sideboard</strong></p><p>'+esc(check.note)+'</p><details'+(check.issues.length?' open':'')+'><summary>'+ (check.issues.length ? check.issues.length+' checks to review' : 'Preliminary checks passed')+'</summary><ul>'+check.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details><p class="dim">'+(dates.length?'Card facts last retrieved '+new Date(dates[dates.length-1]).toLocaleString()+'. ':'')+'<a href="https://magic.wizards.com/en/formats/standard" target="_blank" rel="noopener">Official Standard rules</a> · <a href="https://magic.wizards.com/en/banned-restricted-list" target="_blank" rel="noopener">Banned cards</a></p></section>';
  }
  function viewMyDeck(id) {
    const d = Store.userDeck(id);
    if (!d) return '<p>Deck not found.</p>';
    const dv = Store.deckView(id), standard = dv.format==='standard';
    const extra = '<div class="deck-actions">' +
      '<input id="deck-name" value="' + esc(d.name) + '" title="Deck name">' +
      '<select id="deck-format" aria-label="Deck format"><option value="commander"'+(!standard?' selected':'')+'>Commander</option><option value="standard"'+(standard?' selected':'')+'>Standard</option></select>' +
      (!standard ? '<select id="deck-cmd" aria-label="Commander"><option value="">No commander set</option>' + d.cards.map((c) => '<option ' + (Store.norm(c.n) === Store.norm(d.commander || '') ? 'selected' : '') + '>' + esc(c.n) + '</option>').join('') + '</select>' : '') +
      '<button class="btn small" id="export-mydeck">Copy list</button>' +
      (!standard ? '<a class="btn small" href="#/pilot/' + id + '">Pilot guide</a>' : '') +
      '<a class="btn small" href="#/workbench?deck='+encodeURIComponent(id)+'">Open working copy</a>' +
      '<button class="btn small" id="deckview-toggle">' + (deckViewPref() === 'visual' ? 'List view' : 'Visual view') + '</button>' +
      '<button class="btn small danger" id="del-mydeck">Delete</button></div>' +
      (standard ? '<label class="deck-add-zone">Add cards to <select id="deck-add-zone"><option value="main">Main deck</option><option value="sideboard">Sideboard</option></select></label>' : '') +
      '<div class="add-wrap"><input id="add-card" placeholder="Add a card, type to search" autocomplete="off"><div id="add-sug"></div></div>';
    const missing = Store.missingFromCollection(Store.deckCards(d));
    const missCost = missing.reduce((s, m) => s + m.unit * m.q, 0);
    const buyBar = missing.length
      ? '<div class="deck-actions"><span class="badge buy">' + missing.reduce((s, m) => s + m.q, 0) + ' to buy, ' + (standard?deckEstimate(missing):money(missCost)) + '</span>' +
        '<button class="btn small" id="buy-all">Mark all as bought</button>' +
        '<button class="btn small" id="dl-missing">Buy list .txt</button></div>'
      : (Store.hasCollection() ? '<div class="deck-actions"><span class="badge own">fully owned</span></div>' : '');
    const nonCmdTotal = dv.cards.filter((c) => c.src !== 'commander').reduce((s, c) => s + c.q, 0);
    const completeBar = !standard && nonCmdTotal < 99
      ? '<div class="deck-actions"><span class="badge warn">' + nonCmdTotal + ' of 99</span>' +
        '<button class="btn small" id="complete-deck">Complete my deck</button></div>'
      : '';
    const visual = deckViewPref() === 'visual';
    return deckHeadHtml(dv, extra + buyBar + completeBar, id) +
      (standard ? '<div id="standard-result" aria-live="polite">'+standardChecks(d)+'</div>' : '') +
      '<div id="report-slot">' + (!standard && reports[id] ? reportHtml(reports[id], { editableId: id }) : '') + '</div>' +
      '<div class="' + (visual ? 'deck-vcols' : 'deck-cols') + '">' + deckColumnsHtml(dv.cards, { editable: true, standard, ci: dv.ci || null, showNeed: Store.hasCollection(), required:Store.deckCards(d), visual }) + '</div>' +
      (standard ? '<section class="deck-sideboard"><h2>Sideboard <span class="dim">'+dv.sideboard.reduce((s,c)=>s+c.q,0)+' / 15</span></h2><p class="dim">Counts toward the four-copy limit and collection check. Select Sideboard above to add cards.</p><div class="'+(visual?'deck-vcols':'deck-cols')+'">'+(dv.sideboard.length ? deckColumnsHtml(dv.sideboard,{editable:true,standard:true,zone:'sideboard',showNeed:Store.hasCollection(),required:Store.deckCards(d),visual}) : '<p class="dim">No sideboard cards yet.</p>')+'</div></section>' : '');
  }

  function viewSession(id) {
    const s = Store.state.sessions.find((x) => x.id === id);
    if (!s) return '<p>Not found.</p>';
    const dv = { name: s.name, format:s.format, sideboard:s.sideboard || [], sub: (s.format==='standard'?'Standard · ':'')+'Imported list', ci: '', commanderSid: '', cards: s.cards.map((c) => ({ ...c, src: 'user' })) };
    const extra = '<div class="deck-actions"><button class="btn small" id="sess-edit" data-id="' + s.id + '">Make editable copy</button>' +
      (s.format==='standard'?'':'<a class="btn small" href="#/pilot/session:' + s.id + '">Pilot guide</a>') +
      '<button class="btn small" id="deckview-toggle">' + (deckViewPref() === 'visual' ? 'List view' : 'Visual view') + '</button></div>';
    const visual = deckViewPref() === 'visual';
    return deckHeadHtml(dv, extra, 'session:' + id) +
      '<div id="report-slot">' + (reports['session:' + id] ? reportHtml(reports['session:' + id], {}) : '') + '</div>' +
      '<div class="' + (visual ? 'deck-vcols' : 'deck-cols') + '">' + deckColumnsHtml(dv.cards, { visual }) + '</div>'+((s.sideboard||[]).length?'<h2>Sideboard</h2><div class="deck-cols">'+deckColumnsHtml(s.sideboard,{})+'</div>':'');
  }

  function viewMoves() {
    const ms = Store.state.moves;
    if (!ms.length) return '<div class="page-h"><h1>Moves</h1></div><p class="dim">Nothing logged yet. Card moves collect here as a physical sorting checklist.</p>';
    let rows = '';
    for (const m of ms) {
      rows += '<div class="move-row" data-hover-sid="' + (m.sid || '') + '"><span>' + esc(m.n) + '</span>' +
        '<span class="dim">' + esc(Store.deckNameFor(m.from)) + ' to ' + esc(Store.deckNameFor(m.to)) + '</span>' +
        '<button class="btn small" data-unmove="' + m.id + '">done / undo</button></div>';
    }
    return '<div class="page-h"><h1>Moves</h1><div class="page-actions"><button class="btn" id="clear-moves">Clear all</button></div></div>' + rows;
  }

  function viewImport() {
    return '<div class="page-h"><h1>Import a deck</h1></div>' +
      '<p class="dim">One card per line, like: 1 Sol Ring.</p>' +
      '<textarea id="imp-text" rows="12" placeholder="1 Atraxa, Grand Unifier&#10;1 Sol Ring&#10;..."></textarea>' +
      '<div class="row"><input id="imp-name" placeholder="Deck name"><select id="imp-format" aria-label="Deck format"><option value="commander">Commander</option><option value="standard">Standard</option></select>' +
      '<button class="btn primary" id="imp-go">Import as editable deck</button>' +
      '<button class="btn" id="imp-go-ro">Import read-only</button>' +
      '<button class="btn" id="imp-compare"' + (Store.hasCollection() ? '' : ' disabled title="Upload a collection first"') + '>Compare vs my collection</button></div>' +
      '<div id="imp-status" class="dim"></div><div id="compare-slot"></div>';
  }

  function compareHtml(cmp, name) {
    const need = cmp.rows.filter((r) => r.need > 0);
    const have = cmp.rows.filter((r) => r.need === 0);
    const row = (r) => '<div class="cmp-row" data-hover-sid="' + (r.sid || '') + '">' +
      '<span class="cmp-n">' + esc(r.n) + '</span>' +
      '<span class="dim">' + (r.need > 0 ? 'need ' + r.need + (r.have ? ', have ' + r.have : '') : 'have ' + r.q) + '</span>' +
      '<span class="ra ' + (r.need > 0 ? 'list-p' : 'dim') + '">' + (r.need > 0 ? money(r.unit * r.need) : '') + '</span></div>';
    return '<section class="panel"><div class="panel-h">' + esc(name) + ': collection check</div>' +
      '<div class="stat-row" style="margin-bottom:12px">' +
      '<div class="stat-tile"><div class="stat-label">You own</div><div class="stat-value">' + cmp.ownedCount + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">To buy</div><div class="stat-value">' + cmp.needCount + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Cost to complete</div><div class="stat-value">' + money(cmp.buyCost) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Coverage</div><div class="stat-value">' + (cmp.ownedCount + cmp.needCount ? Math.round(cmp.ownedCount / (cmp.ownedCount + cmp.needCount) * 100) : 0) + '%</div></div></div>' +
      '<div class="page-actions"><button class="btn primary" id="cmp-buylist">Download buy list .txt</button></div>' +
      (need.length ? '<div class="panel-h sub">To buy (' + need.length + ')</div>' + need.map(row).join('') : '') +
      (have.length ? '<div class="panel-h sub">You own (' + have.length + ')</div>' + have.map(row).join('') : '') +
      '</section>';
  }

  function viewBuild(params) {
    if (!window.VAULT_TEMPLATES) {
      App.ensureData().then(() => App.refresh());
      return '<div class="page-h"><h1>Deck builder</h1></div><p class="dim">Loading deck intelligence...</p>';
    }
    const t = Builder.templates();
    if (!t.archetypes.length) return '<p class="dim">Deck templates failed to load.</p>';
    const all = Builder.allCommanders();
    const chosen = params.cmd ? Builder.findCommander(params.cmd) : null;
    const fits = chosen ? Builder.fittingArchetypes(chosen) : [];
    const bracket = parseInt(params.bracket || '3', 10);

    // commander-first: search anyone; archetype options are only what fits them.
    let archOptions;
    if (chosen) {
      archOptions = fits.length
        ? '<option value="auto">Best fit: ' + esc(fits[0].name) + '</option>' +
          fits.slice(1, 6).map((f) => '<option value="' + f.key + '" ' + (params.arch === f.key ? 'selected' : '') + '>' + esc(f.name) + '</option>').join('')
        : '<option value="auto">Most popular build</option>';
    } else {
      archOptions = t.archetypes.map((x) => '<option value="' + x.key + '" ' + (params.arch === x.key ? 'selected' : '') + '>' + esc(x.name) + '</option>').join('');
    }
    const dlSource = params.arch && !chosen && Builder.directory(params.arch).length
      ? Builder.directory(params.arch) : all;
    const featured = !chosen && !all.length
      ? '<select id="bld-cmd">' + (Builder.archetype(params.arch || t.archetypes[0].key) || t.archetypes[0]).commanders.map((c, i) => '<option value="' + i + '">' + esc(c.name) + '</option>').join('') + '</select>'
      : '';

    const cmdLine = chosen
      ? '<div class="tile-sub" style="margin-top:10px">' + cardImgHtml(chosen.n, chosen.sid, 'tile-art bld-art') +
        '<span><strong>' + esc(chosen.n) + '</strong> ' + pips(chosen.ci) + ' <span class="dim">' + chosen.decks.toLocaleString() + ' decks on record' +
        (fits.length ? '' : ', no mapped theme, the build follows its most popular list') + '</span></span></div>'
      : '';

    return '<div class="page-h"><h1>Deck builder</h1></div>' +
      '<p class="dim">Search a commander, pick a build that fits them, set your bracket.</p>' +
      '<section class="panel"><div class="build-controls">' +
      '<input id="bld-cmdsearch" list="bld-cmd-dl" placeholder="Search ' + (all.length ? all.length.toLocaleString() : '') + ' commanders" value="' + esc(params.cmd || '') + '">' +
      '<datalist id="bld-cmd-dl">' + dlSource.slice(0, 900).map((c) => '<option value="' + esc(c.n) + '">' + (c.decks || 0).toLocaleString() + ' decks</option>').join('') + '</datalist>' +
      featured +
      '<select id="bld-arch" title="Build style">' + archOptions + '</select>' +
      '<select id="bld-bracket"><option value="2" ' + (bracket === 2 ? 'selected' : '') + '>Bracket 2: Core</option><option value="3" ' + (bracket === 3 ? 'selected' : '') + '>Bracket 3: Upgraded</option><option value="4" ' + (bracket === 4 ? 'selected' : '') + '>Bracket 4: Optimized</option></select>' +
      '<select id="bld-budget" title="Cost ceiling"><option value="0">No cost limit</option>' +
      [50, 100, 200, 400].map((b) => '<option value="' + b + '" ' + (params.budget === String(b) ? 'selected' : '') + '>Under $' + b + '</option>').join('') + '</select>' +
      '<label class="chk"><input type="checkbox" id="bld-own" ' + (Store.hasCollection() ? 'checked' : 'disabled') + '> Use my collection</label>' +
      '<label class="chk"><input type="checkbox" id="bld-sub" ' + (Store.hasCollection() ? '' : 'disabled') + '> Substitute owned equivalents</label>' +
      '<button class="btn primary" id="bld-go">Build</button></div>' +
      cmdLine +
      '<div id="bld-status" class="dim"></div></section>' +
      '<div id="bld-result"></div>';
  }

  function buildResultHtml(res) {
    const s = res.stats;
    // statuses toggle after render (move-from-deck reservations); keep money honest
    s.buyCount = res.cards.filter((c) => c.status === 'buy').reduce((x, c) => x + c.q, 0);
    s.buyCost = res.cards.filter((c) => c.status === 'buy').reduce((x, c) => x + (c.usd || 0) * c.q, 0) + (s.commanderOwned ? 0 : (res.commander.usd || 0));
    const reservedN = res.cards.filter((c) => c.status === 'reserved').reduce((x, c) => x + c.q, 0);
    const groups = {};
    for (const c of res.cards) (groups[c.t === 'Land' ? 'Lands' : c.t + 's'] ||= []).push(c);
    const badge = (c) => c.status === 'owned' ? '<span class="badge own">owned</span>'
      : c.status === 'reserved' ? '<span class="badge moved">moving from ' + esc(c.lockedIn.name) + '</span><button class="btn small" data-unpull="' + esc(c.n) + '">Undo</button>'
      : c.status === 'sub' ? '<span class="badge moved" title="Substituted for ' + esc(c.subFor || '') + '">sub</span>'
      : c.status === 'basic' ? '<span class="badge">basic</span>'
      : c.lockedIn ? '<span class="badge warn" title="You own this, but every copy is in that deck">in ' + esc(c.lockedIn.name) + '</span>' +
        '<span class="badge buy">' + money((c.usd || 0)) + '</span><button class="btn small" data-pull="' + esc(c.n) + '">Use that copy</button>'
      : '<span class="badge buy">' + money((c.usd || 0)) + '</span>';
    let cols = '';
    for (const [g, list] of Object.entries(groups)) {
      list.sort((a, b) => (a.mv || 0) - (b.mv || 0));
      cols += '<div class="d-col"><div class="d-col-h">' + g + ' <span class="dim">' + list.reduce((x, c) => x + c.q, 0) + '</span></div>' +
        list.map((c) => '<div class="d-row" data-hover-sid="' + (c.sid || '') + '"><span class="d-q">' + c.q + '</span>' +
          '<span class="d-n">' + esc(c.n) + (c.subFor ? ' <span class="dim">for ' + esc(c.subFor) + '</span>' : '') + '</span>' + badge(c) + '</div>').join('') + '</div>';
    }
    const reservedLine = reservedN
      ? '<div class="dim" style="margin-top:8px">' + reservedN + (reservedN > 1 ? ' cards' : ' card') + ' will move out of other decks when you save; each move lands on your Moves checklist for physical sorting.</div>'
      : '';
    return '<section class="panel"><div class="panel-h">' + esc(res.archetype) + ' with ' + esc(res.commander.name) + ' <span class="badge gc">Bracket ' + s.bracket + '</span></div>' +
      '<div class="stat-row" style="margin-bottom:12px">' +
      '<div class="stat-tile"><div class="stat-label">Full deck value</div><div class="stat-value">' + money(s.totalValue) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Cost to complete</div><div class="stat-value">' + money(s.buyCost) + '</div><div class="dim">' + s.buyCount + ' cards' + (s.commanderOwned ? '' : ' + commander') + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">From your collection</div><div class="stat-value">' + (s.ownedCount + s.subCount) + '</div><div class="dim">' + s.subCount + ' substitutions, ' + s.basicCount + ' basics assumed</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Game Changers kept</div><div class="stat-value">' + s.gcs.length + '</div><div class="dim">' + (s.gcs.join(', ') || 'none') + '</div></div></div>' +
      '<div class="page-actions"><button class="btn primary" id="bld-save">Save as my deck</button>' +
      '<button class="btn" id="bld-dl-deck">Decklist .txt</button>' +
      '<button class="btn" id="bld-dl-buy">Buy list .txt</button></div>' + reservedLine +
      (res.notes.length ? '<div class="panel-h sub">Bracket adjustments</div><ul class="why">' + res.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      (res.recommendations && res.recommendations.ownedPopular.length
        ? '<div class="panel-h sub">Already in your collection and popular in real ' + esc(res.archetype) + ' decks</div><div class="sig-row">' +
          res.recommendations.ownedPopular.map((i) => '<span class="badge own" data-hover-sid="' + (i.sid || '') + '">' + esc(i.n) + ' ' + Math.round(i.f * 100) + '%</span>').join('') + '</div>' : '') +
      (res.recommendations && res.recommendations.upgrades.length
        ? '<div class="panel-h sub">Most-played upgrades across ' + res.recommendations.decks + ' real decks</div><div class="sig-row">' +
          res.recommendations.upgrades.map((i) => '<span class="badge buy" data-hover-sid="' + (i.sid || '') + '">' + esc(i.n) + ' ' + Math.round(i.f * 100) + '%' + (i.usd != null ? ' ' + money(i.usd) : '') + '</span>').join('') + '</div>' : '') +
      (res.recommendations && res.recommendations.signature && res.recommendations.signature.length
        ? '<div class="panel-h sub">' + esc(res.commander.name) + ' signature cards not in this build</div><div class="sig-row">' +
          res.recommendations.signature.map((s) => '<span class="badge" data-hover-sid="' + (s.sid || '') + '">' + esc(s.n) + (s.syn > 0 ? ' +' + Math.round(s.syn * 100) + '%' : '') + '</span>').join('') + '</div>' : '') +
      '</section><div class="deck-cols">' + cols + '</div>';
  }

  function viewGuide() {
    const b = Rules.BRACKETS.map((x) =>
      '<div class="g-bracket"><div class="g-num">' + x.n + '</div><div><strong>' + x.name + '</strong>' +
      '<div class="dim">Games end turn ' + x.turn + '.</div><div>' + x.blurb + '</div></div></div>').join('');
    const arch = Rules.ARCHETYPES.map((a) =>
      '<div class="sugg"><strong>' + a.name + '</strong><div class="sig-row">' + a.staples.slice(0, 6).map((s) => '<span class="badge">' + esc(s) + '</span>').join('') + '</div></div>').join('');
    return '<div class="page-h"><h1>Commander guide</h1><div class="page-actions"><a class="btn" href="#/coach">Bracket coach</a></div></div>' +
      '<section class="panel"><div class="panel-h">The five brackets (October 2025 system)</div>' + b +
      '<p class="dim" style="margin-top:10px">Brackets guide the pregame conversation; they are not laws. The Game Changers list (53 cards as of February 2026) is the shared reference: none in Brackets 1-2, up to three in Bracket 3, unlimited above. Mass land denial and fast two-card combos are Bracket 4 territory. Tutor limits were removed in October 2025; density still shifts how a deck feels.</p></section>' +
      '<section class="panel"><div class="panel-h">Deckbuilding baseline</div><div class="prose">' +
      '<p>A functional 100 usually carries <strong>35-38 lands</strong>, <strong>10-12 ramp</strong>, <strong>8-10 card draw</strong>, <strong>8-10 removal</strong> including <strong>2-4 board wipes</strong>, leaving roughly 30-35 slots for the deck’s actual plan. Aggressive low-curve decks trim lands; landfall and graveyard decks bend every number. The analyzer grades against this baseline and says when it thinks the bend is intentional.</p></div></section>' +
      '<section class="panel"><div class="panel-h">Archetype starting points</div>' + arch + '</section>' +
      '<section class="panel"><div class="panel-h">Sources</div><p class="dim">WotC / Commander Format Panel bracket announcements (October 2025 revision), the February 2026 Game Changers update, EDHREC bracket guide, average decklists and deck database' +
      ((window.VAULT_BRAIN && window.VAULT_BRAIN.decksTotal) ? ' (' + window.VAULT_BRAIN.decksTotal.toLocaleString() + ' real decklists sampled ' + window.VAULT_BRAIN.built + ' power the recommendation engine)' : '') +
      ', Commander Spellbook combo database, and standard community deckbuilding templates.</p></section>';
  }

  function syncPanelHtml() {
    const id = Sync.identity();
    const m = Sync.meta();
    if (Sync.enabled()) {
      const lc = Sync.counts(Sync.currentVault());
      return '<section class="panel"><div class="panel-h">Sync <span class="dim">build ' + (window.AV_BUILD || '?') + '</span></div>' +
        '<p class="dim">Signed in as <strong>' + esc(id.name) + '</strong>. This device holds ' + lc.cards + ' cards and ' + lc.decks + ' decks. Vault syncs encrypted to a private repo; only your name plus PIN can open it.' +
        (m.lastPush ? ' Last push ' + Math.round((Date.now() - m.lastPush) / 60000) + ' min ago.' : '') + '</p>' +
        '<div class="page-actions"><button class="btn primary" id="sync-push">Push now</button>' +
        '<button class="btn" id="sync-pull">Pull from cloud</button>' +
        '<button class="btn" id="sync-out">Sign out on this device</button>' +
        (Sync.hasSnapshot() ? '<button class="btn" id="sync-restore-snap">Restore pre-sync snapshot</button>' : '') +
        '</div>' +
        '<div class="page-actions" style="margin-top:10px"><button class="btn" id="sync-board">' + (Sync.boardOn() ? 'Leave the leaderboard' : 'Join the leaderboard') + '</button></div>' +
        '<p class="dim" style="margin-top:6px">The leaderboard shares only your name and counts (cards, printings, sets, masters) with people on this sync circle. Never your card list, never values. It updates each time you sync.</p>' +
        '<div id="sync-status2" class="dim"></div></section>';
    }
    return '<section class="panel"><div class="panel-h">Sync across devices</div>' +
      '<p class="dim">Your vault encrypts in this browser with a key from your name plus PIN, then syncs to a private repo. The access token comes from Keanen personally; the PIN is the only thing that opens your data, and a lost PIN cannot be recovered.</p>' +
      '<div class="row"><input id="sync-name" placeholder="Your name"><input id="sync-pin" placeholder="PIN, 4 to 8 digits" inputmode="numeric" type="password"></div>' +
      '<div class="row"><input id="sync-token" placeholder="Access token" type="password"><button class="btn primary" id="sync-enable">Enable sync</button></div>' +
      '<div id="sync-status" class="dim"></div></section>';
  }

  function viewData() {
    const stats = Store.storageStats();
    const totalBytes = stats.reduce((s, x) => s + x.bytes, 0);
    const age = Store.priceAge();
    const b = Store.backupState();
    const backupLine = b.last
      ? 'Last backup ' + Math.round((Date.now() - b.last) / 36e5) + ' hours ago' + (b.dirty ? ', with ' + b.dirty + ' changes since.' : '.')
      : (b.hasData ? 'No backup yet this browser. Download one.' : 'Nothing to back up yet.');
    return '<div class="page-h"><h1>Data</h1></div>' +
      syncPanelHtml() +
      '<section class="panel"><div class="panel-h">Backup</div>' +
      '<p class="' + (b.dirty || !b.last ? 'warn-text' : 'dim') + '">' + backupLine + '</p>' +
      '<div class="page-actions"><button class="btn primary" id="data-backup">Download backup</button>' +
      '<label class="btn" for="file-restore">Restore backup</label></div>' +
      '<p class="dim" style="margin-top:8px">The backup contains your decks, imported lists, uploaded collection, move checklist, price history, and snapshots, as one JSON file. Restore it on any device to continue where you left off. Browsers can clear localStorage; a backup is the only durable copy.</p></section>' +
      '<section class="panel"><div class="panel-h">How pricing works</div><div class="prose">' +
      '<p><strong>Card data.</strong> Uploaded ManaBox exports carry a Scryfall printing id per row, parsed entirely in your browser. Imported lists resolve by name against Scryfall.</p>' +
      '<p><strong>Refresh prices</strong> posts those printing ids to Scryfall’s /cards/collection endpoint, 75 per request, throttled to their documented 2 requests per second. Foils use usd_foil, etched use usd_etched, everything else usd, times quantity.</p>' +
      '<p><strong>History.</strong> Each refresh stores the full price map here and records one snapshot per day of collection and deck totals; the dashboard chart draws those. Scryfall updates prices daily, so one refresh a day is the useful maximum.</p>' +
      '<p><strong>Privacy.</strong> Nothing leaves this browser except calls to api.scryfall.com and its image CDN.</p></div></section>' +
      '<section class="panel"><div class="panel-h">Stored in this browser</div>' +
      stats.map((s) => '<div class="mover"><span>' + s.label + '</span><span class="dim">' + (s.bytes / 1024).toFixed(1) + ' KB</span></div>').join('') +
      '<div class="mover"><span><strong>Total</strong></span><span><strong>' + (totalBytes / 1024).toFixed(1) + ' KB</strong>' +
      (totalBytes > 4 * 1024 * 1024 ? ' <span class="warn-text">near the browser limit</span>' : '') + '</span></div>' +
      (totalBytes > 4 * 1024 * 1024 ? '<div class="page-actions" style="margin-top:8px"><button class="btn small" id="prune-caches">Prune rebuildable caches</button></div>' : '') +
      '<div class="dim" style="margin-top:8px">' + (age == null ? 'No live prices yet.' : 'Prices last refreshed ' + age.toFixed(1) + ' hours ago.') + '</div></section>' +
      '<section class="panel"><div class="panel-h">Data freshness</div>' +
      (window.VAULT_MANIFEST ? Object.entries(window.VAULT_MANIFEST.files).filter(([, v]) => v.kb > 1).map(([f, v]) =>
        '<div class="mover"><span>' + f.replace('.js', '') + '</span><span class="dim">' + v.kb + ' KB, built ' + v.built +
        ((Date.now() - new Date(v.built).getTime()) > 60 * 864e5 ? ' <span class="warn-text">stale</span>' : '') + '</span></div>').join('')
        : '<div class="dim">No manifest.</div>') + '</section>' +
      '<section class="panel"><div class="panel-h">Diagnostics</div>' +
      '<p class="dim">If something misbehaves, copy this and send it to Keanen.</p>' +
      '<div class="page-actions"><button class="btn small" id="copy-diag">Copy diagnostics</button></div></section>' +
      '<section class="panel"><div class="panel-h">Tools</div><div class="page-actions wrap">' +
      '<button class="btn" id="data-refresh">Refresh prices</button>' +
      '<label class="btn" for="file-csv">Upload ManaBox CSV</label>' +
      (Store.seedAvailable() && !Store.state.seeded ? '<button class="btn" id="seed-import">Load built-in vault</button>' : '') +
      '<button class="btn danger" id="data-clear">Clear all local data</button></div></section>';
  }

  // ---------- collector ----------
  const overallTitle = (prog) => Store.collectorTitle(prog);

  function collectorRow(s) {
    const tier = s.owned > 0 ? Store.setTier(s.owned, s.total) : null;
    const nt = Store.nextTier(s.owned, s.total);
    return '<div class="set-row" data-set="' + esc(s.c) + '" data-name="' + esc(s.n.toLowerCase()) + '" data-pct="' + Math.round(s.pct * 100) + '" data-owned="' + s.owned + '" data-year="' + (s.y || 0) + '" data-size="' + s.total + '">' +
      '<div class="set-head"><span class="set-n">' + esc(s.n) + ' <span class="dim">' + (s.y || '') + '</span></span>' +
      (tier ? '<span class="badge ' + tier.cls + '">' + tier.name + '</span>' : '') +
      '<span class="set-count">' + s.owned + ' / ' + s.total + '</span></div>' +
      '<div class="set-track"><div class="set-fill' + (s.pct >= 1 ? ' full' : '') + '" style="width:' + (s.owned ? Math.max(2, Math.round(s.pct * 100)) : 0) + '%"></div></div>' +
      (nt && s.owned > 0 ? '<div class="set-next dim">' + nt.need + ' more to ' + nt.name + '</div>' : '') +
      '<div class="set-detail" id="set-detail-' + esc(s.c) + '"></div></div>';
  }

  function ringHtml(id, label, owned, total, accentCls) {
    const frac = total > 0 ? Math.min(1, owned / total) : 0;
    const C = 2 * Math.PI * 52;
    return '<div class="ring-wrap">' +
      '<svg viewBox="0 0 120 120" class="ring" aria-hidden="true">' +
      '<circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
      '<circle class="ring-fg ' + accentCls + '" id="' + id + '" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" data-offset="' + (C * (1 - frac)).toFixed(1) + '"></circle></svg>' +
      '<div class="ring-txt"><span class="ring-big count-up" data-target="' + owned + '">0</span>' +
      '<span class="ring-of">of ' + total.toLocaleString() + '</span><span class="ring-label">' + label + '</span></div></div>';
  }

  function milestoneShelf(prog) {
    const earned = [];
    let nextUp = null;
    const claim = (got, target, label) => {
      if (got >= target) earned.push(label);
      else if (!nextUp) nextUp = { label, toGo: target - got };
    };
    for (const t of [100, 500, 1000, 2500, 5000, 10000]) claim(prog.uniqueOwned, t, t.toLocaleString() + ' cards');
    for (const t of [1, 5, 10, 20, 40]) claim(prog.sets.length, t, t + (t === 1 ? ' set started' : ' sets started'));
    const counts = [
      [prog.sets.filter((s) => s.pct >= 1).length, 'Set Master'],
      [prog.sets.filter((s) => s.pct >= 0.9).length, 'Completionist'],
      [prog.sets.filter((s) => s.pct >= 0.5).length, 'Curator'],
    ];
    for (const [n, name] of counts) if (n > 0) earned.push(n > 1 ? n + ' × ' + name : 'First ' + name);
    return '<div class="mil-shelf">' +
      earned.map((m) => '<span class="mil got">' + esc(m) + '</span>').join('') +
      (nextUp ? '<span class="mil locked">' + esc(nextUp.label) + ' <span class="dim">' + nextUp.toGo.toLocaleString() + ' to go</span></span>' : '') +
      '</div>';
  }

  function quickWinsHtml(prog) {
    const wins = prog.sets
      .filter((s) => s.pct < 1)
      .map((s) => ({ s, nt: Store.nextTier(s.owned, s.total) }))
      .filter((x) => x.nt)
      .sort((a, b) => a.nt.need - b.nt.need || b.s.pct - a.s.pct)
      .slice(0, 3);
    if (!wins.length) return '';
    return '<div class="qw-row"><span class="dim">Quick wins:</span>' +
      wins.map((x) => '<button class="chip" data-jump="' + esc(x.s.c) + '">' + esc(x.s.n) + ': ' + x.nt.need + ' to ' + x.nt.name + '</button>').join('') +
      '</div>';
  }

  function viewCollector(params) {
    if (!window.VAULT_SETS || !window.VAULT_SETCARDS) {
      App.ensureData().then(() => App.refresh());
      return '<div class="page-h"><h1>Collector</h1></div><p class="dim">Loading the set index...</p>';
    }
    if (!Store.hasCollection()) {
      return '<div class="page-h"><h1>Collector</h1></div>' +
        '<p class="dim">Upload a ManaBox export and this page tracks your progress through every Magic set: what you hold, what is missing, and the titles you have earned.</p>';
    }
    const mode = params && params.mode === 'prints' ? 'prints' : 'cards';
    const progCards = Store.setProgress('cards');
    const progPrints = Store.setProgress('prints');
    const prog = mode === 'prints' ? progPrints : progCards;
    const showAll = params && params.all === '1';
    const startedCodes = new Set(prog.sets.map((s) => s.c));
    const rest = window.VAULT_SETS.sets
      .filter((s) => !startedCodes.has(s.c))
      .map((s) => ({ ...s, total: mode === 'prints' ? (s.p || s.total) : s.total, owned: 0, pct: 0 }));
    const modeChips =
      '<div class="chips" style="margin:0 0 4px">' +
      '<a class="chip ' + (mode === 'cards' ? 'on' : '') + '" href="#/collector' + (showAll ? '?all=1' : '') + '">Unique cards</a>' +
      '<a class="chip ' + (mode === 'prints' ? 'on' : '') + '" href="#/collector?mode=prints' + (showAll ? '&all=1' : '') + '">All printings</a></div>';
    const leaderboardPanel = Sync.enabled()
      ? '<div class="lb-bar" id="lb-slot"><span class="dim">Leaderboard...</span></div>'
      : '<div class="lb-bar"><span class="lb-bar-l">Leaderboard</span><span class="dim">lives in your sync circle</span><a class="btn small" href="#/data" style="margin-left:auto">Set up sync</a></div>';
    return '<div class="page-h"><h1>Collector</h1></div>' + modeChips +
      leaderboardPanel +
      '<section class="panel collector-hero">' +
      '<div class="hero-title">' + overallTitle(prog) + '</div>' +
      '<div class="ring-pair">' +
      ringHtml('ring-cards', 'distinct cards', progCards.uniqueOwned, progCards.uniqueTotal, '') +
      ringHtml('ring-prints', 'printings', progPrints.uniqueOwned, progPrints.uniqueTotal, 'alt') +
      '</div>' +
      milestoneShelf(prog) +
      quickWinsHtml(prog) +
      '</section>' +
      '<section class="stat-row">' +
      '<div class="stat-tile"><div class="stat-label">Sets started</div><div class="stat-value count-up" data-target="' + prog.sets.length + '">0</div><div class="dim">of ' + window.VAULT_SETS.sets.length + ' in the index</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Set Masters</div><div class="stat-value count-up" data-target="' + prog.sets.filter((s) => s.pct >= 1).length + '">0</div><div class="dim">complete sets</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Closest to done</div><div class="stat-value" style="font-size:15px">' + (prog.sets[0] ? esc(prog.sets[0].n) : 'None yet') + '</div>' + (prog.sets[0] ? '<div class="dim">' + Math.round(prog.sets[0].pct * 100) + '% complete</div>' : '') + '</div>' +
      '</section>' +
      '<section class="panel"><div class="panel-h">Sets</div>' +
      '<p class="dim">' + (mode === 'prints'
        ? 'Strict mode: every printing counts separately, matched by set and collector number.'
        : 'A card you own in any printing counts toward every set it appears in.') +
      ' Tap a set to open the full binder: owned in color, missing in grey.</p>' +
      '<div class="set-controls">' +
      '<input id="set-search" placeholder="Search sets" autocomplete="off">' +
      '<select id="set-sort"><option value="done">Most complete</option><option value="new">Newest</option><option value="name">A to Z</option><option value="big">Biggest</option></select>' +
      '<div class="chips" id="set-tierchips">' +
      '<button class="chip on" data-minpct="-1">All</button>' +
      '<button class="chip" data-minpct="1">Started</button>' +
      '<button class="chip" data-minpct="50">Curator+</button>' +
      '<button class="chip" data-minpct="90">Completionist+</button>' +
      '<button class="chip" data-minpct="100">Done</button></div></div>' +
      '<div id="set-list">' + prog.sets.map(collectorRow).join('') +
      (showAll ? rest.map(collectorRow).join('') : '') + '</div>' +
      (showAll
        ? '<div class="page-actions" style="margin-top:10px"><a class="btn small" href="#/collector' + (mode === 'prints' ? '?mode=prints' : '') + '">Show only my sets</a></div>'
        : '<div class="page-actions" style="margin-top:10px"><a class="btn small" href="#/collector?' + (mode === 'prints' ? 'mode=prints&' : '') + 'all=1">Show all ' + rest.length + ' remaining sets</a></div>') +
      '</section>';
  }

  function leaderboardHtml(entries) {
    if (!entries.length) {
      return '<span class="lb-bar-l">Leaderboard</span><span class="dim">nobody on the board yet' +
        (Sync.boardOn() ? '; yours appears after the next sync' : '; join from the Data page') + '</span>';
    }
    const meSlug = (Sync.meta() || {}).slug;
    const myIdx = entries.findIndex((e) => e.slug === meSlug);
    const mini = entries.slice(0, 3).map((e, i) =>
      '<span class="lb-mini' + (e.slug === meSlug ? ' me' : '') + '"><span class="lb-medal m' + (i + 1) + '">' + (i + 1) + '</span>' +
      esc(e.name) + ' <span class="dim">' + (e.cards || 0).toLocaleString() + '</span></span>').join('');
    const row = (e, i) => {
      const me = e.slug === meSlug;
      return '<div class="lb-row' + (me ? ' me' : '') + '">' +
        '<span class="lb-rank' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + esc(e.name) + (me ? ' <span class="dim">you</span>' : '') +
        '<span class="lb-title">' + esc(e.title || '') + '</span></span>' +
        '<span class="lb-nums"><strong>' + (e.cards || 0).toLocaleString() + '</strong> cards' +
        '<span class="dim">' + (e.prints || 0).toLocaleString() + ' printings' + (e.masters ? ', ' + e.masters + ' mastered' : '') + '</span></span></div>';
    };
    return '<span class="lb-bar-l">Leaderboard</span>' + mini +
      '<button class="btn small" id="lb-toggle" style="margin-left:auto">' +
      (entries.length > 3 ? 'All ' + entries.length : 'Details') + (myIdx >= 3 ? ', you #' + (myIdx + 1) : '') + '</button>' +
      '<div id="lb-more" class="lb-more" hidden>' + entries.map(row).join('') +
      '<div class="dim" style="margin-top:6px">Ranked by distinct cards. Standings update as people sync.</div></div>';
  }

  async function fetchSetCards(code, mode) {
    const cacheKey = (mode === 'prints' ? 'av_setp_' : 'av_set_') + code;
    try {
      const hit = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (hit && Date.now() - hit.t < 7 * 864e5) return hit.cards;
    } catch (e) { /* refetch */ }
    const cards = [];
    let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('e:' + code.toLowerCase() + ' game:paper') +
      '&unique=' + (mode === 'prints' ? 'prints' : 'cards') + '&order=set';
    let pages = 0;
    while (url && pages < 10) {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Scryfall said ' + r.status);
      const d = await r.json();
      for (const c of d.data) cards.push({ n: c.name, cn: c.collector_number, usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null, sid: c.id });
      url = d.has_more ? d.next_page : null;
      pages++;
      if (url) await new Promise((res) => setTimeout(res, 120));
    }
    try {
      // keep at most 10 cached sets across both modes; drop the oldest
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('av_set_') || k.startsWith('av_setp_'));
      if (keys.length >= 10) {
        keys.map((k) => { try { return { k, t: JSON.parse(localStorage.getItem(k)).t || 0 }; } catch (e) { return { k, t: 0 }; } })
          .sort((a, b) => a.t - b.t).slice(0, keys.length - 9).forEach((x) => localStorage.removeItem(x.k));
      }
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), cards }));
    } catch (e) { /* storage full: fine, it refetches */ }
    return cards;
  }

  // ---------- bracket coach ----------
  function viewCoach() {
    const opts = Store.state.userdecks.map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('') +
      Store.state.sessions.map((s) => '<option value="session:' + s.id + '">' + esc(s.name) + ' (imported)</option>').join('');
    return '<div class="page-h"><h1>Bracket coach</h1></div>' +
      '<p class="dim">The pregame conversation, prepared: what your deck is, where it lands, and what to say before the first shuffle.</p>' +
      '<section class="panel"><div class="build-controls">' +
      '<select id="coach-deck">' + (opts || '<option value="">No decks yet</option>') + '</select>' +
      '<select id="coach-target"><option value="0">Honest reading</option><option value="2">I want Bracket 2</option><option value="3">I want Bracket 3</option><option value="4">I want Bracket 4</option></select>' +
      '<button class="btn primary" id="coach-go"' + (opts ? '' : ' disabled') + '>Coach me</button></div>' +
      '<div id="coach-out"></div></section>';
  }

  function coachScriptText(dv, r, target) {
    const gcs = r.gcs || [];
    const fast = (r.combos || []).filter((p) => Rules.comboIsFast(p));
    const late = (r.combos || []).filter((p) => !Rules.comboIsFast(p));
    const winTurn = r.feel >= 5 ? 'any turn it can' : r.feel === 4 ? 'turn 6 or later' : r.feel === 3 ? 'turn 8 or later' : 'turn 9 or later';
    const lines = [
      'Pregame pitch for ' + dv.name + (dv.commander ? ' (' + dv.commander + ')' : '') + ':',
      '',
      '"I\'m on a ' + (r.brainMatches && r.brainMatches[0] ? r.brainMatches[0].name.toLowerCase() + ' deck' : 'themed deck') +
        '. By the bracket rules it\'s a ' + r.bracket + (r.feel !== r.bracket ? ', though it plays closer to a ' + r.feel : '') + '.',
    ];
    if (gcs.length) lines.push('It runs ' + gcs.length + ' Game Changer' + (gcs.length > 1 ? 's' : '') + ': ' + gcs.join(', ') + '.');
    else lines.push('No Game Changers.');
    if (fast.length) lines.push('It has a fast combo finish: ' + fast.map((p) => p.a + ' + ' + p.b).join('; ') + '.');
    if (late.length && !fast.length) lines.push('It can combo late with ' + late.map((p) => p.a + ' + ' + p.b).join('; ') + ', but that\'s a long game plan, not the plan.');
    if ((r.mld || []).length) lines.push('Fair warning, it plays mass land denial: ' + r.mld.join(', ') + '.');
    lines.push('Expect it to try to win around ' + winTurn + '. That fine here?"');
    if (target && target !== r.bracket) {
      lines.push('');
      if (target < r.bracket) {
        lines.push('To honestly call this a Bracket ' + target + ':');
        const gcLimit = target === 3 ? 3 : 0;
        if (gcs.length > gcLimit) lines.push('- Cut ' + (gcs.length - gcLimit) + ' Game Changer' + (gcs.length - gcLimit > 1 ? 's' : '') + ' (' + gcs.slice(gcLimit).join(', ') + ')');
        if (target <= 3 && fast.length) lines.push('- Break the fast combo' + (fast.length > 1 ? 's' : '') + ': remove one side of ' + fast.map((p) => p.a + ' + ' + p.b).join('; '));
        if (target === 2 && late.length) lines.push('- Bracket 2 tables expect no intentional two-card combos at all: ' + late.map((p) => p.a + ' + ' + p.b).join('; '));
        if ((r.mld || []).length) lines.push('- Mass land denial goes: ' + r.mld.join(', '));
        if (lines[lines.length - 1].startsWith('To honestly')) lines.push('- Nothing structural blocks it; the power feel (' + r.feel + ') is the honest number to say out loud');
      } else {
        lines.push('Calling it a Bracket ' + target + ' is fine; nothing about the list under-delivers that promise' +
          (r.feel < target ? ', though it plays softer (feel ' + r.feel + '), so expect to be the underdog' : '') + '.');
      }
    }
    return lines.join('\n');
  }

  // ---------- pilot guide ----------
  function viewPilot() {
    return '<div class="pilot-bar"><a class="btn" href="javascript:history.back()">Back</a>' +
      '<button class="btn" id="pilot-cheat">Cheat card</button>' +
      '<button class="btn primary" id="pilot-print">Save as PDF</button></div>' +
      '<div id="pilot-doc" class="pilot-doc"><div class="dim" style="padding:60px;text-align:center">Reading the deck and building your guide...</div></div>';
  }

  // Deck-box one-pager: the guide compressed to what you glance at mid-game.
  function pilotCheatHtml(m) {
    const box = (title, body) => '<div class="ch-box"><div class="ch-t">' + title + '</div>' + body + '</div>';
    const names = (arr, n) => arr.slice(0, n).map(esc).join(' &middot; ');
    return '<div class="cheat">' +
      '<div class="ch-head"><strong>' + esc(m.name) + '</strong><span>' + (m.commander ? esc(m.commander) + ' &middot; ' : '') + 'Bracket ' + m.bracket +
      (m.subThemes && m.subThemes.length ? ' &middot; ' + m.subThemes.map(esc).join(' + ') : '') + '</span></div>' +
      '<div class="ch-grid">' +
      box('Keep a hand with', '<p>' + m.landTarget + ' lands' + (m.engineNames.length ? ' + one of: <strong>' + names(m.engineNames, 3) + '</strong>' : '') + '</p>') +
      box('The plan', '<p>' + esc(m.plan.split('. ').slice(0, 2).join('. ')) + '.</p>') +
      box('Protect these', m.keyCards.slice(0, 4).map((k) => '<p><strong>' + esc(k.n) + '</strong></p>').join('')) +
      box('How you close', '<p>' + (m.combos.length ? m.combos.slice(0, 2).map((p) => esc(p.a + ' + ' + p.b)).join(', ') + (m.finishers.length ? ', or ' : '') : '') + (m.finishers.length ? names(m.finishers, 3) : '') + '</p>') +
      box('Fear these', '<p>' + (m.hate.length ? names(m.hate, 4) : 'Nothing specific; play around wipes') + '</p>') +
      box('Remember', '<ul>' + m.tips.slice(0, 3).map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>') +
      '</div></div>';
  }

  function pilotDocHtml(m) {
    const sec = (num, title, body) =>
      '<section class="p-sec"><div class="p-num">' + num + '</div><div class="p-body"><h2>' + title + '</h2>' + body + '</div></section>';
    const list = (items) => '<ul class="p-list">' + items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    const openBody =
      '<p>Keep hands with <strong>' + m.landTarget + ' lands</strong>' +
      (m.rampNames.length ? ' plus early mana: <strong>' + m.rampNames.map(esc).join(', ') + '</strong> let you deploy a turn ahead, and this deck rewards being early' : '') + '.</p>' +
      (m.engineNames.length ? '<p>The cards you are hoping to see: <strong>' + m.engineNames.map(esc).join(', ') + '</strong>. Any one of them plus lands is a keep, because each starts the engine the rest of the deck feeds.</p>' : '') +
      (m.interactionNames.length ? '<p>A hand with one of <strong>' + m.interactionNames.map(esc).join(', ') + '</strong> buys time against faster starts.</p>' : '') +
      '<p>Mulligan hands with no play before turn three, and hands that are all top end. A six-card hand that does something beats seven that do nothing.</p>';
    const gameBody =
      '<p><strong>Early, turns 1 to 3.</strong> Lands on curve, ramp first, then the cheapest engine piece. Spend these turns setting the table, not fighting over small plays.</p>' +
      '<p><strong>Middle, turns 4 to 6.</strong> ' + (m.commander ? 'Land ' + esc(m.commander) + ' when you can use or protect it the same turn, not just because you can cast it. ' : '') + 'Deploy engines ahead of payoffs, and read who at the table can punish you for tapping out.</p>' +
      '<p><strong>Late.</strong> ' + (m.finishers.length ? 'Your closers are <strong>' + m.finishers.map(esc).join(', ') + '</strong>. ' : '') +
      (m.combos.length ? m.combos.map((p) => esc(p.a) + ' with ' + esc(p.b) + ' is ' + esc(p.result) + '; assemble it with protection open, not into three untapped blue mana.').join(' ') : 'Convert the engine into pressure before the table unites against the biggest board.') + '</p>';
    const keyBody = m.keyCards.map((k) =>
      '<div class="p-key"><div class="p-key-n">' + esc(k.n) + '</div><div class="p-key-w">' + esc(k.why) + '</div></div>').join('');
    const weakBody = list(m.weaknesses) +
      (m.hate.length ? '<p class="p-hate">Cards to fear: <strong>' + m.hate.map(esc).join(', ') + '</strong>. Assume one is at the table and keep an answer or a rebuild plan.</p>' : '');

    return '<header class="p-head">' +
      '<div class="p-head-l"><div class="p-eyebrow">Pilot guide</div>' +
      '<h1>' + esc(m.name) + '</h1>' +
      '<div class="p-meta">' + (m.commander ? esc(m.commander) + ' &middot; ' : '') + esc(m.archetype) +
      (m.subThemes && m.subThemes.length ? ' &middot; leans ' + m.subThemes.map(esc).join(' + ') : '') +
      ' &middot; Bracket ' + m.bracket + ' ' + esc(m.bracketName) + '</div>' +
      '<div class="p-stats"><div><span>' + m.count + '</span>cards</div><div><span>' + money(m.value) + '</span>value</div>' +
      '<div><span>' + m.avgMv + '</span>avg mana</div><div><span>' + m.comp.lands + '</span>lands</div></div></div>' +
      (m.commanderSid ? '<img class="p-art" src="' + Scry.img(m.commanderSid, 'normal') + '" alt="">' : '') +
      '</header>' +
      sec('01', 'The game plan', '<p>' + esc(m.plan) + '</p>') +
      sec('02', 'Opening hands', openBody) +
      sec('03', 'How the game goes', gameBody) +
      sec('04', 'Key cards', keyBody) +
      sec('05', 'Where you are strong', list(m.strengths)) +
      sec('06', 'Where you are weak', weakBody) +
      sec('07', 'Play tips', list(m.tips)) +
      '<footer class="p-foot">Generated by Aether Vault &middot; ' + new Date().toISOString().slice(0, 10) +
      ' &middot; Card data via Scryfall &middot; Unofficial Fan Content under the Wizards Fan Content Policy</footer>';
  }

  // ---------- wiring ----------
  function wire(root, route, params) {
    // pilot guide
    if (route.startsWith('#/pilot/')) {
      const pkey = route.slice('#/pilot/'.length);
      const pb = $('#pilot-print', root);
      if (pb) pb.addEventListener('click', () => window.print());
      (async () => {
        let dv, rkey;
        if (pkey.startsWith('session:')) {
          const s = Store.state.sessions.find((x) => x.id === pkey.slice(8));
          if (!s) return;
          dv = { name: s.name, commander: '', commanderSid: '', ci: '', cards: s.cards.map((c) => ({ ...c, src: 'user' })) };
          rkey = pkey;
        } else {
          dv = Store.deckView(pkey);
          if (!dv) return;
          if(dv.format==='standard'){const doc=$('#pilot-doc',root);if(doc)doc.innerHTML='<p>Commander pilot guides do not apply to Standard. <a href="#/mydeck/'+esc(pkey)+'">Return to your Standard deck</a> for format checks, or open a working copy for interactions.</p>';return;}
          rkey = pkey;
        }
        try {
          await App.ensureData();
          let r = reports[rkey];
          if (!r) {
            r = await Analyze.run({ cards: dv.cards, ci: dv.ci }, () => {});
            reports[rkey] = r;
          }
          const m = Pilot.model(dv, r);
          const doc = $('#pilot-doc');
          if (doc) doc.innerHTML = pilotDocHtml(m);
          const cb = $('#pilot-cheat', root);
          if (cb) cb.addEventListener('click', () => {
            const d2 = $('#pilot-doc');
            const showingCheat = cb.dataset.on === '1';
            cb.dataset.on = showingCheat ? '' : '1';
            cb.textContent = showingCheat ? 'Cheat card' : 'Full guide';
            if (d2) d2.innerHTML = showingCheat ? pilotDocHtml(m) : pilotCheatHtml(m);
          });
        } catch (e) {
          const doc = $('#pilot-doc');
          if (doc) doc.innerHTML = '<div class="dim" style="padding:60px;text-align:center">Could not reach Scryfall to analyze this deck. Try again.</div>';
        }
      })();
    }
    // collector: rings, count-ups, search/sort/filter, quick-win jumps
    if (route === '#/collector') {
      const lbSlot = $('#lb-slot', root);
      if (lbSlot && Sync.enabled()) {
        Sync.fetchBoard()
          .then((entries) => {
            lbSlot.innerHTML = leaderboardHtml(entries);
            const tg = lbSlot.querySelector('#lb-toggle');
            const more = lbSlot.querySelector('#lb-more');
            if (tg && more) {
              const openLabel = tg.textContent;
              tg.addEventListener('click', () => {
                more.hidden = !more.hidden;
                tg.textContent = more.hidden ? openLabel : 'Hide';
              });
            }
          })
          .catch(() => { lbSlot.innerHTML = '<p class="dim">Could not reach the circle. Check your connection and token.</p>'; });
      }
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $$('.count-up', root).forEach((el) => {
        const target = parseInt(el.getAttribute('data-target'), 10) || 0;
        if (reduced || target === 0) { el.textContent = target.toLocaleString(); return; }
        const t0 = performance.now();
        const dur = 850;
        const step = (now) => {
          const f = Math.min(1, (now - t0) / dur);
          el.textContent = Math.round(target * (1 - Math.pow(1 - f, 3))).toLocaleString();
          if (f < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      $$('.ring-fg', root).forEach((el) => {
        const to = el.getAttribute('data-offset');
        if (reduced) { el.style.transition = 'none'; el.style.strokeDashoffset = to; return; }
        setTimeout(() => { el.style.strokeDashoffset = to; }, 60);
      });
      const applyFilters = () => {
        const term = ($('#set-search', root).value || '').toLowerCase().trim();
        const chipEl = $('#set-tierchips .chip.on', root);
        const minPct = chipEl ? parseInt(chipEl.getAttribute('data-minpct'), 10) : -1;
        $$('#set-list .set-row', root).forEach((r) => {
          const pct = parseInt(r.getAttribute('data-pct'), 10);
          const owned = parseInt(r.getAttribute('data-owned'), 10);
          let pass = true;
          if (minPct === 1) pass = owned > 0;
          else if (minPct > 1) pass = pct >= minPct;
          if (pass && term) pass = r.getAttribute('data-name').includes(term);
          r.style.display = pass ? '' : 'none';
        });
      };
      const search = $('#set-search', root);
      if (search) search.addEventListener('input', applyFilters);
      $$('#set-tierchips .chip', root).forEach((chip) => chip.addEventListener('click', () => {
        $$('#set-tierchips .chip', root).forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        applyFilters();
      }));
      const sortSel = $('#set-sort', root);
      if (sortSel) sortSel.addEventListener('change', () => {
        const list = $('#set-list', root);
        const key = sortSel.value;
        const val = (r) => key === 'new' ? parseInt(r.getAttribute('data-year'), 10)
          : key === 'big' ? parseInt(r.getAttribute('data-size'), 10)
          : key === 'name' ? 0
          : parseInt(r.getAttribute('data-pct'), 10);
        [...list.querySelectorAll('.set-row')]
          .sort((a, b) => key === 'name'
            ? a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'))
            : val(b) - val(a) || a.getAttribute('data-name').localeCompare(b.getAttribute('data-name')))
          .forEach((r) => list.appendChild(r));
      });
      $$('[data-jump]', root).forEach((b) => b.addEventListener('click', () => {
        const row = $('.set-row[data-set="' + b.getAttribute('data-jump') + '"]', root);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const detail = row.querySelector('.set-detail');
        if (detail && !detail.innerHTML) row.querySelector('.set-head').click();
      }));
    }

    // collector: tap a set to see what is missing
    $$('.set-row', root).forEach((rowEl) => rowEl.querySelector('.set-head').addEventListener('click', async () => {
      const code = rowEl.getAttribute('data-set');
      const slot = $('#set-detail-' + code, root);
      if (!slot) return;
      if (slot.innerHTML) { slot.innerHTML = ''; return; }
      slot.innerHTML = '<div class="dim" style="padding:8px 0">Checking the set list...</div>';
      try {
        const mode = params && params.mode === 'prints' ? 'prints' : 'cards';
        const cards = await fetchSetCards(code, mode);
        const ownedCn = mode === 'prints'
          ? new Set(Store.rows().filter((r) => r.s === code && r.cn).map((r) => String(r.cn)))
          : null;
        const isOwned = (c) => mode === 'prints' ? ownedCn.has(String(c.cn)) : Store.ownsName(c.n);
        const missing = cards.filter((c) => !isOwned(c));
        const cost = missing.reduce((s, c) => s + (c.usd || 0), 0);
        const cnVal = (c) => { const m = String(c.cn).match(/\d+/); return m ? parseInt(m[0], 10) : 9999; };
        const grid = [...cards].sort((a, b) => cnVal(a) - cnVal(b)).map((c) => {
          const owned = isOwned(c);
          return '<div class="set-card' + (owned ? '' : ' ghost') + '" data-modal="' + esc(c.n) + '" data-hover-sid="' + (c.sid || '') + '" role="button" tabindex="0" aria-label="' + esc(c.n) + (owned ? '' : ', not owned') + '">' +
            (c.sid ? '<img loading="lazy" alt="" src="' + Scry.img(c.sid, 'small') + '">' : '<div class="stack-noart">' + esc(c.n) + '</div>') +
            '</div>';
        }).join('');
        slot.innerHTML =
          (missing.length
            ? '<div class="dim" style="margin:6px 0">' + missing.length + ' missing, about ' + money(cost) + ' to finish. Grey cards are the gaps. ' +
              '<button class="btn small" data-setwant="' + esc(code) + '">Want list .txt</button></div>'
            : '<div style="padding:6px 0"><span class="badge gold">Set complete</span></div>') +
          '<div class="set-grid">' + grid + '</div>';
        const wb = slot.querySelector('[data-setwant]');
        if (wb) wb.addEventListener('click', () => dl(code.toLowerCase() + '-wantlist.txt', missing.map((c) => '1 ' + c.n).join('\n')));
        slot.querySelectorAll('[data-modal]').forEach((el) => {
          el.addEventListener('click', (ev) => { ev.stopPropagation(); openModal(el.getAttribute('data-modal'),elementPrinting(el)); });
          el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openModal(el.getAttribute('data-modal'),elementPrinting(el)); } });
        });
      } catch (e) {
        slot.innerHTML = '<div class="dim">Could not reach Scryfall (' + esc(e.message || 'network') + '). Try again.</div>';
      }
    }));

    // bracket coach
    const cg = $('#coach-go', root);
    if (cg) cg.addEventListener('click', async () => {
      const sel = $('#coach-deck', root);
      const tgt = parseInt($('#coach-target', root).value, 10);
      const out = $('#coach-out', root);
      let dv;
      if (sel.value.startsWith('session:')) {
        const s = Store.state.sessions.find((x) => x.id === sel.value.slice(8));
        if (!s) return;
        dv = { name: s.name, commander: '', ci: '', cards: s.cards.map((c) => ({ ...c, src: 'user' })) };
      } else dv = Store.deckView(sel.value);
      if (!dv) return;
      cg.disabled = true;
      out.innerHTML = '<p class="dim" style="margin-top:12px">Reading the deck...</p>';
      try {
        await App.ensureData();
        const r = await Analyze.run({ cards: dv.cards, ci: dv.ci }, () => {});
        const txt = coachScriptText(dv, r, tgt);
        out.innerHTML = '<pre class="coach-script">' + esc(txt) + '</pre>' +
          '<div class="page-actions"><button class="btn" id="coach-copy">Copy script</button></div>';
        $('#coach-copy', root).addEventListener('click', () =>
          navigator.clipboard.writeText(txt).then(() => toast('Copied. Read it before the first shuffle.'), () => toast('Could not access clipboard.')));
      } catch (e) {
        out.innerHTML = '<p class="dim" style="margin-top:12px">Could not reach Scryfall to analyze this deck. Try again.</p>';
      }
      cg.disabled = false;
    });

    $$('.chip[data-series]', root).forEach((c) => c.addEventListener('click', () => App.go('#/dashboard', { series: c.getAttribute('data-series') })));
    const wsc = $('#ws-clear', root);
    if (wsc) wsc.addEventListener('click', () => sheet('Remove your uploaded collection from this browser?', [
      { label: 'Remove collection', cb: () => { Store.clearMyCollection(); Workbench.useCollectionSource('browser',true).catch(e=>toast(e.message)); toast('Browser collection removed.'); App.refresh(); } }]));

    const seed = $('#seed-import', root);
    if (seed) seed.addEventListener('click', () => {
      const res = Store.importSeed();
      toast('Imported ' + res.decks + ' decks and ' + res.rows + ' collection rows. They are yours to edit now.');
      App.refresh();
    });

    const search = $('#col-search', root);
    if (search) {
      let t;
      const params2 = () => ({ ...params, q: search.value });
      search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => App.go('#/collection', params2()), 280); });
      $$('select[data-filter]', root).forEach((sel) =>
        sel.addEventListener('change', () => App.go('#/collection', { ...params2(), [sel.getAttribute('data-filter')]: sel.value, show: '' })));
      $$('.seg-b[data-mode]', root).forEach((b) =>
        b.addEventListener('click', () => App.go('#/collection', { ...params2(), mode: b.getAttribute('data-mode') })));
    }
    const more = $('#show-more', root);
    if (more) more.addEventListener('click', () => App.go('#/collection', { ...params, show: more.getAttribute('data-next') }));
    const b2d = $('#binder-to-deck', root);
    if (b2d) b2d.addEventListener('click', () => {
      const d = Store.importBinderAsDeck(b2d.getAttribute('data-binder'));
      if (d) { toast('Binder imported as a deck.'); location.hash = '#/mydeck/' + d.id; }
    });

    $$('[data-move]', root).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const from = route.startsWith('#/mydeck/') ? route.split('/')[2] : 'collection';
      moveSheet(b.getAttribute('data-move'), from,elementPrinting(b));
    }));

    $$('[draggable="true"]', root).forEach((el) => {
      el.addEventListener('dragstart', () => {
        dragCard = { n: el.getAttribute('data-card'), printing:elementPrinting(el), from: route.startsWith('#/mydeck/') ? route.split('/')[2] : 'collection' };
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
    $$('[data-deckdrop]', root).forEach((el) => {
      el.addEventListener('dragover', (e) => { if (dragCard) { e.preventDefault(); el.classList.add('over'); } });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        if (!dragCard) return;
        const key = el.getAttribute('data-deckdrop');
        Store.addToUserDeck(key, dragCard.n, 1, 'main',dragCard.printing);
        Store.addMove(dragCard.n, dragCard.from, key);
        toast(dragCard.n + ' added to ' + Store.deckNameFor(key) + '.');
        dragCard = null;
        App.refresh();
      });
    });

    $$('[data-unmove]', root).forEach((b) => b.addEventListener('click', () => { Store.removeMove(b.getAttribute('data-unmove')); App.refresh(); }));
    const cm = $('#clear-moves', root);
    if (cm) cm.addEventListener('click', () => { Store.clearMoves(); App.refresh(); });

    const nd = $('#new-deck', root);
    if (nd) nd.addEventListener('click', () => sheet('Choose a deck format', ['commander','standard'].map(format=>({label:format==='standard'?'Standard · 60+ main, up to 15 sideboard':'Commander · 100 cards, singleton',cb:()=>{const d=Store.createUserDeck('New '+format+' deck',[],'',{format});location.hash='#/mydeck/'+d.id;}}))));
    $$('[data-delsess]', root).forEach((b) => b.addEventListener('click', () => { Store.deleteSession(b.getAttribute('data-delsess')); App.refresh(); }));

    // analyzer
    const an = $('#analyze', root);
    if (an) an.addEventListener('click', async () => {
      const key = an.getAttribute('data-deck');
      let deck;
      if (key.startsWith('session:')) {
        const s = Store.state.sessions.find((x) => x.id === key.slice(8));
        deck = { cards: s.cards.map((c) => ({ ...c })), ci: '' };
      } else {
        const dv = Store.deckView(key);
        deck = { cards: dv.cards, ci: dv.ci };
      }
      an.disabled = true;
      const orig = an.textContent;
      try {
        await App.ensureData();
        const r = await Analyze.run(deck, (d, t) => { an.textContent = 'Reading ' + d + '/' + t; });
        reports[key] = r;
        App.refresh();
        const slot = $('#report-slot');
        if (slot) slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        toast('Analysis failed to reach Scryfall. Try again.');
        an.disabled = false;
        an.textContent = orig;
      }
    });

    // report actions: add a suggestion, create an upgraded build
    $$('[data-addcard]', root).forEach((b) => b.addEventListener('click', () => {
      const id = route.split('/')[2];
      Store.addToUserDeck(id, b.getAttribute('data-addcard'), 1);
      toast('Added ' + b.getAttribute('data-addcard') + '.');
      App.refresh();
    }));
    const upg = $('[data-upgrade]', root);
    if (upg) upg.addEventListener('click', () => {
      const key = route.startsWith('#/mydeck/') ? route.split('/')[2] : 'session:' + route.split('/')[2];
      const r = reports[key];
      if (!r || !r.brainSuggestions) return;
      let base;
      let name;
      let commander = '';
      if (key.startsWith('session:')) {
        const s = Store.state.sessions.find((x) => x.id === key.slice(8));
        base = s.cards.map((c) => ({ ...c }));
        name = s.name;
      } else {
        const d = Store.userDeck(key);
        base = d.cards.map((c) => ({ ...c }));
        name = d.name;
        commander = d.commander;
      }
      const adds = r.brainSuggestions.items.filter((i) => !base.some((c) => Store.norm(c.n) === Store.norm(i.n)));
      const cutSet = new Set(r.cuts.map((c) => Store.norm(c.n)));
      let removed = 0;
      const kept = base.filter((c) => {
        if (removed < adds.length && cutSet.has(Store.norm(c.n)) && Store.norm(c.n) !== Store.norm(commander)) { removed++; return false; }
        return true;
      });
      for (const a of adds) kept.push({ n: a.n, q: 1, sid: a.sid });
      const nd = Store.createUserDeck(name + ' (upgraded)', kept, commander);
      toast('Upgraded build created. Cards you still need are flagged Bought-able in the list.');
      location.hash = '#/mydeck/' + nd.id;
    });

    // bought flow
    $$('[data-bought]', root).forEach((b) => b.addEventListener('click', () => {
      const n = b.getAttribute('data-bought');
      const own = Store.byName[Store.norm(n)];
      const have = own ? own.qty : 0;
      const dv2 = route.startsWith('#/mydeck/') ? Store.deckView(route.split('/')[2]) : null;
      const inDeck = dv2 ? Store.deckCards(dv2).filter(c=>Store.norm(c.n)===Store.norm(n)).reduce((s,c)=>s+c.q,0) : 1;
      const need = Math.max(1, inDeck - have);
      sheet('Did you buy ' + n + '?', [{
        label: 'Choose the edition and finish for ' + need + ' copies',
        cb: () => { CollectionUI.open([{n,q:need}]); },
      }]);
    }));
    const buyAll = $('#buy-all', root);
    if (buyAll) buyAll.addEventListener('click', () => {
      const dv2 = Store.deckView(route.split('/')[2]);
      const missing = Store.missingFromCollection(Store.deckCards(dv2));
      const total = missing.reduce((s, m) => s + m.unit * m.q, 0);
      sheet('Add all ' + missing.reduce((s, m) => s + m.q, 0) + ' missing cards (' + money(total) + ') to your collection?', [{
        label: 'Choose the editions and finishes I bought',
        cb: () => { CollectionUI.open(missing); },
      }]);
    });
    const dlm = $('#dl-missing', root);
    if (dlm) dlm.addEventListener('click', () => {
      const dv2 = Store.deckView(route.split('/')[2]);
      const missing = Store.missingFromCollection(Store.deckCards(dv2));
      dl('buylist.txt', missing.map((m) => m.q + ' ' + m.n).join('\n'));
    });

    if (route.startsWith('#/mydeck/')) {
      const id = route.split('/')[2];
      const name = $('#deck-name', root);
      if (name) name.addEventListener('change', () => { Store.renameUserDeck(id, name.value.trim() || 'New deck'); App.refresh(); });
      const addZone=$('#deck-add-zone',root);if(addZone){addZone.value=deckAddZones[id] || 'main';addZone.onchange=()=>{deckAddZones[id]=addZone.value;};}
      const fmt=$('#deck-format',root);
      if(fmt)fmt.addEventListener('change',()=>{Store.setUserFormat(id,fmt.value);delete reports[id];App.refresh();});
      const check=$('#check-standard',root);
      if(check)check.addEventListener('click',async()=>{
        check.disabled=true;check.textContent='Checking current legality…';
        try{const d=Store.userDeck(id), names=[...new Set(Store.deckCards(d).map(c=>c.n))];
          const result=await Scry.fullCards(names.map(name=>({name})),(done,total)=>{check.textContent='Checking '+done+' / '+total;});
          for(const n of names)delete standardFacts[window.WorkbenchCore.key(n)];
          for(const [name,f] of Object.entries(result.byName))standardFacts[window.WorkbenchCore.key(name)]=f;
          const resolved={};for(const f of Object.values(result.byName))resolved[f.name.toLowerCase()]=f;Store.cacheResolved(resolved);
          if(location.hash.split('?')[0]==='#/mydeck/'+id)App.refresh();
        }catch(e){const slot=$('#standard-result',root);if(slot){const p=document.createElement('p');p.className='standard-error';p.setAttribute('role','alert');p.textContent='Legality lookup failed: '+e.message+'. Existing checks remain preliminary. Try again.';slot.prepend(p);}}
        finally{check.disabled=false;check.textContent='Refresh Standard legality';}
      });
      const cmd = $('#deck-cmd', root);
      if (cmd) cmd.addEventListener('change', () => { Store.setUserCommander(id, cmd.value); App.refresh(); });
      const del = $('#del-mydeck', root);
      if (del) del.addEventListener('click', () => sheet('Delete this deck?', [{ label: 'Delete ' + (Store.userDeck(id) || {}).name, cb: () => { Store.deleteUserDeck(id); location.hash = '#/decks'; } }]));
      const cpd = $('#complete-deck', root);
      if (cpd) cpd.addEventListener('click', async () => {
        cpd.disabled = true;
        cpd.textContent = 'Reading the deck...';
        await App.ensureData();
        const prop = Builder.completeMyDeck(Store.deckView(id));
        if (prop.error) { toast(prop.error); cpd.disabled = false; cpd.textContent = 'Complete my deck'; return; }
        const slot = $('#report-slot', root);
        slot.innerHTML = completeProposalHtml(prop) + slot.innerHTML;
        cpd.textContent = 'Proposal below';
        const addAll = $('#cp-addall', root);
        if (addAll) addAll.addEventListener('click', () => {
          for (const a of prop.adds) Store.addToUserDeck(id, a.n, 1);
          for (const b of prop.basics) Store.addToUserDeck(id, b.n, b.q);
          toast('Deck completed. Anything you do not own shows in the buy bar.');
          App.refresh();
        });
        $$('[data-cpadd]', root).forEach((btn) => btn.addEventListener('click', () => {
          Store.addToUserDeck(id, btn.getAttribute('data-cpadd'), 1);
          btn.disabled = true;
          btn.textContent = 'Added';
        }));
      });
      $$('[data-inc]', root).forEach((b) => b.addEventListener('click', () => { Store.addToUserDeck(id, b.getAttribute('data-inc'), 1, b.closest('[data-zone]')?.dataset.zone,elementPrinting(b)); App.refresh(); }));
      $$('[data-dec]', root).forEach((b) => b.addEventListener('click', () => {
        const n = b.getAttribute('data-dec');
        const d = Store.userDeck(id);
        const zone=b.closest('[data-zone]')?.dataset.zone || 'main';
        const c = (zone==='sideboard'?d.sideboard || []:d.cards).find((x) => Store.norm(x.n) === Store.norm(n) && P.key(x.printing)===P.key(elementPrinting(b)));
        Store.setUserQty(id, n, (c ? c.q : 1) - 1, zone,elementPrinting(b)); App.refresh();
      }));
      $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => { Store.setUserQty(id, b.getAttribute('data-remove'), 0, b.closest('[data-zone]')?.dataset.zone,elementPrinting(b)); App.refresh(); }));
      const exp = $('#export-mydeck', root);
      if (exp) exp.addEventListener('click', () => {
        const dv = Store.deckView(id);
        const text = window.WorkbenchCore.deckText(window.WorkbenchCore.fromStoredDeck(Store.userDeck(id)));
        navigator.clipboard.writeText(text).then(() => toast('Decklist copied.'), () => toast('Could not access clipboard.'));
      });
      const add = $('#add-card', root);
      const sug = $('#add-sug', root);
      if (add) {
        const names = Object.values(Store.state.cards).map((c) => c.n);
        add.addEventListener('input', () => {
          const v = add.value.toLowerCase();
          if (v.length < 2) { sug.innerHTML = ''; return; }
          const hits = names.filter((n) => n.toLowerCase().includes(v)).slice(0, 8);
          sug.innerHTML = hits.map((h) => '<button class="sug" data-add="' + esc(h) + '">' + esc(h) + '</button>').join('') +
            '<button class="sug dim" data-addany="' + esc(add.value) + '">Search Scryfall for “' + esc(add.value) + '”</button>';
          $$('.sug[data-add]', sug).forEach((b) => b.addEventListener('click', () => { Store.addToUserDeck(id, b.getAttribute('data-add'), 1, $('#deck-add-zone',root)?.value); App.refresh(); }));
          const any = $('[data-addany]', sug);
          if (any) any.addEventListener('click', async () => {
            any.textContent = 'Searching...';
            const c = await Scry.cardByName(any.getAttribute('data-addany'));
            if (!c) { any.textContent = 'Not found on Scryfall'; return; }
            const rec = {};
            rec[c.name.toLowerCase()] = { sid: c.id, name: c.name, t: c.type_line, mv: c.cmc, ci: (c.color_identity || []).join(''), usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null };
            Store.cacheResolved(rec);
            Store.addToUserDeck(id, c.name, 1, $('#deck-add-zone',root)?.value);
            App.refresh();
          });
        });
      }
    }

    // builder page: commander-first
    if (route === '#/build') {
      const cs = $('#bld-cmdsearch', root);
      if (cs) cs.addEventListener('change', () => App.go('#/build', { ...params, cmd: cs.value.trim(), arch: '' }));
      const archSel = $('#bld-arch', root);
      if (archSel && !params.cmd) archSel.addEventListener('change', () => App.go('#/build', { ...params, arch: archSel.value }));
      const brSel = $('#bld-bracket', root);
      if (brSel) brSel.addEventListener('change', () => { params.bracket = brSel.value; });
      const goB = $('#bld-go', root);
      if (goB) goB.addEventListener('click', async () => {
        const status = $('#bld-status', root);
        const useCollection = $('#bld-own', root).checked;
        const substitute = $('#bld-sub', root).checked;
        let ownedFacts = null;
        goB.disabled = true;
        try {
          const chosen = cs && cs.value.trim() ? Builder.findCommander(cs.value) : null;
          if (cs && cs.value.trim() && !chosen) {
            status.textContent = 'Pick a commander from the suggestions list.';
            goB.disabled = false;
            return;
          }
          let cmdOverride = null;
          let archKey;
          if (chosen) {
            const fits = Builder.fittingArchetypes(chosen);
            archKey = archSel.value === 'auto' ? (fits[0] ? fits[0].key : null) : archSel.value;
            cmdOverride = await Builder.loadCommanderTemplate(chosen.slug, (msg) => { status.textContent = msg; });
          } else {
            archKey = archSel.value && archSel.value !== 'auto' ? archSel.value : Builder.templates().archetypes[0].key;
          }
          if (substitute && useCollection) {
            status.textContent = 'Scanning your collection for role matches...';
            ownedFacts = await Builder.scanCollection((d, t) => { status.textContent = 'Scanning ' + d + ' of ' + t + ' owned cards...'; });
          }
          const cmdSel = $('#bld-cmd', root);
          const budSel = $('#bld-budget', root);
          const res = Builder.build({
            archKey, cmdIdx: cmdSel ? parseInt(cmdSel.value, 10) : 0, cmdOverride,
            budget: budSel ? parseInt(budSel.value, 10) : 0,
            bracket: parseInt(brSel.value, 10), useCollection, substitute, ownedFacts,
          });
          status.textContent = '';
          if (res.error) { status.textContent = res.error; }
          else {
            window.__lastBuild = res;
            const showBuildResult = (r2, scroll) => {
              const slot = $('#bld-result');
              slot.innerHTML = buildResultHtml(r2);
              const save = $('#bld-save');
              if (save) save.addEventListener('click', () => {
                const d = Store.createUserDeck(r2.archetype + ' (' + r2.commander.name.split(',')[0] + ')',
                  [{ n: r2.commander.name, q: 1, sid: r2.commander.sid }].concat(r2.cards.map((c) => ({ n: c.n, q: c.q, sid: c.sid }))),
                  r2.commander.name);
                const pulls = r2.cards.filter((c) => c.status === 'reserved' && c.lockedIn);
                for (const p of pulls) {
                  const src = Store.userDeck(p.lockedIn.id);
                  const row = src && src.cards.find((c) => Store.norm(c.n) === Store.norm(p.n));
                  if (row) Store.setUserQty(p.lockedIn.id, p.n, row.q - p.q);
                  Store.addMove(p.n, p.lockedIn.id, d.id);
                }
                toast(pulls.length
                  ? 'Saved. ' + pulls.length + (pulls.length > 1 ? ' cards' : ' card') + ' moved out of other decks; the swaps are on your Moves checklist.'
                  : 'Saved. Remember to back up from the Data page.');
                location.hash = '#/mydeck/' + d.id;
              });
              const d1 = $('#bld-dl-deck');
              if (d1) d1.addEventListener('click', () => dl('decklist.txt', Builder.decklistText(r2)));
              const d2 = $('#bld-dl-buy');
              if (d2) d2.addEventListener('click', () => dl('buylist.txt', Builder.buylistText(r2)));
              $$('[data-pull]', slot).forEach((b) => b.addEventListener('click', () => {
                const c = r2.cards.find((x) => x.n === b.getAttribute('data-pull'));
                if (!c || !c.lockedIn) return;
                sheet('Move ' + c.n + ' out of "' + c.lockedIn.name + '" and into this build?', [
                  { label: 'Yes, take it from ' + c.lockedIn.name, cb: () => { c.status = 'reserved'; showBuildResult(r2, false); } },
                ]);
              }));
              $$('[data-unpull]', slot).forEach((b) => b.addEventListener('click', () => {
                const c = r2.cards.find((x) => x.n === b.getAttribute('data-unpull'));
                if (c) { c.status = 'buy'; showBuildResult(r2, false); }
              }));
              if (scroll) slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
            showBuildResult(res, true);
          }
        } catch (e) {
          status.textContent = /fetch|network|http/i.test(e.message || '') ? 'Could not reach Scryfall. Try again.' : 'Build failed: ' + (e.message || 'unknown error');
        }
        goB.disabled = false;
      });
    }

    const cmpBtn = $('#imp-compare', root);
    if (cmpBtn) cmpBtn.addEventListener('click', async () => {
      const text = $('#imp-text', root).value;
      const status = $('#imp-status', root);
      const parsed=window.WorkbenchCore.parseDeck(text);
      if(parsed.errors.length){status.textContent=parsed.errors.join(' ');return;}
      const counts=new Map(), format=$('#imp-format',root).value;
      for(const c of parsed.cards.filter(c=>format==='standard'||c.zone!=='sideboard')){const k=Store.norm(c.n);if(counts.has(k))counts.get(k).q+=c.q;else counts.set(k,{...c});}
      const cards=[...counts.values()];
      if (!cards.length) { status.textContent = 'Nothing to compare.'; return; }
      status.textContent = 'Pricing ' + cards.length + ' cards...';
      const need = cards.filter((c) => !Store.sidFor(c.n)).map((c) => c.n);
      if (need.length) {
        const res = await Scry.resolveNames(need, (d, t) => { status.textContent = 'Resolving ' + d + ' of ' + t + '...'; });
        Store.cacheResolved(res.found);
        if (res.missing.length) status.textContent = 'Not found: ' + res.missing.join(', ');
        else status.textContent = '';
      } else status.textContent = '';
      for (const c of cards) c.sid = Store.sidFor(c.n);
      const cmp = Builder.compare(cards);
      const name = $('#imp-name', root).value.trim() || 'Pasted list';
      $('#compare-slot').innerHTML = compareHtml(cmp, name);
      const bl = $('#cmp-buylist');
      if (bl) bl.addEventListener('click', () => dl('buylist.txt', Builder.compareBuylistText(cmp)));
      $('#compare-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const doImport = async (editable) => {
      const text = $('#imp-text', root).value;
      const name = $('#imp-name', root).value.trim() || 'Imported deck';
      const status = $('#imp-status', root);
      const parsed=window.WorkbenchCore.parseDeck(text);
      if(parsed.errors.length){status.textContent=parsed.errors.join(' ');return;}
      const format=$('#imp-format',root).value;
      const imported=window.WorkbenchCore.setFormat({format,cards:parsed.cards},format);
      const cards=imported.cards;
      if (!cards.length) { status.textContent = 'Nothing to import.'; return; }
      status.textContent = 'Resolving ' + cards.length + ' cards...';
      const need = cards.filter((c) => !Store.sidFor(c.n)).map((c) => c.n);
      if (need.length) {
        const res = await Scry.resolveNames(need, (d, t) => { status.textContent = 'Resolving ' + d + ' of ' + t + '...'; });
        Store.cacheResolved(res.found);
        if (res.missing.length) status.textContent = 'Not found: ' + res.missing.join(', ');
      }
      for (const c of cards) c.sid = Store.sidFor(c.n);
      const options={format,sideboard:cards.filter(c=>c.zone==='sideboard')}, main=cards.filter(c=>c.zone!=='sideboard'), commander=cards.find(c=>c.zone==='commander')?.n || '';
      if(cards.filter(c=>c.zone==='commander').length>1){status.textContent='Paired commanders are supported in Workbench. Import this list there to preserve both commanders.';return;}
      if (editable) { const d = Store.createUserDeck(name, main, commander, options); location.hash = '#/mydeck/' + d.id; }
      else { const s = Store.saveSession(name, main, {...options,commander}); location.hash = '#/session/' + s.id; }
      toast('Imported ' + name + (format==='standard'?'. Use Refresh Standard legality to check current cards.':'. Run Analyze for a bracket read.'));
    };
    const g1 = $('#imp-go', root);
    if (g1) g1.addEventListener('click', () => doImport(true));
    const g2 = $('#imp-go-ro', root);
    if (g2) g2.addEventListener('click', () => doImport(false));
    const se = $('#sess-edit', root);
    if (se) se.addEventListener('click', () => {
      const s = Store.state.sessions.find((x) => x.id === se.getAttribute('data-id'));
      if (!s) return;
      const d = Store.createUserDeck(s.name, s.cards, s.commander, {format:s.format,sideboard:s.sideboard});
      location.hash = '#/mydeck/' + d.id;
    });

    // sync panel
    const se2 = $('#sync-enable', root);
    if (se2) se2.addEventListener('click', async () => {
      const status = $('#sync-status', root);
      try {
        status.textContent = 'Checking...';
        const res = await Sync.enable($('#sync-name', root).value, $('#sync-pin', root).value, $('#sync-token', root).value.trim());
        if (res.found) {
          const cc = Sync.counts(res.cloud);
          const lc = Sync.counts(Sync.currentVault());
          sheet('A vault already exists for this name and PIN.', [
            { label: 'Load cloud onto this device (' + cc.cards + ' cards, ' + cc.decks + ' decks)', cb: () => { Sync.applyCloud(res.cloud); toast('Cloud vault loaded.'); App.refresh(); } },
            { label: 'Overwrite cloud with this device (' + lc.cards + ' cards, ' + lc.decks + ' decks)', cb: async () => { await Sync.push(); toast('Cloud vault replaced.'); App.refresh(); } },
          ]);
        } else {
          await Sync.push();
          toast('Sync enabled. First push done.');
          App.refresh();
        }
      } catch (e) { status.textContent = e.message; }
    });
    const sp = $('#sync-push', root);
    if (sp) sp.addEventListener('click', async () => {
      sp.disabled = true;
      const st2 = $('#sync-status2', root);
      try {
        const lc = Sync.counts(Sync.currentVault());
        if (lc.cards === 0 && lc.decks === 0) {
          if (st2) st2.textContent = 'Checking the cloud before pushing an empty vault...';
          const cloud = await Sync.pull().catch(() => null);
          const cc = cloud ? Sync.counts(cloud) : null;
          if (st2) st2.textContent = '';
          if (cc && (cc.cards > 0 || cc.decks > 0)) {
            sheet('This device is empty, but the cloud vault holds ' + cc.cards + ' cards and ' + cc.decks + ' decks. Pushing would erase the cloud copy.', [
              { label: 'Load the cloud vault here instead', cb: () => { Sync.applyCloud(cloud); toast('Cloud vault loaded.'); App.refresh(); } },
              { label: 'Push the empty vault anyway', cb: async () => { await Sync.push(); toast('Pushed.'); App.refresh(); } },
            ]);
            sp.disabled = false;
            return;
          }
        }
        await Sync.push();
        toast('Pushed ' + lc.cards + ' cards, ' + lc.decks + ' decks.');
        App.refresh();
      } catch (e) { toast(e.message); }
      sp.disabled = false;
    });
    const spl = $('#sync-pull', root);
    if (spl) spl.addEventListener('click', async () => {
      spl.disabled = true;
      try {
        const cloud = await Sync.pull();
        if (!cloud) toast('Nothing in the cloud yet.');
        else {
          const cc = Sync.counts(cloud);
          const lc = Sync.counts(Sync.currentVault());
          const warn = cc.cards === 0 && cc.decks === 0 && (lc.cards > 0 || lc.decks > 0)
            ? ' The cloud copy is EMPTY and this device is not; loading it would blank this device (a snapshot is kept either way).'
            : '';
          sheet('Cloud vault: ' + cc.cards + ' cards, ' + cc.decks + ' decks. This device: ' + lc.cards + ' cards, ' + lc.decks + ' decks.' + warn, [
            { label: 'Load cloud vault onto this device', cb: () => { Sync.applyCloud(cloud); toast('Loaded. Pre-pull snapshot saved.'); App.refresh(); } }]);
        }
      } catch (e) { toast(e.message); }
      spl.disabled = false;
    });
    const srs = $('#sync-restore-snap', root);
    if (srs) srs.addEventListener('click', () => sheet('Restore this device to the snapshot taken before the last cloud pull?', [
      { label: 'Restore snapshot', cb: () => { Sync.restoreSnapshot(); toast('Snapshot restored.'); App.refresh(); } }]));
    const sb = $('#sync-board', root);
    if (sb) sb.addEventListener('click', async () => {
      sb.disabled = true;
      try {
        if (Sync.boardOn()) {
          await Sync.setBoard(false);
          toast('Left the leaderboard. Your entry was removed.');
        } else {
          const e = await Sync.setBoard(true);
          toast('On the board: ' + e.cards.toLocaleString() + ' cards, ' + e.prints.toLocaleString() + ' printings.');
        }
        App.refresh();
      } catch (err) { toast(err.message || 'Leaderboard update failed.'); }
      sb.disabled = false;
    });
    const so = $('#sync-out', root);
    if (so) so.addEventListener('click', () => sheet('Sign out of sync on this device? Local data stays.', [
      { label: 'Sign out', cb: () => { Sync.signOut(); toast('Signed out.'); App.refresh(); } }]));

    const dr = $('#data-refresh', root);
    if (dr) dr.addEventListener('click', () => refreshPrices(dr));
    const db = $('#data-backup', root);
    if (db) db.addEventListener('click', () => { Store.exportBackup(); toast('Backup downloaded.'); App.refresh(); });
    const dc = $('#data-clear', root);
    if (dc) dc.addEventListener('click', () => sheet('Erase everything stored in this browser?', [{ label: 'Erase local data', cb: () => Store.clearLocalData() }]));
    const pr = $('#prune-caches', root);
    if (pr) pr.addEventListener('click', () => {
      let freed = 0;
      for (const k of Object.keys(localStorage)) {
        if (k === 'av_oracle' || k.startsWith('av_tpl_') || k.startsWith('av_set_') || k.startsWith('av_setp_')) { freed += (localStorage.getItem(k) || '').length; localStorage.removeItem(k); }
      }
      toast('Freed ' + (freed / 1024).toFixed(0) + ' KB. Caches rebuild themselves as needed.');
      App.refresh();
    });
    const cd = $('#copy-diag', root);
    if (cd) cd.addEventListener('click', () => {
      const errs = (() => { try { return JSON.parse(localStorage.getItem('av_errors') || '[]'); } catch (e) { return []; } })();
      const diag = [
        'Aether Vault diagnostics ' + new Date().toISOString(),
        'UA: ' + navigator.userAgent,
        'Storage: ' + Store.storageStats().map((s) => s.label + '=' + (s.bytes / 1024).toFixed(0) + 'KB').join(', '),
        'Data: ' + (window.VAULT_MANIFEST ? JSON.stringify(window.VAULT_MANIFEST.files) : 'no manifest'),
        'Decks: ' + Store.state.userdecks.length + ', collection rows: ' + Store.rows().length + ', sync: ' + (Sync.enabled() ? 'on' : 'off'),
        'Recent errors:', ...errs.map((e) => '  ' + e),
      ].join('\n');
      navigator.clipboard.writeText(diag).then(() => toast('Diagnostics copied.'), () => toast('Could not access clipboard.'));
    });

    $$('.c-card .card-img, .list-row .thumb', root).forEach((el) => {
      if (el.closest('[data-collection-copy]')) return;
      el.addEventListener('click', () => {
        const holder = el.closest('[data-card]');
        openModal(holder ? holder.getAttribute('data-card') : el.getAttribute('data-name'),elementPrinting(el));
      });
    });
    // tapping a card name in any deck list opens the full card art
    $$('[data-modal]', root).forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openModal(el.getAttribute('data-modal'),elementPrinting(el)); });
      if (el.getAttribute('role') === 'button') el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(el.getAttribute('data-modal'),elementPrinting(el)); }
      });
    });
    // list <-> visual deck rendering
    const dvt = $('#deckview-toggle', root);
    if (dvt) dvt.addEventListener('click', () => {
      try { localStorage.setItem('av_deckview', deckViewPref() === 'visual' ? 'list' : 'visual'); } catch (e) { /* full */ }
      App.refresh();
    });
  }

  async function openModal(name, printing) {
    if (!name) return;
    const sid = printing?.id || Store.sidFor(name);
    const modal = document.createElement('div');
    modal.className = 'modal-wrap';
    modal.innerHTML = '<div class="modal"><button class="modal-x">close</button><div class="modal-body">' +
      '<div class="modal-img">' + (sid ? '<img src="' + Scry.img(sid, 'large') + '">' : '') + '</div>' +
      '<div class="modal-info"><h2>' + esc(name) + '</h2><div id="modal-detail" class="dim">Loading...</div></div></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.classList.contains('modal-x')) modal.remove(); });
    const c = sid ? await Scry.cardById(sid) : await Scry.cardByName(name);
    const box = $('#modal-detail', modal);
    if (!box) return;
    if (!c) { box.textContent = 'Could not load details.'; return; }
    const owned = Store.byName[Store.norm(name)];
    const inDecks = (Store.deckOf()[Store.norm(name)] || []);
    box.innerHTML =
      '<p class="printing-label">'+esc(P.label(printing || P.selection(c),c))+'</p><p>'+esc(P.styles(c).join(' · '))+'</p>'+
      '<div class="modal-line">' + esc(c.type_line || '') + '</div>' +
      '<div class="modal-oracle">' + esc(c.oracle_text || (c.card_faces ? c.card_faces.map((f) => f.oracle_text).join('\n//\n') : '')) + '</div>' +
      '<div class="modal-prices">'+(printing ? '<span>'+P.finishLabel(printing.finish)+': '+(P.cents(c,printing.finish)==null?'Unknown':money(P.cents(c,printing.finish)/100))+'</span>' : ['normal','foil','etched'].filter(f=>(c.finishes || ['nonfoil']).includes(f==='normal'?'nonfoil':f)).map(f=>'<span>'+P.finishLabel(f)+': '+(P.cents(c,f)==null?'Unknown':money(P.cents(c,f)/100))+'</span>').join(''))+'</div>'+
      (owned ? '<div class="modal-line">Owned: ' + owned.qty + '</div>' : '') +
      (inDecks.length ? '<div class="modal-line">In decks: ' + inDecks.join(', ') + '</div>' : '');
  }

  async function refreshPrices(btn) {
    const ids = Store.uniqueSids();
    if (!ids.length) { toast('Nothing to price yet. Upload a collection or build a deck first.'); return; }
    const orig = btn.textContent;
    btn.disabled = true;
    const bar = $('#price-progress');
    bar.style.display = 'block';
    try {
      const map = await Scry.pricesByIds(ids, (d, t) => {
        bar.firstElementChild.style.width = Math.round((d / t) * 100) + '%';
        btn.textContent = d + ' / ' + t;
      });
      Store.applyFreshPrices(map);
      toast('Prices refreshed for ' + Object.keys(map).length + ' printings. Snapshot recorded.');
    } catch (e) { toast('Refresh hit an error; kept what it got.'); }
    btn.disabled = false;
    btn.textContent = orig;
    bar.style.display = 'none';
    App.refresh();
  }

  return { viewDashboard, viewCollection, viewDecks, viewMyDeck, viewMoves, viewImport, viewSession, viewGuide, viewData, viewBuild, viewPilot, viewCoach, viewCollector, wire, hoverPreview, refreshPrices, toast, sheet };
})();
