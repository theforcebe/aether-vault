// Aether Vault: state, persistence, data model. v3.
// The app is a neutral tool by default: no collection, no decks until the visitor
// uploads a ManaBox export, imports lists, or runs the one-time built-in vault import.
// Baked files (VAULT_COLLECTION / VAULT_DECKS) act only as that importable seed.
// VAULT_CARDS stays as a general card-facts dictionary for charts and suggestions.
// Everything user-generated lives in localStorage and exports as one backup file.

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
    lastbackup: 'av_lastbackup',
    seeded: 'av_seeded',
    oracle: 'av_oracle',
    baseline: 'av_baseline',
  };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('storage', e); }
  }

  const state = {
    cards: window.VAULT_CARDS || {},
    seedRows: window.VAULT_COLLECTION || [],
    seedDecks: window.VAULT_DECKS || {},
    prices: load(LS.prices, {}),
    prev: load(LS.prev, {}),
    snapshots: load(LS.snapshots, []),
    moves: load(LS.moves, []),
    sessions: load(LS.sessions, []),
    resolved: load(LS.resolved, {}),
    userdecks: load(LS.userdecks, []),
    mycollection: load(LS.mycollection, null),
    lastbackup: load(LS.lastbackup, null),
    seeded: load(LS.seeded, false),
    baseline: load(LS.baseline, {}),
    dirty: 0, // session mutation counter since load
  };

  function touch() { state.dirty++; }

  // ---------- collection ----------
  function rows() { return state.mycollection ? state.mycollection.rows : []; }
  function hasCollection() { return !!state.mycollection; }
  function collectionLabel() { return state.mycollection ? state.mycollection.label : 'No collection loaded'; }

  let byName = {};
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
  buildIndexes();

  function deckOf() {
    const map = {};
    for (const d of state.userdecks) {
      for (const c of d.cards) {
        const k = norm(c.n);
        map[k] ||= [];
        if (!map[k].includes(d.name)) map[k].push(d.name);
      }
    }
    return map;
  }

  function card(n) { return state.cards[norm(n)] || null; }
  function sidFor(n) {
    const k = norm(n);
    const c = state.cards[k];
    if (c && c.sid) return c.sid;
    const own = byName[k];
    if (own && own.sid) return own.sid;
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

  // whole-collection movement: every card's change vs its first-seen price,
  // quantity-weighted and summed. Rows without a baseline yet are excluded so
  // newly added cards do not read as gains.
  function collectionTicker() {
    let base = 0, cur = 0;
    for (const r of rows()) {
      const key = (r.sid || norm(r.n)) + '|' + (r.f || '');
      const b = state.baseline[key];
      const c = unitPrice(r.n, r.sid, r.f);
      if (b == null || !c) continue;
      base += b * r.q;
      cur += c * r.q;
    }
    const d = cur - base;
    if (base <= 0 || Math.abs(d) < 0.01) return null;
    return { d, pct: (d / base) * 100 };
  }

  // Collector page: printing-agnostic. A name you own anywhere counts toward
  // every set that card appears in; the game is Magic's distinct cards, not
  // specific printings. Needs the baked per-set name lists (setcards.js).
  // Two collector games:
  //   'cards'  - printing-agnostic: a name owned in ANY printing counts toward
  //              every set that card appears in (the distinct-cards chase)
  //   'prints' - strict: this exact printing, matched by set + collector
  //              number from the ManaBox rows (the 50,000+ chase)
  let setProgressCache = {};
  function setProgress(mode) {
    mode = mode === 'prints' ? 'prints' : 'cards';
    const S = typeof window !== 'undefined' && window.VAULT_SETS;
    if (!S) return null;
    const hit = setProgressCache[mode];
    if (hit && hit.rowsRef === state.mycollection) return hit.value;
    let value;
    if (mode === 'cards') {
      const SC = typeof window !== 'undefined' && window.VAULT_SETCARDS;
      if (!SC) return null;
      const ownedNames = new Set();
      for (const r of rows()) ownedNames.add(norm(r.n));
      // front faces of double-faced cards match their full "A // B" names
      const ownedIdx = new Set();
      for (let i = 0; i < SC.names.length; i++) {
        const full = SC.names[i];
        if (ownedNames.has(norm(full)) || (full.includes(' // ') && ownedNames.has(norm(full.split(' // ')[0])))) ownedIdx.add(i);
      }
      const out = [];
      for (const s of S.sets) {
        const list = SC.sets[s.c];
        if (!list) continue;
        let owned = 0;
        for (const idx of list) if (ownedIdx.has(idx)) owned++;
        if (!owned) continue;
        out.push({ ...s, total: list.length, owned, pct: Math.min(1, owned / list.length) });
      }
      out.sort((a, b) => b.pct - a.pct || b.owned - a.owned);
      value = { sets: out, uniqueOwned: ownedIdx.size, uniqueTotal: SC.names.length, mode };
    } else {
      const byCn = {};
      const allPrints = new Set();
      for (const r of rows()) {
        if (!r.s) continue;
        const key = r.cn ? String(r.cn) : 'n:' + norm(r.n);
        (byCn[r.s] ||= new Set()).add(key);
        allPrints.add(r.s + '|' + key);
      }
      const out = [];
      let totalPrints = 0;
      for (const s of S.sets) {
        const denom = s.p || s.total;
        totalPrints += denom;
        const owned = byCn[s.c] ? Math.min(byCn[s.c].size, denom) : 0;
        if (!owned) continue;
        out.push({ ...s, total: denom, owned, pct: Math.min(1, owned / denom) });
      }
      out.sort((a, b) => b.pct - a.pct || b.owned - a.owned);
      value = { sets: out, uniqueOwned: allPrints.size, uniqueTotal: totalPrints, mode };
    }
    setProgressCache[mode] = { rowsRef: state.mycollection, value };
    return value;
  }

  // is this exact card name owned in any printing?
  function ownsName(fullName) {
    const k = norm(fullName);
    if (byName[k] && byName[k].qty > 0) return true;
    if (fullName.includes(' // ')) {
      const front = norm(fullName.split(' // ')[0]);
      return !!(byName[front] && byName[front].qty > 0);
    }
    return false;
  }

  function setTier(owned, total) {
    const pct = total > 0 ? owned / total : 0;
    if (pct >= 1) return { name: 'Set Master', cls: 'gold' };
    if (pct >= 0.9) return { name: 'Completionist', cls: 'gold' };
    if (pct >= 0.75) return { name: 'Archivist', cls: 'own' };
    if (pct >= 0.5) return { name: 'Curator', cls: 'own' };
    if (pct >= 0.25) return { name: 'Collector', cls: '' };
    if (pct >= 0.1 || owned >= 10) return { name: 'Scout', cls: '' };
    return { name: 'Dabbler', cls: 'dim' };
  }

  // the next rung on the ladder for a set, and how many cards away it is
  const TIER_LADDER = [
    { pct: 0.1, name: 'Scout' }, { pct: 0.25, name: 'Collector' }, { pct: 0.5, name: 'Curator' },
    { pct: 0.75, name: 'Archivist' }, { pct: 0.9, name: 'Completionist' }, { pct: 1, name: 'Set Master' },
  ];
  function nextTier(owned, total) {
    if (total <= 0) return null;
    for (const t of TIER_LADDER) {
      const needAt = Math.ceil(t.pct * total);
      if (owned < needAt) return { name: t.name, need: needAt - owned };
    }
    return null; // mastered
  }

  // the headline title for a whole collection; shared by the Collector page
  // and leaderboard entries
  function collectorTitle(prog) {
    const mastered = prog.sets.filter((s) => s.pct >= 1).length;
    const near = prog.sets.filter((s) => s.pct >= 0.9).length;
    const half = prog.sets.filter((s) => s.pct >= 0.5).length;
    if (mastered >= 3) return 'Master of ' + mastered + ' Sets';
    if (mastered >= 1) return 'Set Master';
    if (near >= 1) return 'Completionist';
    if (half >= 3) return 'Grand Curator';
    if (half >= 1) return 'Curator';
    if (prog.sets.length >= 10) return 'Wide-Ranging Collector';
    if (prog.sets.length >= 3) return 'Collector';
    return 'Apprentice Collector';
  }
  function priceAge() { const ts = state.prices._ts; return ts ? (Date.now() - ts) / 36e5 : null; }

  // ---------- price baseline (first price the app ever saw for a printing+finish) ----------
  let baselineTimer = null;
  function saveBaselineSoon() {
    if (baselineTimer) return;
    baselineTimer = setTimeout(() => { baselineTimer = null; save(LS.baseline, state.baseline); }, 800);
  }
  // Returns {d, pct} of current vs first-seen price, locking the baseline on first sight.
  function ticker(n, sid, f) {
    const cur = unitPrice(n, sid, f);
    if (!cur) return null;
    const key = (sid || norm(n)) + '|' + (f || '');
    if (state.baseline[key] == null) {
      state.baseline[key] = Math.round(cur * 100) / 100;
      saveBaselineSoon();
      return null; // first sight: no movement yet
    }
    const base = state.baseline[key];
    const d = cur - base;
    if (Math.abs(d) < 0.005) return null;
    return { d, pct: base > 0 ? (d / base) * 100 : 0 };
  }

  // ---------- decks (all user decks) ----------
  function userDeck(id) { return state.userdecks.find((d) => d.id === id) || null; }
  function saveUserDecks() { save(LS.userdecks, state.userdecks); touch(); }
  function createUserDeck(name, cards, commander) {
    const d = {
      id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 99),
      name: name || 'New deck',
      commander: commander || '',
      cards: (cards || []).map((c) => ({ n: c.n, q: c.q, sid: c.sid || sidFor(c.n) })),
      created: new Date().toISOString(),
    };
    state.userdecks.push(d);
    saveUserDecks();
    return d;
  }
  function deleteUserDeck(id) { state.userdecks = state.userdecks.filter((d) => d.id !== id); saveUserDecks(); }
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
    return d ? d.cards.reduce((s, c) => s + cardValue(c.n, c.sid || sidFor(c.n)) * c.q, 0) : 0;
  }
  function deckView(id) {
    const d = userDeck(id);
    if (!d) return null;
    const cmd = d.cards.find((c) => norm(c.n) === norm(d.commander));
    const cmdFacts = d.commander ? card(d.commander) : null;
    return {
      id: d.id, name: d.name, commander: d.commander,
      commanderSid: cmd ? (cmd.sid || sidFor(cmd.n)) : '',
      ci: cmdFacts ? (cmdFacts.ci || '') : '',
      sub: d.commander ? 'Commander: ' + d.commander : 'No commander set',
      cards: d.cards.map((c) => ({ ...c, src: norm(c.n) === norm(d.commander) ? 'commander' : (c.src || 'user') })),
    };
  }
  function allDeckRefs() { return state.userdecks.map((d) => ({ key: d.id, name: d.name })); }

  // ---------- one-time seed import ----------
  function seedAvailable() { return state.seedRows.length > 0 && Object.keys(state.seedDecks).length > 0; }
  function importSeed() {
    if (!seedAvailable()) return { decks: 0, rows: 0 };
    let made = 0;
    for (const [, d] of Object.entries(state.seedDecks)) {
      const cmdEntry = d.cards.find((c) => c.src === 'commander');
      createUserDeck(d.name, d.cards.filter((c) => c.src !== 'commander').concat(cmdEntry ? [cmdEntry] : []),
        cmdEntry ? cmdEntry.n : '');
      made++;
    }
    state.mycollection = {
      label: "Keanen's ManaBox export",
      uploaded: new Date().toISOString(),
      rows: state.seedRows.map((r) => ({ ...r })),
    };
    save(LS.mycollection, state.mycollection);
    state.seeded = true;
    save(LS.seeded, true);
    buildIndexes();
    touch();
    return { decks: made, rows: state.mycollection.rows.length };
  }

  // ---------- ManaBox CSV ----------
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
    const header = (rowsArr[0] || []).map((h) => h.replace(/^﻿/, ''));
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    if (!('Name' in idx) || !('Quantity' in idx)) {
      throw new Error('That does not look like a ManaBox export. It needs at least Name and Quantity columns.');
    }
    const out = [];
    for (let i = 1; i < rowsArr.length; i++) {
      const r = rowsArr[i];
      if (!r || !r[idx['Name']]) continue;
      out.push({
        n: r[idx['Name']],
        b: idx['Binder Name'] != null ? (r[idx['Binder Name']] || 'Collection') : 'Collection',
        bt: idx['Binder Type'] != null ? (r[idx['Binder Type']] || 'binder') : 'binder',
        s: idx['Set code'] != null ? (r[idx['Set code']] || '').toUpperCase() : '',
        cn: idx['Collector number'] != null ? r[idx['Collector number']] : '',
        f: idx['Foil'] != null && r[idx['Foil']] && r[idx['Foil']] !== 'normal' ? r[idx['Foil']] : '',
        q: parseInt(r[idx['Quantity']], 10) || 1,
        sid: idx['Scryfall ID'] != null ? (r[idx['Scryfall ID']] || '') : '',
      });
    }
    if (!out.length) throw new Error('No card rows found in that file.');
    return out;
  }
  // Replaces the collection with a fresh ManaBox export. Decks are never
  // touched by this: they live separately and reference cards by name.
  // keepPurchased carries forward in-app "Purchased" rows the new export
  // cannot know about yet (bought here, not scanned into ManaBox).
  function uploadCollection(text, label, opts) {
    const parsed = parseManaBoxCsv(text);
    let kept = 0;
    if (opts && opts.keepPurchased && state.mycollection) {
      for (const r of state.mycollection.rows) {
        if (r.b === 'Purchased') { parsed.push(r); kept++; }
      }
    }
    state.mycollection = { label: label || 'My collection', uploaded: new Date().toISOString(), rows: parsed };
    save(LS.mycollection, state.mycollection);
    buildIndexes();
    touch();
    return { rows: parsed.length, kept };
  }
  function clearMyCollection() {
    state.mycollection = null;
    localStorage.removeItem(LS.mycollection);
    buildIndexes();
    touch();
  }
  // Mark cards as physically purchased: they join the collection under a Purchased binder.
  function addPurchased(cards) {
    if (!state.mycollection) {
      state.mycollection = { label: 'My collection', uploaded: new Date().toISOString(), rows: [] };
    }
    let added = 0;
    for (const c of cards) {
      state.mycollection.rows.push({
        n: c.n, b: 'Purchased', bt: 'binder', s: '', cn: '', f: '',
        q: c.q || 1, sid: c.sid || sidFor(c.n),
      });
      added += c.q || 1;
    }
    save(LS.mycollection, state.mycollection);
    buildIndexes();
    touch();
    return added;
  }
  // Deck cards not covered by the collection (basics excluded).
  function missingFromCollection(cards) {
    const BAS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);
    const out = [];
    for (const c of cards) {
      const nl = c.n.toLowerCase();
      if (BAS.has(nl) || nl.startsWith('snow-covered')) continue;
      const own = byName[norm(c.n)];
      const have = own ? own.qty : 0;
      if (have < c.q) out.push({ n: c.n, sid: c.sid || sidFor(c.n), q: c.q - have, unit: unitPrice(c.n, c.sid || sidFor(c.n), '') });
    }
    return out;
  }
  function binderSummary() {
    const map = {};
    for (const r of rows()) {
      map[r.b] ||= { name: r.b, type: r.bt || 'binder', rows: 0, cards: 0 };
      map[r.b].rows++;
      map[r.b].cards += r.q;
    }
    return Object.values(map).sort((a, b) => b.cards - a.cards);
  }
  function importBinderAsDeck(binderName) {
    const cs = [];
    for (const r of rows()) {
      if (r.b !== binderName) continue;
      const existing = cs.find((c) => norm(c.n) === norm(r.n));
      if (existing) existing.q += r.q;
      else cs.push({ n: r.n, q: r.q, sid: r.sid });
    }
    if (!cs.length) return null;
    return createUserDeck(binderName, cs, '');
  }

  // ---------- snapshots / movers / stats ----------
  const r2 = (v) => Math.round(v * 100) / 100;
  function applyFreshPrices(map) {
    state.prev = { ...state.prices };
    delete state.prev._ts;
    state.prices = { ...map, _ts: Date.now() };
    save(LS.prev, state.prev);
    save(LS.prices, state.prices);
    // lock baselines for printings we are pricing for the first time
    for (const [sid, p] of Object.entries(map)) {
      if (p.usd != null && state.baseline[sid + '|'] == null) state.baseline[sid + '|'] = p.usd;
      if (p.usd_foil != null && state.baseline[sid + '|foil'] == null) state.baseline[sid + '|foil'] = p.usd_foil;
      if (p.usd_etched != null && state.baseline[sid + '|etched'] == null) state.baseline[sid + '|etched'] = p.usd_etched;
    }
    save(LS.baseline, state.baseline);
    const snap = { date: new Date().toISOString().slice(0, 10), total: r2(collectionTotal()), decks: {} };
    for (const d of state.userdecks) snap.decks[d.id] = r2(userDeckTotal(d.id));
    state.snapshots = state.snapshots.filter((s) => s.date !== snap.date);
    state.snapshots.push(snap);
    state.snapshots = state.snapshots.slice(-180);
    save(LS.snapshots, state.snapshots);
    touch();
  }
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
    return Object.values(agg).map((a) => ({ ...a, total: a.unit * a.q }))
      .sort((a, b) => b.total - a.total).slice(0, limit || 10);
  }
  function distribution() {
    const type = {}; const color = {};
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
      for (const ch of (c.ci || 'C')) color[ch] = (color[ch] || 0) + r.q;
    }
    return { type, color };
  }

  // ---------- moves ----------
  function addMove(n, from, to) {
    if (from === to) return;
    state.moves.push({ id: 'm' + Date.now() + Math.floor(Math.random() * 999), n, sid: sidFor(n), from, to, ts: Date.now() });
    save(LS.moves, state.moves);
    touch();
  }
  function removeMove(id) { state.moves = state.moves.filter((m) => m.id !== id); save(LS.moves, state.moves); touch(); }
  function clearMoves() { state.moves = []; save(LS.moves, state.moves); touch(); }
  function deckNameFor(key) {
    if (key === 'collection') return 'Collection';
    const d = userDeck(key);
    return d ? d.name : key;
  }

  // ---------- sessions ----------
  function saveSession(name, cards) {
    const s = { id: 's' + Date.now(), name, cards, created: new Date().toISOString() };
    state.sessions.push(s);
    save(LS.sessions, state.sessions);
    touch();
    return s;
  }
  function deleteSession(id) { state.sessions = state.sessions.filter((s) => s.id !== id); save(LS.sessions, state.sessions); touch(); }

  function cacheResolved(found) { Object.assign(state.resolved, found); save(LS.resolved, state.resolved); }

  function missingSidNames() {
    const out = new Set();
    const check = (n, sid) => { if (!sid && !sidFor(n)) out.add(n); };
    for (const d of state.userdecks) for (const c of d.cards) check(c.n, c.sid);
    for (const s of state.sessions) for (const c of s.cards) check(c.n, c.sid);
    return [...out];
  }

  // ---------- backup ----------
  function exportBackup() {
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(), app: 'aether-vault', version: 3,
      prices: state.prices, prev: state.prev, snapshots: state.snapshots,
      moves: state.moves, sessions: state.sessions, resolved: state.resolved,
      userdecks: state.userdecks, mycollection: state.mycollection, seeded: state.seeded,
      baseline: state.baseline,
    })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aether-vault-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    state.lastbackup = Date.now();
    save(LS.lastbackup, state.lastbackup);
    state.dirty = 0;
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
    else localStorage.removeItem(LS.mycollection);
    state.seeded = !!obj.seeded; save(LS.seeded, state.seeded);
    state.baseline = obj.baseline || {}; save(LS.baseline, state.baseline);
    state.lastbackup = Date.now(); save(LS.lastbackup, state.lastbackup);
    state.dirty = 0;
    buildIndexes();
  }
  function clearLocalData() {
    for (const k of Object.values(LS)) localStorage.removeItem(k);
    location.reload();
  }
  function storageStats() {
    const labels = {
      prices: 'Live prices', prev: 'Previous prices (movers)', snapshots: 'Value snapshots',
      moves: 'Move checklist', sessions: 'Imported lists', resolved: 'Resolved card cache',
      userdecks: 'Your decks', mycollection: 'Your collection', oracle: 'Analyzer card cache',
      lastbackup: 'Backup timestamp', seeded: 'Seed flag', baseline: 'First-seen price baselines',
    };
    const out = [];
    for (const [short, key] of Object.entries(LS)) {
      const v = localStorage.getItem(key);
      if (v) out.push({ key, label: labels[short] || key, bytes: v.length });
    }
    return out;
  }
  function backupState() {
    return { last: state.lastbackup, dirty: state.dirty, hasData: !!(state.userdecks.length || state.mycollection || state.sessions.length) };
  }

  function uniqueSids() {
    const s = new Set();
    for (const r of rows()) if (r.sid) s.add(r.sid);
    for (const d of state.userdecks) for (const c of d.cards) if (c.sid) s.add(c.sid);
    return [...s];
  }

  return {
    state, norm, card, sidFor,
    rows, hasCollection, collectionLabel, get byName() { return byName; }, deckOf,
    unitPrice, rowValue, cardValue, collectionTotal, priceAge, ticker, collectionTicker, setProgress, setTier, nextTier, collectorTitle, ownsName,
    userDeck, createUserDeck, deleteUserDeck, renameUserDeck, setUserCommander,
    addToUserDeck, setUserQty, userDeckTotal, deckView, allDeckRefs, deckNameFor,
    seedAvailable, importSeed,
    parseManaBoxCsv, uploadCollection, clearMyCollection, binderSummary, importBinderAsDeck,
    addPurchased, missingFromCollection,
    applyFreshPrices, movers, topHoldings, distribution,
    addMove, removeMove, clearMoves,
    saveSession, deleteSession, cacheResolved, missingSidNames,
    exportBackup, importBackup, clearLocalData, storageStats, backupState, uniqueSids,
  };
})();
