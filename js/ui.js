// Aether Vault: rendering and interaction. v3.

const UI = (() => {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => '$' + (v || 0).toFixed(2);
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const CI_COLORS = { W: '#f2ecd7', U: '#5b8fc9', B: '#4a4550', R: '#d96b5a', G: '#5a9a72', C: '#c2c4cb' };

  let dragCard = null;
  const reports = {}; // deckId -> analysis result (session memory)

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
  function tickerHtml(n, sid, f) {
    const t = Store.ticker(n, sid, f || '');
    if (!t) return '';
    const up = t.d >= 0;
    const sign = up ? '+' : '-';
    return '<span class="tick ' + (up ? 'up' : 'down') + '">' + sign + Math.abs(t.d).toFixed(2) +
      ' (' + sign + Math.abs(t.pct).toFixed(1) + '%)</span>';
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
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
    if (window.matchMedia('(hover: none)').matches) return;
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-hover-sid]');
      if (!el || !el.getAttribute('data-hover-sid')) { tip.style.display = 'none'; return; }
      tip.innerHTML = '<img src="' + Scry.img(el.getAttribute('data-hover-sid'), 'normal') + '" alt="">';
      tip.style.display = 'block';
    });
    document.addEventListener('mousemove', (e) => {
      if (tip.style.display !== 'block') return;
      tip.style.left = Math.min(e.clientX + 18, window.innerWidth - 260) + 'px';
      tip.style.top = Math.min(Math.max(e.clientY - 170, 8), window.innerHeight - 350) + 'px';
    });
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

  function moveSheet(cardName, fromKey) {
    const opts = [];
    for (const ref of Store.allDeckRefs()) {
      if (ref.key === fromKey) continue;
      opts.push({ label: 'Add to ' + ref.name, cb: () => { Store.addToUserDeck(ref.key, cardName, 1); Store.addMove(cardName, fromKey, ref.key); toast('Added, and logged in Moves.'); App.refresh(); } });
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
      if (f && f.t.includes('Land')) continue;
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
      if (!f || f.t.includes('Land')) continue;
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
      ? mv.map((m) => '<div class="mover" data-hover-sid="' + m.sid + '"><span>' + esc(m.n) + '</span>' +
        '<span class="' + (m.delta > 0 ? 'up' : 'down') + '">' + (m.delta > 0 ? '+' : '') + m.delta.toFixed(2) + '</span></div>').join('')
      : '<div class="dim">Movement appears after two price refreshes on different days.</div>';
    const holdings = Store.topHoldings(8).map((h) =>
      '<div class="hold-row" data-hover-sid="' + (h.sid || '') + '">' + thumb(h.sid) +
      '<span class="hold-n">' + esc(h.n) + (h.f ? ' <span class="badge">' + h.f + '</span>' : '') + '</span>' +
      '<span class="dim">x' + h.q + '</span><span class="hold-v">' + money(h.total) + '<br>' + tickerHtml(h.n, h.sid, h.f) + '</span></div>').join('');
    const dist = Store.distribution();
    const deckVals = deckRefs.map((r) => [r.name.split(',')[0], Math.round(Store.userDeckTotal(r.key))]);

    const colBar = Store.hasCollection()
      ? '<div class="ws-bar"><div><span class="ws-label">Collection</span> <strong>' + esc(Store.collectionLabel()) + '</strong> <span class="dim">' + nCards.toLocaleString() + ' cards</span></div>' +
        '<div class="ws-actions"><label class="btn small" for="file-csv">Replace CSV</label>' +
        '<button class="btn small" id="ws-clear">Remove</button></div></div>'
      : '<div class="ws-bar"><div><span class="ws-label">No collection loaded.</span> <span class="dim">Deck features work without one.</span></div>' +
        '<div class="ws-actions"><label class="btn small" for="file-csv">Upload ManaBox CSV</label></div></div>';

    return colBar +
      '<section class="stat-row">' +
      '<div class="stat-tile"><div class="stat-label">Collection value</div><div class="stat-value">' + money(total) + '</div>' +
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
    if (!Store.hasCollection()) {
      return '<div class="onboard"><h1>No collection loaded</h1>' +
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
      const k = Store.norm(r.n);
      agg[k] ||= { n: r.n, q: 0, sid: r.sid, b: new Set(), foil: false, sets: new Set() };
      agg[k].q += r.q;
      agg[k].b.add(r.b);
      agg[k].sets.add(r.s);
      if (r.f) agg[k].foil = true;
      if (!agg[k].sid && r.sid) agg[k].sid = r.sid;
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
    const val = (it) => Store.cardValue(it.n, it.sid);
    if (sort === 'price') items.sort((a, b) => val(b) - val(a));
    else if (sort === 'qty') items.sort((a, b) => b.q - a.q);
    else items.sort((a, b) => a.n.localeCompare(b.n));

    const shown = items.slice(0, show);
    const badgeRow = (it) => {
      const inDecks = deckMap[Store.norm(it.n)] || [];
      return inDecks.length ? '<div class="c-decks">' + inDecks.slice(0, 3).map((d) => '<span class="badge">' + esc(d) + '</span>').join('') + '</div>' : '';
    };
    let body = '';
    if (mode === 'list') {
      body = '<div class="list-head"><span></span><span>Name</span><span>Sets</span><span class="ra">Qty</span><span class="ra">Price</span><span></span></div>' +
        shown.map((it) => '<div class="list-row" data-card="' + esc(it.n) + '" data-hover-sid="' + (it.sid || '') + '">' +
          thumb(it.sid) +
          '<span class="list-n">' + esc(it.n) + (it.foil ? ' <span class="badge">foil</span>' : '') + '</span>' +
          '<span class="dim">' + [...it.sets].slice(0, 3).join(', ') + '</span>' +
          '<span class="ra dim">x' + it.q + '</span><span class="ra list-p">' + money(val(it)) + '<br>' + tickerHtml(it.n, it.sid, it.foil ? 'foil' : '') + '</span>' +
          '<button class="btn small m-act" data-move="' + esc(it.n) + '">Add</button></div>').join('');
    } else {
      body = '<div class="col-grid">' + shown.map((it) =>
        '<div class="c-card" draggable="true" data-card="' + esc(it.n) + '" data-sid="' + (it.sid || '') + '">' +
        cardImgHtml(it.n, it.sid) +
        '<div class="c-meta"><span class="c-qty">x' + it.q + '</span>' +
        (it.foil ? '<span class="c-foil">foil</span>' : '') +
        '<span class="c-price">' + money(val(it)) + '</span>' +
        '<button class="m-act icon" data-move="' + esc(it.n) + '" title="Add to a deck">&#8942;</button></div>' +
        (tickerHtml(it.n, it.sid, it.foil ? 'foil' : '') ? '<div class="c-tick">' + tickerHtml(it.n, it.sid, it.foil ? 'foil' : '') + '</div>' : '') +
        badgeRow(it) + '</div>').join('') + '</div>';
    }
    const sel = (name, opts, cur, label) =>
      '<select data-filter="' + name + '"><option value="">' + label + '</option>' +
      opts.map((o) => '<option ' + (cur === o ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';

    return '<div class="filter-bar">' +
      '<input id="col-search" type="search" placeholder="Search ' + Object.keys(agg).length + ' cards" value="' + esc(params.q || '') + '">' +
      sel('color', ['W', 'U', 'B', 'R', 'G', 'C'], color, 'Color') +
      sel('type', ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'], type, 'Type') +
      sel('binder', binders, binder, 'Binder') +
      sel('sort', ['name', 'price', 'qty'], sort, 'Sort') +
      '<div class="seg"><button class="seg-b ' + (mode === 'grid' ? 'on' : '') + '" data-mode="grid">Grid</button><button class="seg-b ' + (mode === 'list' ? 'on' : '') + '" data-mode="list">List</button></div>' +
      '<span class="dim">' + items.length.toLocaleString() + ' results</span>' +
      (binder ? '<button class="btn small" id="binder-to-deck" data-binder="' + esc(binder) + '">Import binder as deck</button>' : '') +
      '</div>' + body +
      (items.length > show ? '<div class="show-more"><button class="btn" id="show-more" data-next="' + (show + 600) + '">Show ' + Math.min(600, items.length - show) + ' more</button></div>' : '');
  }

  function viewDecks() {
    const refs = Store.allDeckRefs();
    const tiles = refs.map((r) => {
      const dv = Store.deckView(r.key);
      return '<a class="deck-tile" href="#/mydeck/' + r.key + '" data-deckdrop="' + r.key + '">' +
        cardImgHtml(dv.name, dv.commanderSid, 'tile-art') +
        '<div class="tile-body"><div class="tile-name">' + esc(dv.name) + '</div>' +
        '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
        '<div class="tile-price">' + money(Store.userDeckTotal(r.key)) + '</div></div></a>';
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
    const t = c ? c.t.split(' // ')[0] : '';
    if (/^Basic Land/.test(t)) return 'Basics';
    if (t.includes('Land')) return 'Lands';
    if (t.includes('Creature')) return 'Creatures';
    if (t.includes('Planeswalker')) return 'Planeswalkers';
    if (t.includes('Instant')) return 'Instants';
    if (t.includes('Sorcery')) return 'Sorceries';
    if (t.includes('Artifact')) return 'Artifacts';
    if (t.includes('Enchantment')) return 'Enchantments';
    return 'Other';
  }

  function deckColumnsHtml(cards, opts) {
    const o = opts || {};
    const buckets = {};
    for (const c of cards) {
      if (c.src === 'commander') continue;
      (buckets[bucketOf(c.n)] ||= []).push(c);
    }
    const order = ['Creatures', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Planeswalkers', 'Lands', 'Basics', 'Other'];
    let cols = '';
    for (const b of order) {
      if (!buckets[b]) continue;
      const list = buckets[b].sort((a, x) => ((Store.card(a.n) || {}).mv || 0) - ((Store.card(x.n) || {}).mv || 0));
      const count = list.reduce((s, c) => s + c.q, 0);
      let rowsH = '';
      for (const c of list) {
        const sid = c.sid || Store.sidFor(c.n);
        const warn = o.ci ? (() => { const f = Store.card(c.n); return f && [...(f.ci || '')].some((x) => !o.ci.includes(x)); })() : false;
        rowsH += '<div class="d-row" draggable="true" data-card="' + esc(c.n) + '" data-hover-sid="' + (sid || '') + '">' +
          (o.editable
            ? '<span class="qty-ctl"><button class="qb" data-dec="' + esc(c.n) + '">&minus;</button><span class="d-q">' + c.q + '</span><button class="qb" data-inc="' + esc(c.n) + '">+</button></span>'
            : '<span class="d-q">' + c.q + '</span>') +
          '<span class="d-n" data-modal="' + esc(c.n) + '">' + esc(c.n) + '</span>' +
          (warn ? '<span class="badge warn" title="Outside commander color identity">CI</span>' : '') +
          '<span class="d-p">' + money(Store.cardValue(c.n, sid) * c.q) + tickerHtml(c.n, sid, '') + '</span>' +
          (o.editable
            ? '<button class="m-act icon" data-remove="' + esc(c.n) + '" title="Remove">&times;</button>'
            : '<button class="m-act icon" data-move="' + esc(c.n) + '" title="Add to a deck">&#8942;</button>') +
          '</div>';
      }
      cols += '<div class="d-col"><div class="d-col-h">' + b + ' <span class="dim">' + count + '</span></div>' + rowsH + '</div>';
    }
    return cols;
  }

  function reportHtml(r) {
    if (!r) return '';
    const bracketInfo = Rules.BRACKETS[r.bracket - 1];
    const feelInfo = Rules.BRACKETS[r.feel - 1];
    const compRow = (label, key) => {
      const [lo, hi] = Rules.BASELINES[key];
      const v = r.comp[key];
      const cls = v < lo ? 'low' : v > hi + 3 ? 'high' : 'ok';
      return '<div class="comp-row"><span>' + label + '</span><span class="comp-v ' + cls + '">' + v + '</span><span class="dim">' + lo + '-' + hi + '</span></div>';
    };
    const chipList = (label, arr) => arr.length
      ? '<div class="sig-row"><span class="sig-l">' + label + '</span>' + arr.map((n) => '<span class="badge">' + esc(n) + '</span>').join('') + '</div>' : '';
    return '<section class="panel report"><div class="panel-h">Deck doctor</div>' +
      '<div class="verdict"><div class="verdict-b"><div class="verdict-n">' + r.bracket + '</div><div class="verdict-t">Bracket ' + r.bracket + ': ' + bracketInfo.name + '</div></div>' +
      (r.feel !== r.bracket ? '<div class="dim">Rules floor is Bracket ' + r.bracket + ', but the power level plays closer to Bracket ' + r.feel + ' (' + feelInfo.name + ').</div>' : '<div class="dim">' + bracketInfo.blurb + '</div>') + '</div>' +
      (r.why.length ? '<ul class="why">' + r.why.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<div class="report-grid">' +
      '<div><div class="panel-h sub">Composition vs baseline</div>' +
      compRow('Lands', 'lands') + compRow('Ramp', 'ramp') + compRow('Card draw', 'draw') + compRow('Removal', 'removal') + compRow('Board wipes', 'wipes') +
      '<div class="comp-row"><span>Average mana value</span><span class="comp-v">' + r.avgMv + '</span><span class="dim">nonland</span></div>' +
      '<div class="comp-row"><span>Cards</span><span class="comp-v">' + r.totalCards + '</span><span class="dim">100</span></div></div>' +
      '<div><div class="panel-h sub">Signals</div>' +
      chipList('Game Changers', r.gcs) + chipList('Fast mana', r.fast) + chipList('Free interaction', r.free) +
      chipList('Tutors', r.tutors.slice(0, 8)) + chipList('Extra turns', r.turns) + chipList('Mass land denial', r.mld) +
      (r.combos.length ? '<div class="sig-row"><span class="sig-l">Combos</span>' + r.combos.map((p) => '<span class="badge ' + (p.mvSum <= 6 ? 'warn' : '') + '">' + esc(p.a + ' + ' + p.b) + '</span>').join('') + '</div>' : '') +
      (r.archetypes.length ? '<div class="sig-row"><span class="sig-l">Archetypes</span>' + r.archetypes.map((a) => '<span class="badge gc">' + esc(a.name) + ' (' + a.hits + ')</span>').join('') + '</div>' : '') +
      (r.brainMatches && r.brainMatches.length ? '<div class="sig-row"><span class="sig-l">Decks like yours</span>' + r.brainMatches.map((m) => '<span class="badge">' + esc(m.name) + ' ' + Math.round(m.score * 100) + '% (' + m.decks + ' decks)</span>').join('') + '</div>' : '') +
      '</div></div>' +
      (r.brainSuggestions ? '<div class="panel-h sub">Most-played in ' + esc(r.brainSuggestions.arch) + ' decks (' + r.brainSuggestions.decks + ' sampled) that this list is missing</div>' +
        '<div class="sig-row">' + r.brainSuggestions.items.map((i) =>
          '<span class="badge ' + (i.owned ? 'own' : 'buy') + '" data-hover-sid="' + (i.sid || '') + '">' + esc(i.n) + ' ' + Math.round(i.f * 100) + '%' +
          (i.owned ? ' owned' : (i.usd != null ? ' ' + money(i.usd) : '')) + '</span>').join('') + '</div>' : '') +
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
    const value = cards.reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0);
    return '<div class="deck-head">' +
      cardImgHtml(dv.name, dv.commanderSid, 'deck-art') +
      '<div class="deck-info"><h1>' + esc(dv.name) + '</h1>' +
      '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
      '<div class="deck-stats"><span>' + total + ' cards</span><span>' + money(value) + '</span>' +
      '<button class="btn small primary" id="analyze" data-deck="' + deckId + '">Analyze deck</button></div>' +
      (extra || '') + '</div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>';
  }

  function viewMyDeck(id) {
    const d = Store.userDeck(id);
    if (!d) return '<p>Deck not found.</p>';
    const dv = Store.deckView(id);
    const extra = '<div class="deck-actions">' +
      '<input id="deck-name" value="' + esc(d.name) + '" title="Deck name">' +
      '<select id="deck-cmd"><option value="">No commander set</option>' +
      d.cards.map((c) => '<option ' + (Store.norm(c.n) === Store.norm(d.commander) ? 'selected' : '') + '>' + esc(c.n) + '</option>').join('') + '</select>' +
      '<button class="btn small" id="export-mydeck">Copy list</button>' +
      '<button class="btn small danger" id="del-mydeck">Delete</button></div>' +
      '<div class="add-wrap"><input id="add-card" placeholder="Add a card, type to search" autocomplete="off"><div id="add-sug"></div></div>';
    return deckHeadHtml(dv, extra, id) +
      '<div id="report-slot">' + (reports[id] ? reportHtml(reports[id]) : '') + '</div>' +
      '<div class="deck-cols">' + deckColumnsHtml(dv.cards, { editable: true, ci: dv.ci || null }) + '</div>';
  }

  function viewSession(id) {
    const s = Store.state.sessions.find((x) => x.id === id);
    if (!s) return '<p>Not found.</p>';
    const dv = { name: s.name, sub: 'Imported list', ci: '', commanderSid: '', cards: s.cards.map((c) => ({ ...c, src: 'user' })) };
    const extra = '<div class="deck-actions"><button class="btn small" id="sess-edit" data-id="' + s.id + '">Make editable copy</button></div>';
    return deckHeadHtml(dv, extra, 'session:' + id) +
      '<div id="report-slot">' + (reports['session:' + id] ? reportHtml(reports['session:' + id]) : '') + '</div>' +
      '<div class="deck-cols">' + deckColumnsHtml(dv.cards, {}) + '</div>';
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
      '<div class="row"><input id="imp-name" placeholder="Deck name">' +
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
    const t = Builder.templates();
    if (!t.archetypes.length) return '<p class="dim">Deck templates failed to load.</p>';
    const archKey = params.arch || t.archetypes[0].key;
    const a = Builder.archetype(archKey) || t.archetypes[0];
    const cmdIdx = Math.min(parseInt(params.cmd || '0', 10), a.commanders.length - 1);
    const cmd = a.commanders[cmdIdx];
    const bracket = parseInt(params.bracket || '3', 10);
    return '<div class="page-h"><h1>Deck builder</h1></div>' +
      '<p class="dim">Pick a theme and a bracket. The build checks itself against your collection; basic lands count as owned.</p>' +
      '<section class="panel"><div class="build-controls">' +
      '<input id="bld-theme" placeholder="Describe a theme: sacrifice, dragons, lifegain..." value="">' +
      '<select id="bld-arch">' + t.archetypes.map((x) => '<option value="' + x.key + '" ' + (x.key === a.key ? 'selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' +
      '<select id="bld-cmd">' + a.commanders.map((c, i) => '<option value="' + i + '" ' + (i === cmdIdx ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>' +
      '<select id="bld-bracket"><option value="2" ' + (bracket === 2 ? 'selected' : '') + '>Bracket 2: Core</option><option value="3" ' + (bracket === 3 ? 'selected' : '') + '>Bracket 3: Upgraded</option><option value="4" ' + (bracket === 4 ? 'selected' : '') + '>Bracket 4: Optimized</option></select>' +
      '<label class="chk"><input type="checkbox" id="bld-own" ' + (Store.hasCollection() ? 'checked' : 'disabled') + '> Use my collection</label>' +
      '<label class="chk"><input type="checkbox" id="bld-sub" ' + (Store.hasCollection() ? '' : 'disabled') + '> Substitute owned equivalents</label>' +
      '<button class="btn primary" id="bld-go">Build</button></div>' +
      '<div class="tile-sub" style="margin-top:10px">' + cardImgHtml(cmd.name, cmd.sid, 'tile-art bld-art') + '<span>Commander: <strong>' + esc(cmd.name) + '</strong> ' + pips(cmd.ci) + (cmd.usd ? ' <span class="dim">' + money(cmd.usd) + '</span>' : '') + '</span></div>' +
      '<div id="bld-status" class="dim"></div></section>' +
      '<div id="bld-result"></div>';
  }

  function buildResultHtml(res) {
    const s = res.stats;
    const groups = {};
    for (const c of res.cards) (groups[c.t === 'Land' ? 'Lands' : c.t + 's'] ||= []).push(c);
    const badge = (c) => c.status === 'owned' ? '<span class="badge own">owned</span>'
      : c.status === 'sub' ? '<span class="badge moved" title="Substituted for ' + esc(c.subFor || '') + '">sub</span>'
      : c.status === 'basic' ? '<span class="badge">basic</span>'
      : '<span class="badge buy">' + money((c.usd || 0)) + '</span>';
    let cols = '';
    for (const [g, list] of Object.entries(groups)) {
      list.sort((a, b) => (a.mv || 0) - (b.mv || 0));
      cols += '<div class="d-col"><div class="d-col-h">' + g + ' <span class="dim">' + list.reduce((x, c) => x + c.q, 0) + '</span></div>' +
        list.map((c) => '<div class="d-row" data-hover-sid="' + (c.sid || '') + '"><span class="d-q">' + c.q + '</span>' +
          '<span class="d-n">' + esc(c.n) + (c.subFor ? ' <span class="dim">for ' + esc(c.subFor) + '</span>' : '') + '</span>' + badge(c) + '</div>').join('') + '</div>';
    }
    return '<section class="panel"><div class="panel-h">' + esc(res.archetype) + ' with ' + esc(res.commander.name) + ' <span class="badge gc">Bracket ' + s.bracket + '</span></div>' +
      '<div class="stat-row" style="margin-bottom:12px">' +
      '<div class="stat-tile"><div class="stat-label">Full deck value</div><div class="stat-value">' + money(s.totalValue) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Cost to complete</div><div class="stat-value">' + money(s.buyCost) + '</div><div class="dim">' + s.buyCount + ' cards' + (s.commanderOwned ? '' : ' + commander') + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">From your collection</div><div class="stat-value">' + (s.ownedCount + s.subCount) + '</div><div class="dim">' + s.subCount + ' substitutions, ' + s.basicCount + ' basics assumed</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Game Changers kept</div><div class="stat-value">' + s.gcs.length + '</div><div class="dim">' + (s.gcs.join(', ') || 'none') + '</div></div></div>' +
      '<div class="page-actions"><button class="btn primary" id="bld-save">Save as my deck</button>' +
      '<button class="btn" id="bld-dl-deck">Decklist .txt</button>' +
      '<button class="btn" id="bld-dl-buy">Buy list .txt</button></div>' +
      (res.notes.length ? '<div class="panel-h sub">Bracket adjustments</div><ul class="why">' + res.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      (res.recommendations && res.recommendations.ownedPopular.length
        ? '<div class="panel-h sub">Already in your collection and popular in real ' + esc(res.archetype) + ' decks</div><div class="sig-row">' +
          res.recommendations.ownedPopular.map((i) => '<span class="badge own" data-hover-sid="' + (i.sid || '') + '">' + esc(i.n) + ' ' + Math.round(i.f * 100) + '%</span>').join('') + '</div>' : '') +
      (res.recommendations && res.recommendations.upgrades.length
        ? '<div class="panel-h sub">Most-played upgrades across ' + res.recommendations.decks + ' real decks</div><div class="sig-row">' +
          res.recommendations.upgrades.map((i) => '<span class="badge buy" data-hover-sid="' + (i.sid || '') + '">' + esc(i.n) + ' ' + Math.round(i.f * 100) + '%' + (i.usd != null ? ' ' + money(i.usd) : '') + '</span>').join('') + '</div>' : '') +
      '</section><div class="deck-cols">' + cols + '</div>';
  }

  function viewGuide() {
    const b = Rules.BRACKETS.map((x) =>
      '<div class="g-bracket"><div class="g-num">' + x.n + '</div><div><strong>' + x.name + '</strong>' +
      '<div class="dim">Games end turn ' + x.turn + '.</div><div>' + x.blurb + '</div></div></div>').join('');
    const arch = Rules.ARCHETYPES.map((a) =>
      '<div class="sugg"><strong>' + a.name + '</strong><div class="sig-row">' + a.staples.slice(0, 6).map((s) => '<span class="badge">' + esc(s) + '</span>').join('') + '</div></div>').join('');
    return '<div class="page-h"><h1>Commander guide</h1></div>' +
      '<section class="panel"><div class="panel-h">The five brackets (October 2025 system)</div>' + b +
      '<p class="dim" style="margin-top:10px">Brackets guide the pregame conversation; they are not laws. The Game Changers list (53 cards as of February 2026) is the shared reference: none in Brackets 1-2, up to three in Bracket 3, unlimited above. Mass land denial and fast two-card combos are Bracket 4 territory. Tutor limits were removed in October 2025; density still shifts how a deck feels.</p></section>' +
      '<section class="panel"><div class="panel-h">Deckbuilding baseline</div><div class="prose">' +
      '<p>A functional 100 usually carries <strong>35-38 lands</strong>, <strong>10-12 ramp</strong>, <strong>8-10 card draw</strong>, <strong>8-10 removal</strong> including <strong>2-4 board wipes</strong>, leaving roughly 30-35 slots for the deck’s actual plan. Aggressive low-curve decks trim lands; landfall and graveyard decks bend every number. The analyzer grades against this baseline and says when it thinks the bend is intentional.</p></div></section>' +
      '<section class="panel"><div class="panel-h">Archetype starting points</div>' + arch + '</section>' +
      '<section class="panel"><div class="panel-h">Sources</div><p class="dim">WotC / Commander Format Panel bracket announcements (October 2025 revision), the February 2026 Game Changers update, EDHREC bracket guide, average decklists and deck database' +
      ((window.VAULT_BRAIN && window.VAULT_BRAIN.decksTotal) ? ' (' + window.VAULT_BRAIN.decksTotal.toLocaleString() + ' real decklists sampled ' + window.VAULT_BRAIN.built + ' power the recommendation engine)' : '') +
      ', Commander Spellbook combo database, and standard community deckbuilding templates.</p></section>';
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
      '<div class="mover"><span><strong>Total</strong></span><span><strong>' + (totalBytes / 1024).toFixed(1) + ' KB</strong></span></div>' +
      '<div class="dim" style="margin-top:8px">' + (age == null ? 'No live prices yet.' : 'Prices last refreshed ' + age.toFixed(1) + ' hours ago.') + '</div></section>' +
      '<section class="panel"><div class="panel-h">Tools</div><div class="page-actions wrap">' +
      '<button class="btn" id="data-refresh">Refresh prices</button>' +
      '<label class="btn" for="file-csv">Upload ManaBox CSV</label>' +
      (Store.seedAvailable() && !Store.state.seeded ? '<button class="btn" id="seed-import">Load built-in vault</button>' : '') +
      '<button class="btn danger" id="data-clear">Clear all local data</button></div></section>';
  }

  // ---------- wiring ----------
  function wire(root, route, params) {
    $$('.chip[data-series]', root).forEach((c) => c.addEventListener('click', () => App.go('#/dashboard', { series: c.getAttribute('data-series') })));
    const wsc = $('#ws-clear', root);
    if (wsc) wsc.addEventListener('click', () => sheet('Remove your uploaded collection from this browser?', [
      { label: 'Remove collection', cb: () => { Store.clearMyCollection(); toast('Collection removed.'); App.refresh(); } }]));

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
      moveSheet(b.getAttribute('data-move'), from);
    }));

    $$('[draggable="true"]', root).forEach((el) => {
      el.addEventListener('dragstart', () => {
        dragCard = { n: el.getAttribute('data-card'), from: route.startsWith('#/mydeck/') ? route.split('/')[2] : 'collection' };
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
        Store.addToUserDeck(key, dragCard.n, 1);
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
    if (nd) nd.addEventListener('click', () => { const d = Store.createUserDeck('New deck', []); location.hash = '#/mydeck/' + d.id; });
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
        const r = await Analyze.run(deck, (d, t) => { an.textContent = 'Reading ' + d + '/' + t; });
        reports[key] = r;
        const slot = $('#report-slot');
        if (slot) { slot.innerHTML = reportHtml(r); slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } catch (e) {
        toast('Analysis failed to reach Scryfall. Try again.');
      }
      an.disabled = false;
      an.textContent = orig;
    });

    if (route.startsWith('#/mydeck/')) {
      const id = route.split('/')[2];
      const name = $('#deck-name', root);
      if (name) name.addEventListener('change', () => { Store.renameUserDeck(id, name.value.trim() || 'New deck'); App.refresh(); });
      const cmd = $('#deck-cmd', root);
      if (cmd) cmd.addEventListener('change', () => { Store.setUserCommander(id, cmd.value); App.refresh(); });
      const del = $('#del-mydeck', root);
      if (del) del.addEventListener('click', () => sheet('Delete this deck?', [{ label: 'Delete ' + (Store.userDeck(id) || {}).name, cb: () => { Store.deleteUserDeck(id); location.hash = '#/decks'; } }]));
      $$('[data-inc]', root).forEach((b) => b.addEventListener('click', () => { Store.addToUserDeck(id, b.getAttribute('data-inc'), 1); App.refresh(); }));
      $$('[data-dec]', root).forEach((b) => b.addEventListener('click', () => {
        const n = b.getAttribute('data-dec');
        const d = Store.userDeck(id);
        const c = d.cards.find((x) => Store.norm(x.n) === Store.norm(n));
        Store.setUserQty(id, n, (c ? c.q : 1) - 1); App.refresh();
      }));
      $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => { Store.setUserQty(id, b.getAttribute('data-remove'), 0); App.refresh(); }));
      const exp = $('#export-mydeck', root);
      if (exp) exp.addEventListener('click', () => {
        const dv = Store.deckView(id);
        const text = (dv.commander ? '1 ' + dv.commander + '\n' : '') +
          dv.cards.filter((c) => c.src !== 'commander').map((c) => c.q + ' ' + c.n).join('\n');
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
          $$('.sug[data-add]', sug).forEach((b) => b.addEventListener('click', () => { Store.addToUserDeck(id, b.getAttribute('data-add'), 1); App.refresh(); }));
          const any = $('[data-addany]', sug);
          if (any) any.addEventListener('click', async () => {
            any.textContent = 'Searching...';
            const c = await Scry.cardByName(any.getAttribute('data-addany'));
            if (!c) { any.textContent = 'Not found on Scryfall'; return; }
            const rec = {};
            rec[c.name.toLowerCase()] = { sid: c.id, name: c.name, t: c.type_line, mv: c.cmc, ci: (c.color_identity || []).join(''), usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null };
            Store.cacheResolved(rec);
            Store.addToUserDeck(id, c.name, 1);
            App.refresh();
          });
        });
      }
    }

    // builder page
    if (route === '#/build') {
      const themeInput = $('#bld-theme', root);
      if (themeInput) themeInput.addEventListener('change', () => {
        const k = Builder.matchTheme(themeInput.value);
        if (k) App.go('#/build', { ...params, arch: k, cmd: '0' });
        else toast('No matching theme. Try: tokens, sacrifice, dragons, spellslinger, lifegain...');
      });
      const archSel = $('#bld-arch', root);
      if (archSel) archSel.addEventListener('change', () => App.go('#/build', { ...params, arch: archSel.value, cmd: '0' }));
      const cmdSel = $('#bld-cmd', root);
      if (cmdSel) cmdSel.addEventListener('change', () => App.go('#/build', { ...params, cmd: cmdSel.value }));
      const brSel = $('#bld-bracket', root);
      if (brSel) brSel.addEventListener('change', () => App.go('#/build', { ...params, bracket: brSel.value }));
      const goB = $('#bld-go', root);
      if (goB) goB.addEventListener('click', async () => {
        const status = $('#bld-status', root);
        const useCollection = $('#bld-own', root).checked;
        const substitute = $('#bld-sub', root).checked;
        let ownedFacts = null;
        goB.disabled = true;
        try {
          if (substitute && useCollection) {
            status.textContent = 'Scanning your collection for role matches...';
            ownedFacts = await Builder.scanCollection((d, t) => { status.textContent = 'Scanning ' + d + ' of ' + t + ' owned cards...'; });
          }
          const res = Builder.build({
            archKey: archSel.value, cmdIdx: parseInt(cmdSel.value, 10),
            bracket: parseInt(brSel.value, 10), useCollection, substitute, ownedFacts,
          });
          status.textContent = '';
          if (res.error) { status.textContent = res.error; }
          else {
            window.__lastBuild = res;
            $('#bld-result').innerHTML = buildResultHtml(res);
            const save = $('#bld-save');
            if (save) save.addEventListener('click', () => {
              const d = Store.createUserDeck(res.archetype + ' (' + res.commander.name.split(',')[0] + ')',
                [{ n: res.commander.name, q: 1, sid: res.commander.sid }].concat(res.cards.map((c) => ({ n: c.n, q: c.q, sid: c.sid }))),
                res.commander.name);
              toast('Saved. Remember to back up from the Data page.');
              location.hash = '#/mydeck/' + d.id;
            });
            const d1 = $('#bld-dl-deck');
            if (d1) d1.addEventListener('click', () => dl('decklist.txt', Builder.decklistText(res)));
            const d2 = $('#bld-dl-buy');
            if (d2) d2.addEventListener('click', () => dl('buylist.txt', Builder.buylistText(res)));
            $('#bld-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch (e) {
          status.textContent = 'Build hit an error reaching Scryfall. Try again.';
        }
        goB.disabled = false;
      });
    }

    const cmpBtn = $('#imp-compare', root);
    if (cmpBtn) cmpBtn.addEventListener('click', async () => {
      const text = $('#imp-text', root).value;
      const status = $('#imp-status', root);
      const cards = [];
      for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const m = l.match(/^(\d+)x?\s+(.+)$/);
        const q = m ? parseInt(m[1], 10) : 1;
        const n = (m ? m[2] : l).replace(/\s*\((.*?)\)\s*[\w-]*\s*$/, '').trim();
        if (n) cards.push({ n, q });
      }
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
      const cards = [];
      for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const m = l.match(/^(\d+)x?\s+(.+)$/);
        const q = m ? parseInt(m[1], 10) : 1;
        const n = (m ? m[2] : l).replace(/\s*\((.*?)\)\s*[\w-]*\s*$/, '').trim();
        if (n) cards.push({ n, q });
      }
      if (!cards.length) { status.textContent = 'Nothing to import.'; return; }
      status.textContent = 'Resolving ' + cards.length + ' cards...';
      const need = cards.filter((c) => !Store.sidFor(c.n)).map((c) => c.n);
      if (need.length) {
        const res = await Scry.resolveNames(need, (d, t) => { status.textContent = 'Resolving ' + d + ' of ' + t + '...'; });
        Store.cacheResolved(res.found);
        if (res.missing.length) status.textContent = 'Not found: ' + res.missing.join(', ');
      }
      for (const c of cards) c.sid = Store.sidFor(c.n);
      if (editable) { const d = Store.createUserDeck(name, cards); location.hash = '#/mydeck/' + d.id; }
      else { const s = Store.saveSession(name, cards); location.hash = '#/session/' + s.id; }
      toast('Imported ' + name + '. Run Analyze for a bracket read.');
    };
    const g1 = $('#imp-go', root);
    if (g1) g1.addEventListener('click', () => doImport(true));
    const g2 = $('#imp-go-ro', root);
    if (g2) g2.addEventListener('click', () => doImport(false));
    const se = $('#sess-edit', root);
    if (se) se.addEventListener('click', () => {
      const s = Store.state.sessions.find((x) => x.id === se.getAttribute('data-id'));
      if (!s) return;
      const d = Store.createUserDeck(s.name, s.cards);
      location.hash = '#/mydeck/' + d.id;
    });

    const dr = $('#data-refresh', root);
    if (dr) dr.addEventListener('click', () => refreshPrices(dr));
    const db = $('#data-backup', root);
    if (db) db.addEventListener('click', () => { Store.exportBackup(); toast('Backup downloaded.'); App.refresh(); });
    const dc = $('#data-clear', root);
    if (dc) dc.addEventListener('click', () => sheet('Erase everything stored in this browser?', [{ label: 'Erase local data', cb: () => Store.clearLocalData() }]));

    $$('.c-card .card-img, .list-row .thumb', root).forEach((el) => {
      el.addEventListener('click', () => {
        const holder = el.closest('[data-card]');
        openModal(holder ? holder.getAttribute('data-card') : el.getAttribute('data-name'));
      });
    });
    // tapping a card name in any deck list opens the full card art
    $$('[data-modal]', root).forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openModal(el.getAttribute('data-modal')); });
    });
  }

  async function openModal(name) {
    if (!name) return;
    const sid = Store.sidFor(name);
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
      '<div class="modal-line">' + esc(c.type_line || '') + '</div>' +
      '<div class="modal-oracle">' + esc(c.oracle_text || (c.card_faces ? c.card_faces.map((f) => f.oracle_text).join('\n//\n') : '')) + '</div>' +
      '<div class="modal-prices">' +
      (c.prices && c.prices.usd ? '<span>Normal ' + money(parseFloat(c.prices.usd)) + '</span>' : '') +
      (c.prices && c.prices.usd_foil ? '<span>Foil ' + money(parseFloat(c.prices.usd_foil)) + '</span>' : '') + '</div>' +
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

  return { viewDashboard, viewCollection, viewDecks, viewMyDeck, viewMoves, viewImport, viewSession, viewGuide, viewData, viewBuild, wire, hoverPreview, refreshPrices, toast };
})();
