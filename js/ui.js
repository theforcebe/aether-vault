// Aether Vault: rendering and interaction.

const UI = (() => {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => '$' + (v || 0).toFixed(2);
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  const CI_COLORS = { W: '#f2ecd7', U: '#5b8fc9', B: '#4a4550', R: '#d96b5a', G: '#5a9a72', C: '#c2c4cb' };

  let dragCard = null;

  // ---------- primitives ----------
  function pips(ci) {
    if (!ci) return '<span class="pip" style="background:' + CI_COLORS.C + '"></span>';
    return [...ci].map((c) => '<span class="pip" style="background:' + (CI_COLORS[c] || '#999') + '"></span>').join('');
  }

  function cardImgHtml(n, sid, cls) {
    const src = sid ? Scry.img(sid, 'normal') : '';
    return '<div class="card-img ' + (cls || '') + '" data-name="' + esc(n) + '">' +
      (src ? '<img loading="lazy" src="' + src + '" alt="' + esc(n) + '">' : '<div class="card-ph">' + esc(n) + '</div>') +
      '</div>';
  }
  const thumb = (sid) => sid ? '<img class="thumb" loading="lazy" src="' + Scry.img(sid, 'small') + '" alt="">' : '<span class="thumb ph"></span>';

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
  }

  function hoverPreview() {
    let tip = $('#hover-card');
    if (!tip) { tip = document.createElement('div'); tip.id = 'hover-card'; document.body.appendChild(tip); }
    if (window.matchMedia('(hover: none)').matches) return; // no hover cards on touch
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

  // bottom sheet with options
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
      if (ref.kind === 'site') {
        opts.push({ label: 'Move to ' + ref.name.split(',')[0], cb: () => { Store.addMove(cardName, fromKey, ref.key); toast('Added to Moves checklist.'); App.refresh(); } });
      } else {
        opts.push({ label: 'Add to ' + ref.name, cb: () => { Store.addToUserDeck(ref.key.slice(2), cardName, 1); toast('Added to ' + ref.name + '.'); App.refresh(); } });
      }
    }
    if (fromKey !== 'extras') opts.push({ label: 'Move to Extras', cb: () => { Store.addMove(cardName, fromKey, 'extras'); toast('Added to Moves checklist.'); App.refresh(); } });
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
    // points: [{d: 'YYYY-MM-DD', v: number}]
    const o = opts || {};
    if (!points || points.length < 2) {
      return '<div class="chart-empty">' + (o.empty || 'Refresh prices on different days to build your value history. Each refresh records one snapshot per day.') + '</div>';
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
    const gridY = [min, (min + max) / 2, max];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="line-chart" preserveAspectRatio="xMidYMid meet">' +
      gridY.map((v) => '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (P.l - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" class="axis" text-anchor="end">' + money0(v) + '</text>').join('') +
      '<path d="' + area + '" class="area"/>' +
      '<polyline points="' + pts + '" class="line"/>' +
      '<circle cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '" r="3.5" class="dot"/>' +
      '<text x="' + P.l + '" y="' + (H - 6) + '" class="axis">' + points[0].d + '</text>' +
      '<text x="' + (W - P.r) + '" y="' + (H - 6) + '" class="axis" text-anchor="end">' + last.d + '</text>' +
      '</svg>';
  }

  function hbars(entries, colorFn) {
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return '<div class="hbars">' + entries.map(([label, v]) =>
      '<div class="hbar-row"><span class="hbar-l">' + esc(label) + '</span>' +
      '<span class="hbar-track"><span class="hbar-fill" style="width:' + ((v / max) * 100).toFixed(1) + '%;' + (colorFn ? 'background:' + colorFn(label) : '') + '"></span></span>' +
      '<span class="hbar-v">' + v.toLocaleString() + '</span></div>').join('') + '</div>';
  }

  // ---------- views ----------
  function viewDashboard(params) {
    const total = Store.collectionTotal();
    const age = Store.priceAge();
    const rows = Store.rows();
    const nCards = rows.reduce((s, r) => s + r.q, 0);
    const nUnique = Object.keys(Store.byName).length;
    const snaps = Store.state.snapshots;
    const chartKey = params.series || 'collection';
    const series = snaps
      .map((s) => ({ d: s.date, v: chartKey === 'collection' ? s.total : (s.decks && s.decks[chartKey]) }))
      .filter((p) => p.v != null);

    const deckRefs = Store.allDeckRefs();
    const chips = '<div class="chips">' +
      '<button class="chip ' + (chartKey === 'collection' ? 'on' : '') + '" data-series="collection">Collection</button>' +
      deckRefs.map((r) => '<button class="chip ' + (chartKey === r.key ? 'on' : '') + '" data-series="' + r.key + '">' + esc(r.name.split(',')[0]) + '</button>').join('') + '</div>';

    const mv = Store.movers(8);
    const moversHtml = mv.length
      ? mv.map((m) => '<div class="mover" data-hover-sid="' + m.sid + '"><span>' + esc(m.n) + '</span>' +
        '<span class="' + (m.delta > 0 ? 'up' : 'down') + '">' + (m.delta > 0 ? '+' : '') + m.delta.toFixed(2) + '</span></div>').join('')
      : '<div class="dim">Movement appears after two price refreshes on different days.</div>';

    const holdings = Store.topHoldings(8).map((h) =>
      '<div class="hold-row" data-hover-sid="' + (h.sid || '') + '">' + thumb(h.sid) +
      '<span class="hold-n">' + esc(h.n) + (h.f ? ' <span class="badge">' + h.f + '</span>' : '') + '</span>' +
      '<span class="dim">x' + h.q + '</span><span class="hold-v">' + money(h.total) + '</span></div>').join('');

    const dist = Store.distribution();
    const typeEntries = Object.entries(dist.type).sort((a, b) => b[1] - a[1]);
    const deckVals = deckRefs.map((r) => [r.name.split(',')[0], Math.round(r.kind === 'site' ? Store.deckTotal(r.key) : Store.userDeckTotal(r.key.slice(2)))]);

    const isMine = Store.state.workspace === 'mine';
    const wsBar =
      '<div class="ws-bar"><div><span class="ws-label">Viewing</span> <strong>' + esc(Store.workspaceLabel()) + '</strong>' +
      (isMine ? ' <span class="dim">uploaded ' + (Store.state.mycollection.uploaded || '').slice(0, 10) + '</span>' : '') + '</div>' +
      '<div class="ws-actions">' +
      (Store.state.mycollection ? '<button class="btn small" id="ws-toggle">Switch to ' + (isMine ? "Keanen's" : 'my') + ' collection</button>' : '') +
      '<label class="btn small" for="file-csv">' + (Store.state.mycollection ? 'Replace my CSV' : 'Upload your ManaBox CSV') + '</label>' +
      (isMine ? '<button class="btn small" id="ws-clear">Remove my upload</button>' : '') +
      '</div></div>';

    return wsBar +
      '<section class="stat-row">' +
      '<div class="stat-tile"><div class="stat-label">Collection value</div><div class="stat-value">' + money(total) + '</div>' +
      '<div class="dim">' + (age == null ? 'Baseline estimate. Refresh prices for live data.' : 'Prices ' + age.toFixed(1) + 'h old.') + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Cards</div><div class="stat-value">' + nCards.toLocaleString() + '</div><div class="dim">' + nUnique.toLocaleString() + ' unique</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Decks</div><div class="stat-value">' + deckRefs.length + '</div><div class="dim">' + Store.state.userdecks.length + ' custom, ' + Store.state.sessions.length + ' imported</div></div>' +
      '<div class="stat-tile"><div class="stat-label">Snapshots</div><div class="stat-value">' + snaps.length + '</div><div class="dim">' + (snaps.length ? 'since ' + snaps[0].date : 'refresh prices to start') + '</div></div>' +
      '</section>' +
      '<section class="panel"><div class="panel-h">Value over time' +
      '<span class="dim" style="margin-left:auto">One snapshot per day, taken when prices refresh</span></div>' +
      chips + lineChart(series, {}) + '</section>' +
      '<div class="two-col">' +
      '<section class="panel"><div class="panel-h">Top holdings</div>' + holdings + '</section>' +
      '<section class="panel"><div class="panel-h">Price movers</div>' + moversHtml + '</section>' +
      '</div>' +
      '<div class="two-col">' +
      '<section class="panel"><div class="panel-h">Deck value</div>' + hbars(deckVals.map(([l, v]) => [l, v])) + '</section>' +
      '<section class="panel"><div class="panel-h">Collection makeup</div><div class="makeup">' +
      donutFrom(dist.color, 96) + hbars(typeEntries) + '</div></section>' +
      '</div>';
  }

  function viewCollection(params) {
    const q = (params.q || '').toLowerCase();
    const color = params.color || '';
    const type = params.type || '';
    const binder = params.binder || '';
    const sort = params.sort || 'name';
    const mode = params.mode || 'grid';
    const show = parseInt(params.show || '400', 10);

    const binders = [...new Set(Store.rows().map((r) => r.b))];
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
    let body = '';
    if (mode === 'list') {
      body = '<div class="list-head"><span></span><span>Name</span><span>Sets</span><span class="ra">Qty</span><span class="ra">Price</span><span></span></div>' +
        shown.map((it) => {
          const decksIn = Store.deckOf[Store.norm(it.n)] || [];
          return '<div class="list-row" data-card="' + esc(it.n) + '" data-sid="' + (it.sid || '') + '" data-hover-sid="' + (it.sid || '') + '">' +
            thumb(it.sid) +
            '<span class="list-n">' + esc(it.n) + (it.foil ? ' <span class="badge">foil</span>' : '') +
            (decksIn.length ? ' ' + decksIn.map((d) => '<span class="badge">' + d + '</span>').join('') : '') + '</span>' +
            '<span class="dim">' + [...it.sets].slice(0, 3).join(', ') + '</span>' +
            '<span class="ra dim">x' + it.q + '</span>' +
            '<span class="ra list-p">' + money(val(it)) + '</span>' +
            '<button class="btn small m-act" data-move="' + esc(it.n) + '">Move</button></div>';
        }).join('');
    } else {
      body = '<div class="col-grid">' + shown.map((it) => {
        const decksIn = Store.deckOf[Store.norm(it.n)] || [];
        return '<div class="c-card" draggable="true" data-card="' + esc(it.n) + '" data-sid="' + (it.sid || '') + '">' +
          cardImgHtml(it.n, it.sid) +
          '<div class="c-meta"><span class="c-qty">x' + it.q + '</span>' +
          (it.foil ? '<span class="c-foil">foil</span>' : '') +
          '<span class="c-price">' + money(val(it)) + '</span>' +
          '<button class="m-act icon" data-move="' + esc(it.n) + '" title="Move">&#8942;</button></div>' +
          (decksIn.length ? '<div class="c-decks">' + decksIn.map((d) => '<span class="badge">' + d + '</span>').join('') + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
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
      '<div class="seg"><button class="seg-b ' + (mode === 'grid' ? 'on' : '') + '" data-mode="grid">Grid</button>' +
      '<button class="seg-b ' + (mode === 'list' ? 'on' : '') + '" data-mode="list">List</button></div>' +
      '<span class="dim">' + items.length.toLocaleString() + ' results</span></div>' +
      body +
      (items.length > show ? '<div class="show-more"><button class="btn" id="show-more" data-next="' + (show + 600) + '">Show ' + Math.min(600, items.length - show) + ' more</button></div>' : '');
  }

  function viewDecks() {
    const tiles = (refs) => refs.map((r) => {
      const v = r.kind === 'site' ? Store.deckTotal(r.key) : Store.userDeckTotal(r.key.slice(2));
      const dv = Store.deckView(r.key);
      const href = r.kind === 'site' ? '#/deck/' + r.key : '#/mydeck/' + r.key.slice(2);
      return '<a class="deck-tile" href="' + href + '">' +
        cardImgHtml(dv.name, dv.commanderSid, 'tile-art') +
        '<div class="tile-body"><div class="tile-name">' + esc(dv.name) + '</div>' +
        '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
        '<div class="tile-price">' + money(v) + '</div></div></a>';
    }).join('');

    const site = Store.allDeckRefs().filter((r) => r.kind === 'site');
    const mine = Store.allDeckRefs().filter((r) => r.kind === 'user');
    let sess = '';
    for (const s of Store.state.sessions) {
      sess += '<div class="sess-row"><a href="#/session/' + s.id + '">' + esc(s.name) + '</a>' +
        '<span class="dim">' + s.cards.reduce((t, c) => t + c.q, 0) + ' cards</span>' +
        '<button class="btn small" data-delsess="' + s.id + '">delete</button></div>';
    }

    return '<div class="page-h"><h1>Decks</h1>' +
      '<div class="page-actions"><button class="btn primary" id="new-deck">New deck</button>' +
      '<a class="btn" href="#/import">Import a list</a></div></div>' +
      '<div class="panel-h sub">Keanen’s decks</div><div class="deck-grid">' + tiles(site) + '</div>' +
      '<div class="panel-h sub">My decks</div>' +
      (mine.length ? '<div class="deck-grid">' + tiles(mine) + '</div>' : '<p class="dim">Nothing yet. New deck starts a blank list you can build from any card. Import a list brings in a full deck at once.</p>') +
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
        const price = Store.cardValue(c.n, sid) * c.q;
        const warn = o.ci != null && o.ci !== '' && (() => {
          const f = Store.card(c.n);
          return f && [...(f.ci || '')].some((x) => !o.ci.includes(x));
        })();
        rowsH += '<div class="d-row src-' + c.src + '" draggable="true" data-card="' + esc(c.n) + '" data-sid="' + (sid || '') + '" data-hover-sid="' + (sid || '') + '">' +
          (o.editable
            ? '<span class="qty-ctl"><button class="qb" data-dec="' + esc(c.n) + '">&minus;</button><span class="d-q">' + c.q + '</span><button class="qb" data-inc="' + esc(c.n) + '">+</button></span>'
            : '<span class="d-q">' + c.q + '</span>') +
          '<span class="d-n">' + esc(c.n) + '</span>' +
          (warn ? '<span class="badge warn" title="Outside commander color identity">CI</span>' : '') +
          (c.src === 'buy' ? '<span class="badge buy">buy</span>' : '') +
          (c.src === 'moved' ? '<span class="badge moved">moved</span>' : '') +
          '<span class="d-p">' + money(price) + '</span>' +
          (o.editable
            ? '<button class="m-act icon" data-remove="' + esc(c.n) + '" title="Remove">&times;</button>'
            : '<button class="m-act icon" data-move="' + esc(c.n) + '" title="Move">&#8942;</button>') +
          '</div>';
      }
      cols += '<div class="d-col"><div class="d-col-h">' + b + ' <span class="dim">' + count + '</span></div>' + rowsH + '</div>';
    }
    return cols;
  }

  function deckHeadHtml(dv, extra) {
    const cards = dv.cards;
    const total = cards.reduce((s, c) => s + c.q, 0);
    const value = cards.reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0);
    return '<div class="deck-head">' +
      cardImgHtml(dv.name, dv.commanderSid, 'deck-art') +
      '<div class="deck-info"><h1>' + esc(dv.name) + '</h1>' +
      '<div class="tile-sub">' + esc(dv.sub) + ' ' + pips(dv.ci) + '</div>' +
      '<div class="deck-stats"><span>' + total + ' cards</span><span>' + money(value) + '</span>' +
      (dv.gcs && dv.gcs.length ? '<span class="badge gc">GC: ' + dv.gcs.join(', ') + '</span>' : '') +
      '</div>' + (extra || '') + '</div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>';
  }

  function viewDeck(dk) {
    const dv = Store.deckView(dk);
    if (!dv) return '<p>Unknown deck.</p>';
    const buys = dv.cards.filter((c) => c.src === 'buy');
    const buyTotal = buys.reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0);
    const extra = '<div class="deck-actions">' +
      '<button class="btn small" id="clone-deck" data-key="' + dk + '">Clone to my decks</button>' +
      '<button class="btn small" id="export-deck" data-key="' + dk + '">Copy list</button>' +
      (buys.length ? '<span class="badge buy">' + buys.length + ' to buy, ' + money(buyTotal) + '</span>' : '') + '</div>';
    return deckHeadHtml(dv, extra) +
      '<div class="drop-bar dim">Drag a card onto another deck in Decks, or use the three-dot button on any row to move it. Moves land in your checklist.</div>' +
      '<div class="deck-cols">' + deckColumnsHtml(dv.cards, { ci: null }) + '</div>';
  }

  function viewMyDeck(id) {
    const d = Store.userDeck(id);
    if (!d) return '<p>Deck not found.</p>';
    const dv = Store.deckView('u:' + id);
    const ciOfCommander = (() => {
      if (!d.commander) return null;
      const c = Store.card(d.commander);
      return c ? (c.ci || '') : null;
    })();
    const extra = '<div class="deck-actions">' +
      '<input id="deck-name" value="' + esc(d.name) + '" title="Deck name">' +
      '<select id="deck-cmd"><option value="">No commander set</option>' +
      d.cards.map((c) => '<option ' + (Store.norm(c.n) === Store.norm(d.commander) ? 'selected' : '') + '>' + esc(c.n) + '</option>').join('') +
      '</select>' +
      '<button class="btn small" id="export-mydeck">Copy list</button>' +
      '<button class="btn small danger" id="del-mydeck">Delete</button></div>' +
      '<div class="add-wrap"><input id="add-card" placeholder="Add a card, type to search" autocomplete="off"><div id="add-sug"></div></div>';
    return deckHeadHtml(dv, extra) +
      '<div class="deck-cols">' + deckColumnsHtml(dv.cards, { editable: true, ci: ciOfCommander }) + '</div>' +
      (ciOfCommander ? '<p class="dim">Rows marked CI are outside ' + esc(d.commander) + '’s color identity.</p>' : '');
  }

  function viewMoves() {
    const ms = Store.state.moves;
    if (!ms.length) return '<div class="page-h"><h1>Moves</h1></div><p class="dim">No pending moves. Use the three-dot button on any card, or drag on desktop, to plan physical changes. They collect here as a sorting checklist.</p>';
    let rows = '';
    for (const m of ms) {
      rows += '<div class="move-row" data-hover-sid="' + (m.sid || '') + '"><span>' + esc(m.n) + '</span>' +
        '<span class="dim">' + esc(m.from) + ' to ' + esc(m.to) + '</span>' +
        '<button class="btn small" data-unmove="' + m.id + '">undo</button></div>';
    }
    return '<div class="page-h"><h1>Moves</h1><div class="page-actions"><button class="btn" id="clear-moves">Clear all</button></div></div>' +
      '<p class="dim">Your physical sorting checklist, stored in this browser.</p>' + rows;
  }

  function viewImport() {
    return '<div class="page-h"><h1>Import a deck</h1></div>' +
      '<p class="dim">Paste a list, one card per line, like: 1 Sol Ring. Images and prices load from Scryfall. The deck saves to this browser only; use Backup on the Data page to move it between devices.</p>' +
      '<textarea id="imp-text" rows="12" placeholder="1 Atraxa, Grand Unifier&#10;1 Sol Ring&#10;..."></textarea>' +
      '<div class="row"><input id="imp-name" placeholder="Deck name">' +
      '<button class="btn primary" id="imp-go">Import as editable deck</button>' +
      '<button class="btn" id="imp-go-ro">Import read-only</button></div>' +
      '<div id="imp-status" class="dim"></div>';
  }

  function viewSession(id) {
    const s = Store.state.sessions.find((x) => x.id === id);
    if (!s) return '<p>Not found.</p>';
    const cards = s.cards.map((c) => ({ ...c, src: 'user' }));
    const value = cards.reduce((t, c) => t + Store.cardValue(c.n, c.sid) * c.q, 0);
    return '<div class="deck-head"><div class="deck-info"><h1>' + esc(s.name) + '</h1>' +
      '<div class="deck-stats"><span>' + cards.reduce((t, c) => t + c.q, 0) + ' cards</span><span>' + money(value) + '</span></div>' +
      '<div class="deck-actions"><button class="btn small" id="sess-edit" data-id="' + s.id + '">Make editable copy</button></div></div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>' +
      '<div class="deck-cols">' + deckColumnsHtml(cards, {}) + '</div>';
  }

  function viewData() {
    const stats = Store.storageStats();
    const totalBytes = stats.reduce((s, x) => s + x.bytes, 0);
    const age = Store.priceAge();
    return '<div class="page-h"><h1>Data</h1></div>' +
      '<section class="panel"><div class="panel-h">How pricing works</div><div class="prose">' +
      '<p><strong>Where card data comes from.</strong> The site ships with a snapshot of the collection (exported from ManaBox) and the seven built decks, including a Scryfall printing id for every card. Card facts and baseline prices were captured at build time.</p>' +
      '<p><strong>What Refresh prices does.</strong> It sends the printing ids to Scryfall’s POST /cards/collection endpoint in batches of 75, throttled to their documented limit of 2 requests per second. Scryfall returns current usd, usd_foil, and usd_etched for each exact printing. Around 1,500 printings takes roughly 15 seconds.</p>' +
      '<p><strong>How value is computed.</strong> Each physical copy is priced by its own printing and finish: foils use usd_foil, etched use usd_etched, otherwise usd. Copies multiply by quantity; deck and collection totals are sums over that. Until your first refresh, numbers are the build-time baseline.</p>' +
      '<p><strong>How history builds.</strong> Every refresh stores the full price map in this browser and records one snapshot per day: collection total plus every deck total. The dashboard chart draws those snapshots. Scryfall updates prices daily and calls them estimates, so more than one refresh a day adds nothing.</p>' +
      '<p><strong>Where it is stored.</strong> Everything lives in this browser’s localStorage: nothing is uploaded anywhere. The only network calls this site makes are to api.scryfall.com and its image CDN. Backup downloads all of it as one JSON file; Restore loads it on any device.</p>' +
      '</div></section>' +
      '<section class="panel"><div class="panel-h">Stored in this browser</div>' +
      stats.map((s) => '<div class="mover"><span>' + s.label + '</span><span class="dim">' + (s.bytes / 1024).toFixed(1) + ' KB</span></div>').join('') +
      '<div class="mover"><span><strong>Total</strong></span><span><strong>' + (totalBytes / 1024).toFixed(1) + ' KB</strong></span></div>' +
      '<div class="dim" style="margin-top:8px">' + (age == null ? 'No live prices yet.' : 'Prices last refreshed ' + age.toFixed(1) + ' hours ago.') + '</div></section>' +
      '<section class="panel"><div class="panel-h">Actions</div><div class="page-actions wrap">' +
      '<button class="btn primary" id="data-refresh">Refresh prices</button>' +
      '<button class="btn" id="data-backup">Download backup</button>' +
      '<label class="btn" for="file-restore">Restore backup</label>' +
      '<label class="btn" for="file-csv">Upload ManaBox CSV</label>' +
      '<button class="btn danger" id="data-clear">Clear all local data</button>' +
      '</div></section>';
  }

  // ---------- wiring ----------
  function wire(root, route, params) {
    // dashboard chips + workspace
    $$('.chip[data-series]', root).forEach((c) => c.addEventListener('click', () => App.go('#/dashboard', { series: c.getAttribute('data-series') })));
    const wst = $('#ws-toggle', root);
    if (wst) wst.addEventListener('click', () => { Store.setWorkspace(Store.state.workspace === 'mine' ? 'site' : 'mine'); App.refresh(); });
    const wsc = $('#ws-clear', root);
    if (wsc) wsc.addEventListener('click', () => { Store.clearMyCollection(); toast('Your uploaded collection was removed from this browser.'); App.refresh(); });

    // collection controls
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

    // move actions (three-dot / Move buttons)
    $$('[data-move]', root).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const from = route.startsWith('#/deck/') ? route.split('/')[2] : 'extras';
      moveSheet(b.getAttribute('data-move'), from);
    }));

    // drag and drop between tiles on Decks page and within deck view
    $$('[draggable="true"]', root).forEach((el) => {
      el.addEventListener('dragstart', () => {
        dragCard = { n: el.getAttribute('data-card'), from: route.startsWith('#/deck/') ? route.split('/')[2] : 'extras' };
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
    $$('.deck-tile', root).forEach((el) => {
      el.addEventListener('dragover', (e) => { if (dragCard) { e.preventDefault(); el.classList.add('over'); } });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        if (!dragCard) return;
        const href = el.getAttribute('href');
        const key = href.startsWith('#/deck/') ? href.split('/')[2] : 'u:' + href.split('/')[2];
        if (key.startsWith('u:')) Store.addToUserDeck(key.slice(2), dragCard.n, 1);
        else Store.addMove(dragCard.n, dragCard.from, key);
        toast(dragCard.n + ' → ' + key);
        dragCard = null;
        App.refresh();
      });
    });

    // moves page
    $$('[data-unmove]', root).forEach((b) => b.addEventListener('click', () => { Store.removeMove(b.getAttribute('data-unmove')); App.refresh(); }));
    const cm = $('#clear-moves', root);
    if (cm) cm.addEventListener('click', () => { Store.clearMoves(); App.refresh(); });

    // decks page
    const nd = $('#new-deck', root);
    if (nd) nd.addEventListener('click', () => {
      const d = Store.createUserDeck('New deck', []);
      location.hash = '#/mydeck/' + d.id;
    });
    $$('[data-delsess]', root).forEach((b) => b.addEventListener('click', () => { Store.deleteSession(b.getAttribute('data-delsess')); App.refresh(); }));

    // deck view actions
    const clone = $('#clone-deck', root);
    if (clone) clone.addEventListener('click', () => {
      const dv = Store.deckView(clone.getAttribute('data-key'));
      const d = Store.createUserDeck('Copy of ' + dv.name, dv.cards.filter((c) => c.src !== 'buy').map((c) => ({ n: c.n, q: c.q, sid: c.sid })), dv.commander);
      toast('Cloned. This copy is yours to edit.');
      location.hash = '#/mydeck/' + d.id;
    });
    const exp = $('#export-deck', root) || $('#export-mydeck', root);
    if (exp) exp.addEventListener('click', () => {
      const key = exp.id === 'export-deck' ? exp.getAttribute('data-key') : 'u:' + route.split('/')[2];
      const dv = Store.deckView(key);
      const text = (dv.commander ? '1 ' + dv.commander + '\n' : '') +
        dv.cards.filter((c) => c.src !== 'commander').map((c) => c.q + ' ' + c.n).join('\n');
      navigator.clipboard.writeText(text).then(() => toast('Decklist copied.'), () => toast('Could not access clipboard.'));
    });

    // my deck editor
    if (route.startsWith('#/mydeck/')) {
      const id = route.split('/')[2];
      const name = $('#deck-name', root);
      if (name) name.addEventListener('change', () => { Store.renameUserDeck(id, name.value.trim() || 'New deck'); App.refresh(); });
      const cmd = $('#deck-cmd', root);
      if (cmd) cmd.addEventListener('change', () => { Store.setUserCommander(id, cmd.value); App.refresh(); });
      const del = $('#del-mydeck', root);
      if (del) del.addEventListener('click', () => {
        sheet('Delete this deck?', [{ label: 'Delete ' + (Store.userDeck(id) || {}).name, cb: () => { Store.deleteUserDeck(id); location.hash = '#/decks'; } }]);
      });
      $$('[data-inc]', root).forEach((b) => b.addEventListener('click', () => {
        Store.addToUserDeck(id, b.getAttribute('data-inc'), 1); App.refresh();
      }));
      $$('[data-dec]', root).forEach((b) => b.addEventListener('click', () => {
        const n = b.getAttribute('data-dec');
        const d = Store.userDeck(id);
        const c = d.cards.find((x) => Store.norm(x.n) === Store.norm(n));
        Store.setUserQty(id, n, (c ? c.q : 1) - 1); App.refresh();
      }));
      $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => { Store.setUserQty(id, b.getAttribute('data-remove'), 0); App.refresh(); }));

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
            const rec = {}; rec[c.name.toLowerCase()] = { sid: c.id, name: c.name, t: c.type_line, mv: c.cmc, ci: (c.color_identity || []).join(''), usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null };
            Store.cacheResolved(rec);
            Store.addToUserDeck(id, c.name, 1);
            App.refresh();
          });
        });
      }
    }

    // import
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
        if (res.missing.length) { status.textContent = 'Not found: ' + res.missing.join(', '); }
      }
      for (const c of cards) c.sid = Store.sidFor(c.n);
      if (editable) {
        const d = Store.createUserDeck(name, cards);
        location.hash = '#/mydeck/' + d.id;
      } else {
        const s = Store.saveSession(name, cards);
        location.hash = '#/session/' + s.id;
      }
      toast('Imported ' + name + '.');
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

    // data page
    const dr = $('#data-refresh', root);
    if (dr) dr.addEventListener('click', () => refreshPrices(dr));
    const db = $('#data-backup', root);
    if (db) db.addEventListener('click', () => Store.exportBackup());
    const dc = $('#data-clear', root);
    if (dc) dc.addEventListener('click', () => sheet('Erase everything stored in this browser?', [{ label: 'Erase local data', cb: () => Store.clearLocalData() }]));

    // card modal from grid images
    $$('.c-card .card-img, .list-row .thumb', root).forEach((el) => {
      el.addEventListener('click', () => {
        const holder = el.closest('[data-card]');
        openModal(holder ? holder.getAttribute('data-card') : el.getAttribute('data-name'));
      });
    });
  }

  async function openModal(name) {
    if (!name) return;
    const sid = Store.sidFor(name);
    const modal = document.createElement('div');
    modal.className = 'modal-wrap';
    modal.innerHTML = '<div class="modal"><button class="modal-x">close</button><div class="modal-body">' +
      '<div class="modal-img">' + (sid ? '<img src="' + Scry.img(sid, 'large') + '">' : '') + '</div>' +
      '<div class="modal-info"><h2>' + esc(name) + '</h2><div id="modal-detail" class="dim">Loading...</div></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.classList.contains('modal-x')) modal.remove(); });
    const c = sid ? await Scry.cardById(sid) : await Scry.cardByName(name);
    const box = $('#modal-detail', modal);
    if (!box) return;
    if (!c) { box.textContent = 'Could not load details.'; return; }
    const decksIn = Store.deckOf[Store.norm(name)] || [];
    const owned = Store.byName[Store.norm(name)];
    box.innerHTML =
      '<div class="modal-line">' + esc(c.type_line || '') + '</div>' +
      '<div class="modal-oracle">' + esc(c.oracle_text || (c.card_faces ? c.card_faces.map((f) => f.oracle_text).join('\n//\n') : '')) + '</div>' +
      '<div class="modal-prices">' +
      (c.prices && c.prices.usd ? '<span>Normal ' + money(parseFloat(c.prices.usd)) + '</span>' : '') +
      (c.prices && c.prices.usd_foil ? '<span>Foil ' + money(parseFloat(c.prices.usd_foil)) + '</span>' : '') + '</div>' +
      (owned ? '<div class="modal-line">Owned: ' + owned.qty + '</div>' : '') +
      (decksIn.length ? '<div class="modal-line">In decks: ' + decksIn.join(', ') + '</div>' : '');
  }

  async function refreshPrices(btn) {
    const ids = Store.uniqueSids();
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
    } catch (e) {
      toast('Refresh hit an error; kept what it got.');
    }
    btn.disabled = false;
    btn.textContent = orig;
    bar.style.display = 'none';
    App.refresh();
  }

  return { viewDashboard, viewCollection, viewDecks, viewDeck, viewMyDeck, viewMoves, viewImport, viewSession, viewData, wire, hoverPreview, refreshPrices, toast };
})();
