// Aether Vault: state, persistence, data model.
// Baked data: VAULT_COLLECTION (site owner's rows), VAULT_CARDS (card facts), VAULT_DECKS (site decks).
// Local layer (per browser): uploaded collection, user-built decks, imported sessions,
// price map + daily snapshots, planned card moves, resolved card cache.
// Everything user-generated stays in localStorage and exports to one JSON backup file.

const Store = (() => {
  const LS = {
    prices: 'av_prices',
    prev: 'av_prices_prev',
    snapshots: 'av_snapshots',
    moves: 'av_moves',
    sessions: 'av_sessions',
    resolved: 'av_resolved',
    userdecks: 'av_userdecks',
    mycollection: 'av_mycollection',
    workspace: 'av_workspace', // 'site' | 'mine'
  };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('storage', e); }
  }

  const state = {
    baked: window.VAULT_COLLECTION || [],
    cards: window.VAULT_CARDS || {},
    decks: window.VAULT_DECKS || {},
    prices: load(LS.prices, {}),
    prev: load(LS.prev, {}),
    snapshots: load(LS.snapshots, []),
    moves: load(LS.moves, []),
    sessions: load(LS.sessions, []),
    resolved: load(LS.resolved, {}),
    userdecks: load(LS.userdecks, []),
    mycollection: load(LS.mycollection, null),
    workspace: load(LS.workspace, 'site'),
  };
  if (state.workspace === 'mine' && !state.mycollection) state.workspace = 'site';

  // ---------- collection (workspace aware) ----------
  function rows() {
    return state.workspace === 'mine' && state.mycollection ? state.mycollection.rows : state.baked;
  }
  function workspaceLabel() {
    if (state.workspace === 'mine') return state.mycollection ? state.mycollection.label : 'My collection';
    return "Keanen's collection";
  }
  function setWorkspace(ws) {
    state.workspace = ws;
    save(LS.workspace, ws);
    buildIndexes();
  }

  let byName = {};
  const sidBaked = {};
  function buildIndexes() {
    byName = {};
    for (const r of rows()) {
      const k = norm(r.n);
      byName[k] ||= { name: r.n, qty: 0, sid: r.sid, binders: new Set(), foil: false };
      byName[k].qty += r.q;
      byName[k].binders.add(r.b);
      if (r.f) byName[k].foil = true;
      if (!byName[k].sid && r.sid) byName[k].sid = r.sid;
    }
  }
  for (const r of state.baked) { const k = norm(r.n); if (!sidBaked[k] && r.sid) sidBaked[k] = r.sid; }
  buildIndexes();

  const deckOf = {}; // norm -> [site deck keys]
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
    const c = state.cards[k];
    if (c && c.sid) return c.sid;
    if (sidBaked[k]) return sidBaked[k];
    const res = state.resolved[n.toLowerCase()] || state.resolved[k];
    return res ? res.sid : '';
  }

  // ---------- prices ----------
  function priceEntry(sid) { return sid ? state.prices[sid] || null : null; }

  function unitPrice(n, sid, foil) {
    const p = priceEntry(sid);
    if (p) {
      if (foil === 'foil') return p.usd_foil ?? p.usd ?? 0;
      if (foil === 'etched') return p.usd_etched ?? p.usd_foil ?? p.usd ?? 0;
      return p.usd ?? p.usd_foil ?? 0;
    }
    const res = state.resolved[(n || '').toLowerCase()];
    if (res && (res.usd != null || res.usd_foil != null)) return (foil ? res.usd_foil ?? res.usd : res.usd ?? res.usd_foil) ?? 0;
    const c = card(n);
    return c && c.usd != null ? c.usd : 0;
  }

  function rowValue(r) { return unitPrice(r.n, r.sid, r.f) * r.q; }
  function cardValue(n, sid) { return unitPrice(n, sid, ''); }
  function collectionTotal() { return rows().reduce((s, r) => s + rowValue(r), 0); }

  function priceAge() {
    const ts = state.prices._ts;
    return ts ? (Date.now() - ts) / 36e5 : null;
  }

  // ---------- site decks with moves applied ----------
  function deckCards(dk) {
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

  // ---------- user decks ----------
  function userDeck(id) { return state.userdecks.find((d) => d.id === id) || null; }
  function saveUserDecks() { save(LS.userdecks, state.userdecks); }
  function createUserDeck(name, cards, commander) {
    const d = {
      id: 'u' + Date.now().toString(36),
      name: name || 'New deck',
      commander: commander || '',
      cards: (cards || []).map((c) => ({ n: c.n, q: c.q, sid: c.sid || sidFor(c.n) })),
      created: new Date().toISOString(),
    };
    state.userdecks.push(d);
    saveUserDecks();
    return d;
  }
  function deleteUserDeck(id) {
    state.userdecks = state.userdecks.filter((d) => d.id !== id);
    saveUserDecks();
  }
  function renameUserDeck(id, name) { const d = userDeck(id); if (d) { d.name = name; saveUserDecks(); } }
  function setUserCommander(id, n) { const d = userDeck(id); if (d) { d.commander = n; saveUserDecks(); } }
  function addToUserDeck(id, n, q) {
    const d = userDeck(id);
    if (!d) return;
    const i = d.cards.findIndex((c) => norm(c.n) === norm(n));
    if (i >= 0) d.cards[i].q += q || 1;
    else d.cards.push({ n, q: q || 1, sid: sidFor(n) });
    saveUserDecks();
  }
  function setUserQty(id, n, q) {
    const d = userDeck(id);
    if (!d) return;
    const i = d.cards.findIndex((c) => norm(c.n) === norm(n));
    if (i < 0) return;
    if (q <= 0) d.cards.splice(i, 1);
    else d.cards[i].q = q;
    saveUserDecks();
  }
  function userDeckTotal(id) {
    const d = userDeck(id);
    if (!d) return 0;
    return d.cards.reduce((s, c) => s + cardValue(c.n, c.sid || sidFor(c.n)) * c.q, 0);
  }

  // unified accessor: site key, or 'u:<id>'
  function deckView(key) {
    if (key.startsWith('u:')) {
      const d = userDeck(key.slice(2));
      if (!d) return null;
      const cmd = d.cards.find((c) => norm(c.n) === norm(d.commander));
      return {
        kind: 'user', key, id: d.id, name: d.name, sub: 'Custom deck', ci: '',
        commander: d.commander, commanderSid: cmd ? (cmd.sid || sidFor(cmd.n)) : '',
        cards: d.cards.map((c) => ({ ...c, src: norm(c.n) === norm(d.commander) ? 'commander' : 'user' })),
        gcs: [], editable: true,
      };
    }
    const d = state.decks[key];
    if (!d) return null;
    const cmdEntry = d.cards.find((c) => c.src === 'commander');
    return {
      kind: 'site', key, name: d.name, sub: d.sub, ci: d.ci,
      commander: cmdEntry ? cmdEntry.n : '', commanderSid: cmdEntry ? cmdEntry.sid : '',
      cards: deckCards(key), gcs: d.gcs || [], editable: false,
    };
  }
  function allDeckRefs() {
    const out = Object.keys(state.decks).map((k) => ({ key: k, name: state.decks[k].name, kind: 'site' }));
    for (const d of state.userdecks) out.push({ key: 'u:' + d.id, name: d.name, kind: 'user' });
    return out;
  }

  // ---------- snapshots / movers ----------
  function applyFreshPrices(map) {
    state.prev = { ...state.prices };
    delete state.prev._ts;
    state.prices = { ...map, _ts: Date.now() };
    save(LS.prev, state.prev);
    save(LS.prices, state.prices);
    const snap = { date: new Date().toISOString().slice(0, 10), total: r2(collectionTotal()), decks: {} };
    for (const dk of Object.keys(state.decks)) snap.decks[dk] = r2(deckTotal(dk));
    for (const d of state.userdecks) snap.decks['u:' + d.id] = r2(userDeckTotal(d.id));
    state.snapshots = state.snapshots.filter((s) => s.date !== snap.date);
    state.snapshots.push(snap);
    state.snapshots = state.snapshots.slice(-180);
    save(LS.snapshots, state.snapshots);
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  function movers(limit) {
    const out = [];
    if (!Object.keys(state.prev).length) return out;
    const seen = new Set();
    for (const r of rows()) {
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

  function topHoldings(limit) {
    const agg = {};
    for (const r of rows()) {
      const k = norm(r.n) + '|' + (r.f || '');
      agg[k] ||= { n: r.n, sid: r.sid, q: 0, f: r.f, unit: unitPrice(r.n, r.sid, r.f) };
      agg[k].q += r.q;
    }
    const list = Object.values(agg).map((a) => ({ ...a, total: a.unit * a.q }));
    list.sort((a, b) => b.total - a.total);
    return list.slice(0, limit || 10);
  }

  function distribution() {
    const type = {}; const color = {}; const rarity = {};
    for (const r of rows()) {
      const c = card(r.n);
      if (!c) continue;
      const t = c.t.includes('Land') ? 'Land'
        : c.t.includes('Creature') ? 'Creature'
        : c.t.includes('Instant') ? 'Instant'
        : c.t.includes('Sorcery') ? 'Sorcery'
        : c.t.includes('Artifact') ? 'Artifact'
        : c.t.includes('Enchantment') ? 'Enchantment'
        : c.t.includes('Planeswalker') ? 'Planeswalker' : 'Other';
      type[t] = (type[t] || 0) + r.q;
      const ci = c.ci || 'C';
      for (const ch of ci) color[ch] = (color[ch] || 0) + r.q;
      if (c.r) rarity[c.r] = (rarity[c.r] || 0) + r.q;
    }
    return { type, color, rarity };
  }

  // ---------- moves ----------
  function addMove(n, from, to) {
    if (from === to) return;
    state.moves.push({ id: 'm' + Date.now() + Math.floor(Math.random() * 999), n, sid: sidFor(n), from, to, ts: Date.now() });
    save(LS.moves, state.moves);
  }
  function removeMove(id) { state.moves = state.moves.filter((m) => m.id !== id); save(LS.moves, state.moves); }
  function clearMoves() { state.moves = []; save(LS.moves, state.moves); }

  // ---------- sessions ----------
  function saveSession(name, cards) {
    const s = { id: 's' + Date.now(), name, cards, created: new Date().toISOString() };
    state.sessions.push(s);
    save(LS.sessions, state.sessions);
    return s;
  }
  function deleteSession(id) { state.sessions = state.sessions.filter((s) => s.id !== id); save(LS.sessions, state.sessions); }

  function cacheResolved(found) {
    Object.assign(state.resolved, found);
    save(LS.resolved, state.resolved);
  }

  function missingSidNames() {
    const out = new Set();
    const check = (n, sid) => { if (!sid && !sidFor(n)) out.add(n); };
    for (const d of Object.values(state.decks)) for (const c of d.cards) check(c.n, c.sid);
    for (const d of state.userdecks) for (const c of d.cards) check(c.n, c.sid);
    for (const s of state.sessions) for (const c of s.cards) check(c.n, c.sid);
    return [...out];
  }

  // ---------- ManaBox CSV upload ----------
  function parseManaBoxCsv(text) {
    const rowsArr = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rowsArr.push(row); row = []; f = ''; }
      else if (ch !== '\r') f += ch;
    }
    if (f.length || row.length) { row.push(f); rowsArr.push(row); }
    const header = rowsArr[0] || [];
    const idx = Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ''), i]));
    if (!('Name' in idx) || !('Quantity' in idx)) throw new Error('That does not look like a ManaBox export (needs Name and Quantity columns).');
    const out = [];
    for (let i = 1; i < rowsArr.length; i++) {
      const r = rowsArr[i];
      if (!r || !r[idx['Name']]) continue;
      out.push({
        n: r[idx['Name']],
        b: idx['Binder Name'] != null ? r[idx['Binder Name']] : 'Collection',
        s: idx['Set code'] != null ? (r[idx['Set code']] || '').toUpperCase() : '',
        cn: idx['Collector number'] != null ? r[idx['Collector number']] : '',
        f: idx['Foil'] != null && r[idx['Foil']] !== 'normal' ? r[idx['Foil']] : '',
        q: parseInt(r[idx['Quantity']], 10) || 1,
        sid: idx['Scryfall ID'] != null ? r[idx['Scryfall ID']] : '',
      });
    }
    return out;
  }
  function uploadCollection(text, label) {
    const parsed = parseManaBoxCsv(text);
    state.mycollection = { label: label || 'My collection', uploaded: new Date().toISOString(), rows: parsed };
    save(LS.mycollection, state.mycollection);
    setWorkspace('mine');
    return parsed.length;
  }
  function clearMyCollection() {
    state.mycollection = null;
    localStorage.removeItem(LS.mycollection);
    setWorkspace('site');
  }

  // ---------- backup / stats ----------
  function exportBackup() {
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(), app: 'aether-vault', version: 2,
      prices: state.prices, prev: state.prev, snapshots: state.snapshots,
      moves: state.moves, sessions: state.sessions, resolved: state.resolved,
      userdecks: state.userdecks, mycollection: state.mycollection, workspace: state.workspace,
    })], { type: 'application/json' });
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
    state.userdecks = obj.userdecks || []; save(LS.userdecks, state.userdecks);
    state.mycollection = obj.mycollection || null;
    if (state.mycollection) save(LS.mycollection, state.mycollection);
    state.workspace = obj.workspace === 'mine' && state.mycollection ? 'mine' : 'site';
    save(LS.workspace, state.workspace);
    buildIndexes();
  }
  function clearLocalData() {
    for (const k of Object.values(LS)) localStorage.removeItem(k);
    location.reload();
  }
  function storageStats() {
    const out = [];
    for (const [label, key] of Object.entries(LS)) {
      const v = localStorage.getItem(key);
      if (v) out.push({ key, label, bytes: v.length });
    }
    return out;
  }

  function uniqueSids() {
    const s = new Set();
    for (const r of rows()) if (r.sid) s.add(r.sid);
    for (const d of Object.values(state.decks)) for (const c of d.cards) if (c.sid) s.add(c.sid);
    for (const d of state.userdecks) for (const c of d.cards) if (c.sid) s.add(c.sid);
    return [...s];
  }

  return {
    state, norm, card, sidFor,
    rows, workspaceLabel, setWorkspace, get byName() { return byName; }, deckOf,
    unitPrice, rowValue, cardValue, collectionTotal, priceAge,
    deckCards, deckTotal, deckView, allDeckRefs,
    userDeck, createUserDeck, deleteUserDeck, renameUserDeck, setUserCommander, addToUserDeck, setUserQty, userDeckTotal,
    applyFreshPrices, movers, topHoldings, distribution,
    addMove, removeMove, clearMoves,
    saveSession, deleteSession, cacheResolved, missingSidNames,
    parseManaBoxCsv, uploadCollection, clearMyCollection,
    exportBackup, importBackup, clearLocalData, storageStats, uniqueSids,
  };
})();
