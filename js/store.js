// Aether Vault: state, persistence, and the data model.
// Baked data: window.VAULT_COLLECTION (rows), window.VAULT_CARDS (card facts), window.VAULT_DECKS.
// Local layer: price map + snapshots, card moves between decks, imported deck sessions.
// Everything user-generated lives in localStorage and can be exported or imported as one JSON file.

const Store = (() => {
  const LS = {
    prices: 'av_prices',       // { sid: {usd, usd_foil, usd_etched}, _ts }
    prev: 'av_prices_prev',    // previous full price map for movers
    snapshots: 'av_snapshots', // [{date, total, decks:{key:total}}]
    moves: 'av_moves',         // [{id, n, sid, from, to, ts}]
    sessions: 'av_sessions',   // [{id, name, cards:[{n,q,sid}], created}]
    resolved: 'av_resolved',   // { lowername: {sid,name,t,mc,ci,mv,usd,usd_foil} }
  };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('storage full', e); }
  }

  const state = {
    rows: window.VAULT_COLLECTION || [],
    cards: window.VAULT_CARDS || {},
    decks: window.VAULT_DECKS || {},
    prices: load(LS.prices, {}),
    prev: load(LS.prev, {}),
    snapshots: load(LS.snapshots, []),
    moves: load(LS.moves, []),
    sessions: load(LS.sessions, []),
    resolved: load(LS.resolved, {}),
  };

  // ---------- indexes ----------
  const byName = {};       // norm -> {name, qty, rows:[i], sid}
  const sidByName = {};
  state.rows.forEach((r, i) => {
    const k = norm(r.n);
    byName[k] ||= { name: r.n, qty: 0, rows: [], sid: r.sid };
    byName[k].qty += r.q;
    byName[k].rows.push(i);
    if (!byName[k].sid && r.sid) byName[k].sid = r.sid;
    sidByName[k] ||= r.sid;
  });

  const deckOf = {}; // norm -> [deckKey]
  for (const [dk, d] of Object.entries(state.decks)) {
    for (const c of d.cards) {
      const k = norm(c.n);
      deckOf[k] ||= [];
      if (!deckOf[k].includes(dk)) deckOf[k].push(dk);
    }
  }

  function card(n) { return state.cards[norm(n)] || null; }
  function sidFor(n) {
    const k = norm(n);
    if (sidByName[k]) return sidByName[k];
    const res = state.resolved[n.toLowerCase()] || state.resolved[k];
    return res ? res.sid : '';
  }

  // ---------- prices ----------
  function priceEntry(sid) { return state.prices[sid] || null; }

  function rowValue(r) {
    const p = priceEntry(r.sid);
    if (p) {
      if (r.f === 'foil') return (p.usd_foil ?? p.usd ?? 0) * r.q;
      if (r.f === 'etched') return (p.usd_etched ?? p.usd_foil ?? p.usd ?? 0) * r.q;
      return (p.usd ?? p.usd_foil ?? 0) * r.q;
    }
    const c = card(r.n);
    return c && c.usd ? c.usd * r.q : 0;
  }

  function cardValue(n, sid) {
    const p = sid ? priceEntry(sid) : null;
    if (p) return p.usd ?? p.usd_foil ?? 0;
    const res = state.resolved[n.toLowerCase()];
    if (res && (res.usd != null || res.usd_foil != null)) return res.usd ?? res.usd_foil ?? 0;
    const c = card(n);
    return c && c.usd ? c.usd : 0;
  }

  function collectionTotal() { return state.rows.reduce((s, r) => s + rowValue(r), 0); }

  function deckCards(dk) {
    // baked entries adjusted by moves
    const d = state.decks[dk];
    if (!d) return [];
    const list = d.cards.map((c) => ({ ...c }));
    for (const m of state.moves) {
      if (m.from === dk) {
        const i = list.findIndex((c) => norm(c.n) === norm(m.n) && c.src !== 'commander');
        if (i >= 0) { list[i].q -= 1; if (list[i].q <= 0) list.splice(i, 1); }
      }
      if (m.to === dk) {
        const i = list.findIndex((c) => norm(c.n) === norm(m.n));
        if (i >= 0) list[i].q += 1;
        else list.push({ n: m.n, q: 1, src: 'moved', sid: m.sid || sidFor(m.n) });
      }
    }
    return list;
  }

  function deckTotal(dk) {
    return deckCards(dk).reduce((s, c) => s + cardValue(c.n, c.sid || sidFor(c.n)) * c.q, 0);
  }

  function priceAge() {
    const ts = state.prices._ts;
    if (!ts) return null;
    return (Date.now() - ts) / 36e5; // hours
  }

  function applyFreshPrices(map) {
    state.prev = { ...state.prices };
    delete state.prev._ts;
    const next = { ...map, _ts: Date.now() };
    state.prices = next;
    save(LS.prev, state.prev);
    save(LS.prices, state.prices);
    // snapshot
    const snap = {
      date: new Date().toISOString().slice(0, 10),
      total: Math.round(collectionTotal() * 100) / 100,
      decks: {},
    };
    for (const dk of Object.keys(state.decks)) snap.decks[dk] = Math.round(deckTotal(dk) * 100) / 100;
    const snaps = state.snapshots.filter((s) => s.date !== snap.date);
    snaps.push(snap);
    state.snapshots = snaps.slice(-90);
    save(LS.snapshots, state.snapshots);
  }

  function movers(limit) {
    const out = [];
    if (!Object.keys(state.prev).length) return out;
    const seen = new Set();
    for (const r of state.rows) {
      if (!r.sid || seen.has(r.sid)) continue;
      seen.add(r.sid);
      const a = state.prev[r.sid], b = state.prices[r.sid];
      if (!a || !b) continue;
      const pa = r.f ? (a.usd_foil ?? a.usd) : (a.usd ?? a.usd_foil);
      const pb = r.f ? (b.usd_foil ?? b.usd) : (b.usd ?? b.usd_foil);
      if (pa == null || pb == null) continue;
      const d = pb - pa;
      if (Math.abs(d) < 0.01) continue;
      out.push({ n: r.n, sid: r.sid, from: pa, to: pb, delta: d });
    }
    out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return out.slice(0, limit || 12);
  }

  // ---------- moves ----------
  function addMove(n, from, to) {
    if (from === to) return;
    state.moves.push({ id: 'm' + Date.now() + Math.floor(Math.random() * 999), n, sid: sidFor(n), from, to, ts: Date.now() });
    save(LS.moves, state.moves);
  }
  function removeMove(id) {
    state.moves = state.moves.filter((m) => m.id !== id);
    save(LS.moves, state.moves);
  }
  function clearMoves() { state.moves = []; save(LS.moves, state.moves); }

  // ---------- sessions (imported decks) ----------
  function saveSession(name, cards) {
    const s = { id: 's' + Date.now(), name, cards, created: new Date().toISOString() };
    state.sessions.push(s);
    save(LS.sessions, state.sessions);
    return s;
  }
  function deleteSession(id) {
    state.sessions = state.sessions.filter((s) => s.id !== id);
    save(LS.sessions, state.sessions);
  }

  function cacheResolved(found) {
    Object.assign(state.resolved, found);
    save(LS.resolved, state.resolved);
  }

  // ---------- backup ----------
  function exportBackup() {
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(),
      app: 'aether-vault',
      prices: state.prices, prev: state.prev, snapshots: state.snapshots,
      moves: state.moves, sessions: state.sessions, resolved: state.resolved,
    }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aether-vault-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  }
  function importBackup(obj) {
    if (!obj || obj.app !== 'aether-vault') throw new Error('Not an Aether Vault backup file');
    state.prices = obj.prices || {}; save(LS.prices, state.prices);
    state.prev = obj.prev || {}; save(LS.prev, state.prev);
    state.snapshots = obj.snapshots || []; save(LS.snapshots, state.snapshots);
    state.moves = obj.moves || []; save(LS.moves, state.moves);
    state.sessions = obj.sessions || []; save(LS.sessions, state.sessions);
    state.resolved = obj.resolved || {}; save(LS.resolved, state.resolved);
  }

  function uniqueSids() {
    const s = new Set();
    for (const r of state.rows) if (r.sid) s.add(r.sid);
    for (const d of Object.values(state.decks)) for (const c of d.cards) if (c.sid) s.add(c.sid);
    return [...s];
  }

  return {
    state, byName, deckOf, norm, card, sidFor,
    rowValue, cardValue, collectionTotal, deckCards, deckTotal,
    priceAge, applyFreshPrices, movers,
    addMove, removeMove, clearMoves,
    saveSession, deleteSession, cacheResolved,
    exportBackup, importBackup, uniqueSids,
  };
})();
