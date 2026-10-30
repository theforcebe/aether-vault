/* Collection Workbench: pure, independently testable discovery and inventory model.
 * Effect tags aid browsing. They are never rules proofs or interchangeable-card claims. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./printings') : root.Printings);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkbenchCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (P) {
  'use strict';
  const key = s => String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const text = f => (f?.oracle_text || f?.o || (f?.card_faces || []).map(x => x.oracle_text || '').join('\n')).toLowerCase();
  const type = f => (f?.type_line || f?.t || '').toLowerCase();
  const mv = f => f?.cmc ?? f?.mv ?? null;
  const identity = f => Array.isArray(f?.color_identity) ? f.color_identity : [...(f?.ci || '')];
  const ROLES = [
    ['flicker', 'Flicker', '#6359b5', t => /exile/.test(t) && /return (?:it|them|that card|those cards|the exiled)/.test(t) && /battlefield/.test(t) && !/return.{0,120}transformed/.test(t) && !/when .{0,100} leaves(?: the battlefield)?[,.].{0,80}return/s.test(t)],
    ['etb', 'Enters triggers', '#6366a0', t => /(?:enters|enter) (?:the battlefield|under your control)|when .{1,70} enters[,.]/.test(t)],
    ['double-strike-team', 'Team double strike', '#aa6c35', t => /(?:creatures you control|attacking creatures|other creatures you control) (?:have|gain) double strike/.test(t)],
    ['double-strike', 'Double strike', '#b17842', t => /double strike/.test(t)],
    ['ramp', 'Mana & ramp', '#407e5b', (t, f) => !/land/.test(type(f)) && /add (?:\{|one mana|two mana|three mana|an amount|mana)|search your library.{0,150}land.{0,120}(?:battlefield)/s.test(t)],
    ['draw', 'Card draw', '#3977a8', t => /draw (?:a|an|one|two|three|four|five|that many|x|\d+) cards?/.test(t)],
    ['selection', 'Card selection', '#6084a7', t => /scry|surveil|look at the top|exile the top/.test(t)],
    ['removal', 'Targeted removal', '#b75d65', t => /(?:destroy|exile) target (?:creature|artifact|enchantment|nonland|permanent)|deals? \d+ damage to (?:any|target)/.test(t)],
    ['wipe', 'Board wipes', '#9c5368', t => /(?:destroy|exile) all|all creatures get -|damage to each creature/.test(t)],
    ['counter', 'Counterspells', '#5276be', t => /counter target (?:spell|activated|triggered)/.test(t)],
    ['protection', 'Protection', '#9a873d', t => /hexproof|indestructible|protection from|phase out|phases out/.test(t)],
    ['recursion', 'Graveyard return', '#8565a0', t => /return.{0,130}(?:graveyard).{0,100}(?:battlefield|hand)/s.test(t)],
    ['tokens', 'Token creation', '#4b927f', t => /create .{0,160}token/.test(t)],
    ['sacrifice', 'Sacrifice outlets', '#a56483', t => /sacrifice (?:a|another|an|x|any number of) .{0,85}:/.test(t)],
    ['death', 'Death payoffs', '#946b8c', t => /whenever .{0,120}(?:dies|die[,.])/.test(t)],
    ['lifegain', 'Life gain', '#a18c4b', t => /gain (?:\d+|x|that much|that many|one|two) life|lifelink/.test(t)],
    ['counters', '+1/+1 counters', '#5d9363', t => /\+1\/\+1 counter|proliferate/.test(t)],
    ['tutor', 'Tutors', '#928053', t => /search your library/.test(t)],
    ['combat', 'Combat & anthems', '#ad7048', t => /creatures you control get|additional combat|attacking creatures|whenever .{0,70} attacks/.test(t)],
    ['lands', 'Lands', '#7b8472', (t, f) => /\bland\b/.test(type(f))],
  ].map(([id, label, color, test]) => ({ id, label, color, test }));
  function roles(f) {
    const t = text(f).replace(/\([^)]*\)/g, ''), found = ROLES.filter(r => r.test(t, f)).map(r => r.id);
    // Exiling and returning your own creature is not a removal spell.
    return found.includes('flicker') ? found.filter(r => !['removal','wipe'].includes(r)) : found;
  }
  function effectView(f, preferred) {
    if (!f?.card_faces?.length) return f;
    const face = f.card_faces.find(x => roles(x).includes(preferred));
    if (!face) return f;
    const symbols = (face.mana_cost || '').match(/\{[^}]+\}/g) || [];
    const cost = symbols.reduce((sum,s) => { const parts=s.slice(1,-1).split('/'); return sum + Math.max(...parts.map(p=>/^\d+$/.test(p)?Number(p):/^[XYZ]$/.test(p)?0:1)); },0);
    return { ...f, ...face, name:f.name, faceName:face.name, cmc:face.cmc ?? cost, card_faces:undefined, color_identity:identity(f) };
  }
  function traits(f) {
    const t = text(f), r = roles(f), out = [];
    out.push(/instant/.test(type(f)) ? 'Instant' : /sorcery/.test(type(f)) ? 'Sorcery' : 'Permanent');
    if (r.includes('flicker')) {
      out.push(/next end step|beginning of the end step/.test(t) ? 'Delayed return' : /then return/.test(t) ? 'Immediate return' : 'Check return timing');
      out.push(/you control/.test(t) ? 'Your permanents' : 'Check controller restriction');
      if (/another/.test(t)) out.push('Another permanent');
      if (/target/.test(t)) out.push('Targets');
    }
    if (/until end of turn/.test(t)) out.push('Until end of turn');
    if (/activate only|only as a sorcery/.test(t)) out.push('Activation restriction');
    if (/whenever|at the beginning/.test(t)) out.push('Triggered');
    return out;
  }
  function parseDeck(input) {
    const entries = new Map(), ignored = [], errors = []; let zone = 'main';
    String(input).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
      let line = raw.trim(); if (!line) return;
      if (/^#|^\/\//.test(line)) {
        const section=line.replace(/^(?:#|\/\/)\s*/, '').replace(/:$/, '').trim();
        if (!/^(commanders?|command zone|deck|main|mainboard|maindeck|sideboard|maybeboard|considering|companion)$/i.test(section)) return;
        line=section;
      }
      const heading = line.replace(/^\[|\]$|:$/g, '').toLowerCase();
      if (/^(commander|commanders|command zone)$/.test(heading)) { zone = 'commander'; return; }
      if (/^(deck|main|mainboard|maindeck)$/.test(heading)) { zone = 'main'; return; }
      if (/^(sideboard|maybeboard|considering|companion)$/.test(heading)) { zone = 'sideboard'; return; }
      if (/^(about|name |format )/i.test(line)) { ignored.push({ line: index + 1, text: raw }); return; }
      let z = zone; if (/^SB:\s*/i.test(line)) { z = 'sideboard'; line = line.replace(/^SB:\s*/i, ''); }
      const m = line.match(/^(?:(\d+)x?\s+)?(.+?)(?:\s+\*CMDR\*)?$/i);
      if (!m) { errors.push('Line ' + (index + 1) + ': could not read card.'); return; }
      const q = m[1] ? Number(m[1]) : 1;
      let name = m[2].replace(/\s+\([a-z0-9]{2,8}\)\s+[a-z0-9★-]+(?:\s+\*[^*]+\*)?$/i, '').replace(/\s+\[[^\]]+\]$/, '').trim();
      if (/\*CMDR\*$/i.test(line)) z = 'commander';
      if (!name || !Number.isSafeInteger(q) || q < 1 || q > 1000 || /^[-+]?\d+(?:\.\d+)?\s/.test(name)) { errors.push('Line ' + (index + 1) + ': invalid name or quantity.'); return; }
      const k = z + ':' + key(name), prev = entries.get(k);
      if (prev) prev.q += q; else entries.set(k, { n: name, q, zone: z });
    });
    if (entries.size > 600) errors.push('Use at most 600 distinct entries.');
    return { cards: [...entries.values()], ignored, errors };
  }
  function inventory(snapshot, ledger, targetDeckId, facts = {}) {
    const byName = new Map(), aliases = new Map();
    Object.values(facts).forEach(f => { if (f?.name) { aliases.set(key(f.name), key(f.name)); (f.card_faces || []).forEach(face => aliases.set(key(face.name), key(f.name))); } });
    const canonical = n => aliases.get(key(n)) || key(n);
    const decks = ledger?.decks || [], free = new Set((ledger?.availableBinders || []).map(key));
    const accessible = decks.filter(d => d.id === targetDeckId);
    const ownBinders = new Set(accessible.filter(d => d.mode === 'binder').map(d => key(d.binder)));
    ownBinders.forEach(b => free.add(b));
    const eligible = row => !row.proxy && free.has(key(row.binder)) && (key(row.binderType) !== 'deck' || ownBinders.has(key(row.binder)));
    const get = n => { const k = canonical(n); if (!byName.has(k)) byName.set(k, { name: n, key: k, totalOwned: 0, available: 0, eligibleOwned: 0, reserved: 0, proxyQuantity: 0, usedInDecks: [], locations: [], records: [] }); return byName.get(k); };
    for (const row of snapshot?.records || []) {
      const c = get(row.name); c.records.push(row);
      if (row.proxy) c.proxyQuantity += row.quantity;
      else {
        c.totalOwned += row.quantity;
        if (free.has(key(row.binder)) && (key(row.binderType) !== 'deck' || ownBinders.has(key(row.binder)))) c.eligibleOwned += row.quantity;
      }
      let loc = c.locations.find(l => l.binder === row.binder);
      if (!loc) { loc = { binder: row.binder, quantity: 0, proxyQuantity: 0 }; c.locations.push(loc); }
      if (row.proxy) loc.proxyQuantity += row.quantity; else loc.quantity += row.quantity;
    }
    for (const d of decks) {
      const amounts = new Map();
      if (d.mode === 'binder') {
        for (const r of snapshot?.records || []) if (!r.proxy && key(r.binder) === key(d.binder)) amounts.set(canonical(r.name), (amounts.get(canonical(r.name)) || 0) + r.quantity);
      } else for (const c of d.cards || []) amounts.set(canonical(c.name), (amounts.get(canonical(c.name)) || 0) + c.quantity);
      amounts.forEach((quantity, k) => {
        const c = get(k); c.usedInDecks.push({ deckId: d.id, deckName: d.name, quantity, status: d.status || 'recorded', accessibleForPlan: d.id === targetDeckId });
        if (d.mode === 'list' && d.id !== targetDeckId) c.reserved += quantity;
      });
    }
    byName.forEach(c => { c.available = Math.max(0, c.eligibleOwned - c.reserved); c.copiesInOtherDecks = c.usedInDecks.filter(d => !d.accessibleForPlan).reduce((s, d) => s + d.quantity, 0); });
    return { byName, canonical, eligible, get: n => byName.get(canonical(n)) || { name: n, totalOwned: 0, available: 0, proxyQuantity: 0, copiesInOtherDecks: 0, usedInDecks: [], locations: [], records: [] } };
  }
  function coverage(cards, inv, includeSideboard = false) {
    const counts = new Map();
    for (const c of cards.filter(c => includeSideboard || c.zone !== 'sideboard')) { const k = inv.canonical(c.n); if (!counts.has(k)) counts.set(k, { ...c, q: 0 }); counts.get(k).q += c.q; }
    return [...counts.values()].map(c => { const own = inv.get(c.n); return { ...c, inventory: own, missing: Math.max(0, c.q - own.available), notOwned: Math.max(0, c.q - own.totalOwned), reuseMissing: Math.max(0, c.q - Math.min(own.totalOwned, own.available + own.copiesInOtherDecks)) }; });
  }
  function alternatives(f, catalog, ci) {
    const tags = roles(f).filter(x => !['lands', 'double-strike'].includes(x)), ownKey = key(f?.name);
    if (!tags.length) return [];
    const required = tags.includes('flicker') ? 'flicker' : tags.includes('double-strike-team') ? 'double-strike-team' : null;
    const base = effectView(f, required || tags[0]);
    const targetsOthers = x => /exile (?:up to .{0,20}target|another target|target|any number of|all (?:nontoken )?(?:creatures|permanents))/.test(text(x));
    return catalog.filter(c => c.fact && key(c.name) !== ownKey && c.own.totalOwned > 0 && (!ci || identity(c.fact).every(x => ci.includes(x))))
      .map(c => { const shared = roles(c.fact).filter(x => tags.includes(x)), effect = effectView(c.fact, required || shared[0]); return { ...c, fact:effect, baseEffect:base, shared, score: shared.length * 10 + (c.own.available > 0 ? 4 : 0) + (type(base).split(' — ')[0] === type(effect).split(' — ')[0] ? 2 : 0) - Math.abs((mv(base) || 0) - (mv(effect) || 0)) }; })
      .filter(c => c.shared.length && (!required || c.shared.includes(required)) && !(required === 'flicker' && targetsOthers(base) && !targetsOthers(c.fact)))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 12);
  }
  function comboPayload(deck, facts = {}) {
    const entries = zone => {const map=new Map();for(const c of deck.cards.filter(c=>(c.zone || 'main')===zone)){const name=facts[key(c.n)]?.name || c.n,k=key(name);if(map.has(k))map.get(k).quantity+=c.q;else map.set(k,{card:name,quantity:c.q});}return [...map.values()];};
    return {main:entries('main'),commanders:formatOf(deck)==='commander'?entries('commander'):[]};
  }
  function comboLink(deck, facts) {
    const payload=comboPayload(deck,facts), url=new URL('https://commanderspellbook.com/find-my-combos/');
    url.searchParams.set('decklist',payload.main.map(c=>c.quantity+' '+c.card).join('\n'));
    url.searchParams.set('commanders',payload.commanders.map(c=>c.quantity+' '+c.card).join('\n'));
    return url.href;
  }
  const formatOf = deck => deck.format || 'commander';
  function setFormat(deck, format) {
    deck.format = format;
    if (format !== 'commander') {
      // Preserve every copy when leaving Commander; merge duplicate zone entries.
      const merged = new Map();
      for (const c of deck.cards) {
        const zone = c.zone === 'commander' ? 'main' : c.zone || 'main', id = zone + ':' + key(c.n) + ':' + (c.printing ? P.key(c.printing) : 'unspecified');
        if (merged.has(id)) merged.get(id).q += c.q;
        else merged.set(id, { ...c, zone });
      }
      deck.cards = [...merged.values()];
    }
    return deck;
  }
  function fromStoredDeck(d) {
    return { name: d.name, format: formatOf(d), cards: [
      ...d.cards.map(c => ({ ...(c.printing ? {printing:P.selection(c.printing)} : {}), n:c.n, q:c.q, zone:formatOf(d)==='commander' && key(c.n)===key(d.commander) ? 'commander' : 'main' })),
      ...(d.sideboard || []).map(c => ({ ...(c.printing ? {printing:P.selection(c.printing)} : {}), n:c.n, q:c.q, zone:'sideboard' }))
    ] };
  }
  function deckText(deck) {
    return ['commander','main','sideboard'].map(zone => {
      const cards=deck.cards.filter(c=>(c.zone || 'main')===zone);
      return cards.length ? ({commander:'Commander',main:'Deck',sideboard:'Sideboard'})[zone]+'\n'+cards.map(c=>c.q+' '+c.n).join('\n') : '';
    }).filter(Boolean).join('\n\n');
  }
  function validateDeck(deck, facts, now = Date.now()) {
    const format = formatOf(deck), commanderMode = format === 'commander', standardMode = format === 'standard';
    const main = deck.cards.filter(c => c.zone !== 'sideboard'), side = deck.cards.filter(c => c.zone === 'sideboard');
    const cards = standardMode ? [...main, ...side] : main, cmds = main.filter(c => c.zone === 'commander'), issues = [];
    const total = main.reduce((s,c)=>s+c.q,0), sideboardTotal = side.reduce((s,c)=>s+c.q,0);
    if (commanderMode && total !== 100) issues.push('Commander deck has ' + total + ' cards including commanders; expected 100.');
    if (commanderMode && (cmds.length < 1 || cmds.length > 2 || cmds.some(c=>c.q!==1))) issues.push('Choose one commander or a permitted pair, one copy each.');
    if (standardMode && total < 60) issues.push('Standard main deck has ' + total + ' cards; at least 60 are required.');
    if (standardMode && sideboardTotal > 15) issues.push('Standard sideboard has ' + sideboardTotal + ' cards; at most 15 are allowed.');
    if (standardMode && cmds.length) issues.push('Standard has no command zone. Move these cards to the main deck or sideboard.');
    const cmdFacts = cmds.map(c => facts[key(c.n)]), ciKnown = commanderMode && cmds.length > 0 && cmdFacts.every(Boolean);
    const ci = [...new Set(cmdFacts.filter(Boolean).flatMap(identity))];
    if (commanderMode && cmds.length === 2) issues.push('Two commanders: pairing eligibility needs a rules check.');
    const seen = new Map(), missing = new Set(), unknownLegality = new Set(), stale = new Set();
    for (const c of cards) {
      const f = facts[key(c.n)];
      const id = f?.oracle_id || key(f?.name || c.n);
      if (!seen.has(id)) seen.set(id, {n:c.n,q:0,f});
      seen.get(id).q += c.q;
      if (!f) { missing.add(key(c.n)); continue; }
      if (commanderMode && ciKnown && identity(f).some(x => !ci.includes(x))) issues.push(c.n + ': outside commander color identity.');
      if (commanderMode && c.zone === 'commander' && !(/legendary.*creature/.test(type(f)) || /can be your commander/.test(text(f)))) issues.push(c.n + ': verify commander eligibility.');
    }
    for (const {n,q,f} of seen.values()) {
      if (!f) continue;
      if ((commanderMode || standardMode) && !/\bbasic\b/.test(type(f))) {
        const t = text(f), exception = /deck can have any number/.test(t), cap = t.match(/deck can have up to (\w+) cards named/);
        const words = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
        const limit = cap ? (words[cap[1]] || Number(cap[1]) || (commanderMode?1:4)) : (commanderMode?1:4);
        if (!exception && q > limit) issues.push(n + (commanderMode ? ': check singleton / copy limit ('+q+').' : ': '+q+' copies across main deck and sideboard; limit '+limit+'.'));
      }
      const legality = f.legalities?.[format];
      if (legality && legality !== 'legal') issues.push(n + ': ' + legality.replace(/_/g, ' ') + ' in ' + format + '.');
      if (format !== 'casual' && !legality) unknownLegality.add(key(n));
      if (standardMode && (!Number.isFinite(Date.parse(f._fetchedAt)) || now-Date.parse(f._fetchedAt)>86400000)) stale.add(key(n));
    }
    if (missing.size) issues.push(missing.size + ' card names still need Oracle facts.');
    if (unknownLegality.size) issues.push(unknownLegality.size + ' card names have no '+format+' legality evidence. Refresh card facts.');
    if (stale.size) issues.push(stale.size + ' card names need fresh Standard legality data. Refresh card facts; rotation and bans can change.');
    const unresolved = new Set([...missing, ...unknownLegality, ...stale]).size;
    return { total, sideboardTotal, ci: ciKnown ? ci : null, issues:[...new Set(issues)], unresolved,
      note: standardMode ? 'Paper Standard: 60+ main, 0–15 sideboard, four copies combined except basics and Oracle exceptions. Uses Scryfall legality across printings. Companion restrictions need a separate review; check official rules and bans before an event.' : 'Preliminary construction checks; current rules, pairings, special deck limits and interactions may need review.' };
  }
  return { key, text, type, mv, identity, ROLES, roles, traits, effectView, parseDeck, inventory, coverage, alternatives, comboPayload, comboLink, formatOf, setFormat, fromStoredDeck, deckText, validateDeck };
});
