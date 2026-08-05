// Aether Vault: rendering and interaction.

const UI = (() => {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => '$' + (v || 0).toFixed(2);
  const CI_COLORS = { W: '#f2ecd7', U: '#5b8fc9', B: '#4a4550', R: '#d96b5a', G: '#5a9a72', C: '#c2c4cb' };

  let dragCard = null;

  // ---------- shared components ----------
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

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  function hoverPreview() {
    let tip = $('#hover-card');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'hover-card';
      document.body.appendChild(tip);
    }
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-hover-sid]');
      if (!el) { tip.style.display = 'none'; return; }
      const sid = el.getAttribute('data-hover-sid');
      if (!sid) { tip.style.display = 'none'; return; }
      tip.innerHTML = '<img src="' + Scry.img(sid, 'normal') + '" alt="">';
      tip.style.display = 'block';
    });
    document.addEventListener('mousemove', (e) => {
      if (tip.style.display !== 'block') return;
      const x = Math.min(e.clientX + 18, window.innerWidth - 260);
      const y = Math.min(Math.max(e.clientY - 170, 8), window.innerHeight - 350);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
  }

  function curveChart(cards) {
    const bins = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..6, 7+
    for (const c of cards) {
      const f = Store.card(c.n);
      const t = f ? f.t : '';
      if (t.includes('Land')) continue;
      const mv = f ? Math.min(Math.floor(f.mv || 0), 7) : 0;
      bins[mv] += c.q;
    }
    const max = Math.max(...bins, 1);
    let bars = '';
    bins.forEach((v, i) => {
      const h = Math.round((v / max) * 72);
      bars += '<div class="cv-col"><div class="cv-bar" style="height:' + h + 'px"></div>' +
        '<div class="cv-n">' + v + '</div><div class="cv-l">' + (i === 7 ? '7+' : i) + '</div></div>';
    });
    return '<div class="curve">' + bars + '</div>';
  }

  function pipDonut(cards) {
    const counts = {};
    let total = 0;
    for (const c of cards) {
      const f = Store.card(c.n);
      if (!f || f.t.includes('Land')) continue;
      const ci = f.ci || 'C';
      for (const ch of ci === '' ? 'C' : ci) { counts[ch] = (counts[ch] || 0) + c.q; total += c.q; }
    }
    if (!total) return '';
    const R = 34, CIRC = 2 * Math.PI * R;
    let off = 0, segs = '';
    for (const [ch, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const len = (v / total) * CIRC;
      segs += '<circle r="' + R + '" cx="45" cy="45" class="donut-seg" stroke="' + (CI_COLORS[ch] || '#888') +
        '" stroke-dasharray="' + len.toFixed(1) + ' ' + (CIRC - len).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '"/>';
      off += len;
    }
    return '<svg viewBox="0 0 90 90" class="donut">' + segs + '</svg>';
  }

  // ---------- views ----------
  function viewVault() {
    const total = Store.collectionTotal();
    const age = Store.priceAge();
    const decks = Object.entries(Store.state.decks);
    let tiles = '';
    for (const [dk, d] of decks) {
      const v = Store.deckTotal(dk);
      const cmd = d.cards.find((c) => c.src === 'commander');
      tiles += '<a class="deck-tile" href="#/deck/' + dk + '">' +
        cardImgHtml(d.name, cmd && cmd.sid, 'tile-art') +
        '<div class="tile-body"><div class="tile-name">' + esc(d.name) + '</div>' +
        '<div class="tile-sub">' + esc(d.sub) + ' ' + pips(d.ci) + '</div>' +
        '<div class="tile-price">' + money(v) + '</div></div></a>';
    }
    const mv = Store.movers(10);
    let moversHtml = mv.length
      ? mv.map((m) => '<div class="mover" data-hover-sid="' + m.sid + '"><span>' + esc(m.n) + '</span>' +
        '<span class="' + (m.delta > 0 ? 'up' : 'down') + '">' + (m.delta > 0 ? '+' : '') + m.delta.toFixed(2) + '</span></div>').join('')
      : '<div class="dim">Refresh prices on two different days to see movement.</div>';

    const snaps = Store.state.snapshots;
    let sparkline = '';
    if (snaps.length > 1) {
      const vals = snaps.map((s) => s.total);
      const min = Math.min(...vals), max = Math.max(...vals);
      const pts = vals.map((v, i) => (i / (vals.length - 1) * 200).toFixed(1) + ',' + (44 - ((v - min) / (max - min || 1)) * 40).toFixed(1)).join(' ');
      sparkline = '<svg viewBox="0 0 200 48" class="spark"><polyline points="' + pts + '" fill="none" stroke="url(#av-grad)" stroke-width="2.5" stroke-linecap="round"/></svg>' +
        '<div class="dim">' + snaps.length + ' snapshots since ' + snaps[0].date + '</div>';
    }

    return '<section class="hero-stats">' +
      '<div class="stat-tile big"><div class="stat-label">Collection value</div><div class="stat-value">' + money(total) + '</div>' +
      '<div class="dim">' + Store.state.rows.reduce((s, r) => s + r.q, 0) + ' cards, ' + Object.keys(Store.byName).length + ' unique' +
      (age == null ? ' | baseline estimate, refresh for live prices' : ' | prices ' + age.toFixed(1) + 'h old') + '</div>' + sparkline + '</div>' +
      '<div class="stat-tile"><div class="stat-label">Price movers</div>' + moversHtml + '</div>' +
      '</section>' +
      '<h2 class="h-grad">Decks</h2><div class="deck-grid">' + tiles + '</div>';
  }

  function viewCollection(params) {
    const q = (params.q || '').toLowerCase();
    const color = params.color || '';
    const type = params.type || '';
    const binder = params.binder || '';
    const sort = params.sort || 'name';

    const binders = [...new Set(Store.state.rows.map((r) => r.b))];
    const agg = {};
    for (const r of Store.state.rows) {
      const k = Store.norm(r.n);
      agg[k] ||= { n: r.n, q: 0, sid: r.sid, b: new Set(), foil: false };
      agg[k].q += r.q;
      agg[k].b.add(r.b);
      if (r.f) agg[k].foil = true;
      if (!agg[k].sid && r.sid) agg[k].sid = r.sid;
    }
    let items = Object.values(agg);

    items = items.filter((it) => {
      if (q && !it.n.toLowerCase().includes(q)) return false;
      const c = Store.card(it.n);
      if (color) {
        const ci = c ? (c.ci || 'C') : 'C';
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

    const shown = items.slice(0, 400);
    let grid = '';
    for (const it of shown) {
      const decksIn = Store.deckOf[Store.norm(it.n)] || [];
      const price = val(it);
      grid += '<div class="c-card" draggable="true" data-card="' + esc(it.n) + '" data-sid="' + (it.sid || '') + '">' +
        cardImgHtml(it.n, it.sid) +
        '<div class="c-meta"><span class="c-qty">x' + it.q + '</span>' +
        (it.foil ? '<span class="c-foil">foil</span>' : '') +
        '<span class="c-price">' + money(price) + '</span></div>' +
        (decksIn.length ? '<div class="c-decks">' + decksIn.map((d) => '<span class="badge">' + d + '</span>').join('') + '</div>' : '') +
        '</div>';
    }

    const sel = (name, opts, cur, label) =>
      '<select data-filter="' + name + '"><option value="">' + label + '</option>' +
      opts.map((o) => '<option ' + (cur === o ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';

    return '<div class="filter-bar">' +
      '<input id="col-search" type="search" placeholder="Search ' + Object.keys(agg).length + ' cards..." value="' + esc(params.q || '') + '">' +
      sel('color', ['W', 'U', 'B', 'R', 'G', 'C'], color, 'Any color') +
      sel('type', ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'], type, 'Any type') +
      sel('binder', binders, binder, 'Any binder') +
      sel('sort', ['name', 'price', 'qty'], sort, 'Sort: name') +
      '<span class="dim">' + items.length + ' results' + (items.length > 400 ? ', showing 400' : '') + '</span></div>' +
      '<div class="col-grid" id="col-grid">' + grid + '</div>';
  }

  function bucketOf(n) {
    const c = Store.card(n);
    const t = c ? c.t.split(' // ')[0] : '';
    if (/^Basic Land/.test(t) || ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(n) || n.startsWith('Snow-Covered')) return 'Basics';
    if (t.includes('Land')) return 'Lands';
    if (t.includes('Creature')) return 'Creatures';
    if (t.includes('Planeswalker')) return 'Planeswalkers';
    if (t.includes('Instant')) return 'Instants';
    if (t.includes('Sorcery')) return 'Sorceries';
    if (t.includes('Artifact')) return 'Artifacts';
    if (t.includes('Enchantment')) return 'Enchantments';
    return 'Other';
  }

  function deckColumnsHtml(cards, dk) {
    const buckets = {};
    for (const c of cards) (buckets[bucketOf(c.n)] ||= []).push(c);
    const order = ['Creatures', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Planeswalkers', 'Lands', 'Basics', 'Other'];
    let cols = '';
    for (const b of order) {
      if (!buckets[b]) continue;
      const list = buckets[b].sort((a, x) => ((Store.card(a.n) || {}).mv || 0) - ((Store.card(x.n) || {}).mv || 0));
      const count = list.reduce((s, c) => s + c.q, 0);
      let rowsH = '';
      for (const c of list) {
        const f = Store.card(c.n);
        const sid = c.sid || Store.sidFor(c.n);
        const price = Store.cardValue(c.n, sid) * c.q;
        rowsH += '<div class="d-row src-' + c.src + '" draggable="true" data-card="' + esc(c.n) + '" data-sid="' + (sid || '') + '" data-hover-sid="' + (sid || '') + '">' +
          '<span class="d-q">' + c.q + '</span><span class="d-n">' + esc(c.n) + '</span>' +
          (c.src === 'buy' ? '<span class="badge buy">buy</span>' : '') +
          (c.src === 'moved' ? '<span class="badge moved">moved</span>' : '') +
          '<span class="d-p">' + money(price) + '</span></div>';
      }
      cols += '<div class="d-col"><div class="d-col-h">' + b + ' <span class="dim">' + count + '</span></div>' + rowsH + '</div>';
    }
    return cols;
  }

  function viewDeck(dk) {
    const d = Store.state.decks[dk];
    if (!d) return '<p>Unknown deck.</p>';
    const cards = Store.deckCards(dk);
    const total = cards.reduce((s, c) => s + c.q, 0);
    const value = Store.deckTotal(dk);
    const cmd = d.cards.find((c) => c.src === 'commander');
    const buys = cards.filter((c) => c.src === 'buy');
    const buyTotal = buys.reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0);

    const others = Object.entries(Store.state.decks).filter(([k]) => k !== dk);
    const dropTargets = others.map(([k, od]) =>
      '<div class="drop-target" data-drop="' + k + '">' + esc(od.name.split(',')[0]) + '</div>').join('') +
      '<div class="drop-target" data-drop="extras">Extras</div>';

    return '<div class="deck-head">' +
      cardImgHtml(d.name, cmd && cmd.sid, 'deck-art') +
      '<div class="deck-info"><h1 class="h-grad">' + esc(d.name) + '</h1>' +
      '<div class="tile-sub">' + esc(d.sub) + ' ' + pips(d.ci) + '</div>' +
      '<div class="deck-stats"><span>' + total + ' cards</span><span>' + money(value) + '</span>' +
      (buys.length ? '<span class="badge buy">' + buys.length + ' to buy, ' + money(buyTotal) + '</span>' : '') +
      (d.gcs && d.gcs.length ? '<span class="badge gc">GC: ' + d.gcs.join(', ') + '</span>' : '') +
      '</div></div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>' +
      '<div class="drop-bar"><span class="dim">Drag a card onto a deck to move it:</span>' + dropTargets + '</div>' +
      '<div class="deck-cols">' + deckColumnsHtml(cards, dk) + '</div>';
  }

  function viewMoves() {
    const ms = Store.state.moves;
    if (!ms.length) return '<h2 class="h-grad">Moves</h2><p class="dim">No pending moves. Drag cards between decks to plan physical changes.</p>';
    let rows = '';
    for (const m of ms) {
      rows += '<div class="move-row" data-hover-sid="' + (m.sid || '') + '"><span>' + esc(m.n) + '</span>' +
        '<span class="dim">' + esc(m.from) + ' to ' + esc(m.to) + '</span>' +
        '<button class="btn small" data-unmove="' + m.id + '">undo</button></div>';
    }
    return '<h2 class="h-grad">Moves, your physical sorting checklist</h2>' +
      '<p class="dim">These are planned moves stored in your browser. Sort the paper cards, then clear the list.</p>' +
      rows + '<button class="btn" id="clear-moves">Clear all</button>';
  }

  function viewImport() {
    const sessions = Store.state.sessions;
    let sess = sessions.length ? '<h3>Saved decks</h3>' : '';
    for (const s of sessions) {
      const v = s.cards.reduce((t, c) => t + Store.cardValue(c.n, c.sid) * c.q, 0);
      sess += '<div class="sess-row"><a href="#/session/' + s.id + '">' + esc(s.name) + '</a>' +
        '<span class="dim">' + s.cards.reduce((t, c) => t + c.q, 0) + ' cards, ' + money(v) + '</span>' +
        '<button class="btn small" data-delsess="' + s.id + '">delete</button></div>';
    }
    return '<h2 class="h-grad">Import a deck</h2>' +
      '<p class="dim">Paste a decklist, one card per line, like: 1 Sol Ring. Works for anyone: prices and images load live from Scryfall and the deck saves to this browser. Use Backup to move it between devices.</p>' +
      '<textarea id="imp-text" rows="12" placeholder="1 Atraxa, Grand Unifier&#10;1 Sol Ring&#10;..."></textarea>' +
      '<div class="row"><input id="imp-name" placeholder="Deck name"><button class="btn primary" id="imp-go">Import</button></div>' +
      '<div id="imp-status"></div>' + sess;
  }

  function viewSession(id) {
    const s = Store.state.sessions.find((x) => x.id === id);
    if (!s) return '<p>Session not found.</p>';
    const cards = s.cards.map((c) => ({ ...c, src: 'session' }));
    const value = cards.reduce((t, c) => t + Store.cardValue(c.n, c.sid) * c.q, 0);
    return '<div class="deck-head"><div class="deck-info"><h1 class="h-grad">' + esc(s.name) + '</h1>' +
      '<div class="deck-stats"><span>' + cards.reduce((t, c) => t + c.q, 0) + ' cards</span><span>' + money(value) + '</span></div></div>' +
      '<div class="deck-charts">' + curveChart(cards) + pipDonut(cards) + '</div></div>' +
      '<div class="deck-cols">' + deckColumnsHtml(cards, null) + '</div>';
  }

  // ---------- interactions ----------
  function wire(root, route, params) {
    // collection filters
    const search = $('#col-search', root);
    if (search) {
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => App.go('#/collection', { ...params, q: search.value }), 250);
      });
      $$('select[data-filter]', root).forEach((sel) => {
        sel.addEventListener('change', () => {
          App.go('#/collection', { ...params, q: $('#col-search', root).value, [sel.getAttribute('data-filter')]: sel.value });
        });
      });
    }

    // drag and drop
    $$('[draggable="true"]', root).forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragCard = { n: el.getAttribute('data-card'), sid: el.getAttribute('data-sid'), from: route.startsWith('#/deck/') ? route.split('/')[2] : 'extras' };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
    $$('.drop-target', root).forEach((el) => {
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        if (!dragCard) return;
        Store.addMove(dragCard.n, dragCard.from, el.getAttribute('data-drop'));
        toast(dragCard.n + ' moved to ' + el.getAttribute('data-drop') + '. See Moves for your sorting checklist.');
        App.refresh();
      });
    });

    // moves
    $$('[data-unmove]', root).forEach((b) => b.addEventListener('click', () => { Store.removeMove(b.getAttribute('data-unmove')); App.refresh(); }));
    const cm = $('#clear-moves', root);
    if (cm) cm.addEventListener('click', () => { Store.clearMoves(); App.refresh(); });

    // import
    const go = $('#imp-go', root);
    if (go) go.addEventListener('click', async () => {
      const text = $('#imp-text', root).value;
      const name = $('#imp-name', root).value.trim() || 'Imported deck';
      const status = $('#imp-status', root);
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const cards = [];
      for (const l of lines) {
        const m = l.match(/^(\d+)x?\s+(.+)$/) || l.match(/^(.+)$/);
        if (!m) continue;
        const q = m[2] ? parseInt(m[1], 10) : 1;
        const n = (m[2] || m[1]).replace(/\s*\((.*?)\)\s*[\w-]*\s*$/, '').trim();
        if (n) cards.push({ n, q });
      }
      if (!cards.length) { status.textContent = 'Nothing to import.'; return; }
      status.textContent = 'Resolving ' + cards.length + ' cards from Scryfall...';
      const need = cards.filter((c) => !Store.sidFor(c.n));
      if (need.length) {
        const res = await Scry.resolveNames(need.map((c) => c.n), (d, t) => { status.textContent = 'Resolving ' + d + ' of ' + t + '...'; });
        Store.cacheResolved(res.found);
        if (res.missing.length) status.textContent = 'Not found: ' + res.missing.join(', ');
      }
      for (const c of cards) {
        const r = Store.state.resolved[c.n.toLowerCase()];
        c.sid = Store.sidFor(c.n) || (r ? r.sid : '');
      }
      const s = Store.saveSession(name, cards);
      toast('Imported ' + name);
      location.hash = '#/session/' + s.id;
    });
    $$('[data-delsess]', root).forEach((b) => b.addEventListener('click', () => { Store.deleteSession(b.getAttribute('data-delsess')); App.refresh(); }));

    // card modal
    $$('.c-card .card-img, .tile-art', root).forEach((el) => {
      el.addEventListener('click', async () => {
        const n = el.getAttribute('data-name');
        openModal(n);
      });
    });
  }

  async function openModal(name) {
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
    if (!c) { box.textContent = 'Could not load card details.'; return; }
    const decksIn = Store.deckOf[Store.norm(name)] || [];
    const owned = Store.byName[Store.norm(name)];
    box.innerHTML =
      '<div class="modal-line">' + esc(c.type_line || '') + '</div>' +
      '<div class="modal-oracle">' + esc(c.oracle_text || (c.card_faces ? c.card_faces.map((f) => f.oracle_text).join('\n//\n') : '')) + '</div>' +
      '<div class="modal-prices">' +
      (c.prices && c.prices.usd ? '<span>Normal ' + money(parseFloat(c.prices.usd)) + '</span>' : '') +
      (c.prices && c.prices.usd_foil ? '<span>Foil ' + money(parseFloat(c.prices.usd_foil)) + '</span>' : '') + '</div>' +
      (owned ? '<div class="modal-line">You own ' + owned.qty + '</div>' : '<div class="modal-line">Not in your collection</div>') +
      (decksIn.length ? '<div class="modal-line">In decks: ' + decksIn.join(', ') + '</div>' : '');
  }

  async function refreshPrices(btn) {
    const ids = Store.uniqueSids();
    btn.disabled = true;
    const bar = $('#price-progress');
    bar.style.display = 'block';
    try {
      const map = await Scry.pricesByIds(ids, (d, t) => {
        bar.firstElementChild.style.width = Math.round((d / t) * 100) + '%';
        btn.textContent = 'Refreshing ' + d + ' / ' + t;
      });
      Store.applyFreshPrices(map);
      toast('Prices refreshed for ' + Object.keys(map).length + ' printings.');
    } catch (e) {
      toast('Price refresh hit an error; partial data kept.');
    }
    btn.disabled = false;
    btn.textContent = 'Refresh prices';
    bar.style.display = 'none';
    App.refresh();
  }

  return { viewVault, viewCollection, viewDeck, viewMoves, viewImport, viewSession, wire, hoverPreview, refreshPrices, toast };
})();
