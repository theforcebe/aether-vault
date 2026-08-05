// Aether Vault: the deck builder.
// Takes a theme, a bracket target, and optionally the user's collection, and turns
// a harvested popular decklist (EDHREC average deck, Scryfall-verified at bake time)
// into a personalized build: owned cards marked, role-equivalent owned substitutions,
// bracket-illegal pieces swapped out, and a costed buy list for the rest.

const Builder = (() => {
  const T = () => window.VAULT_TEMPLATES || { archetypes: [], pool: {} };
  const lower = (s) => (s || '').toLowerCase();

  const ALIASES = {
    tokens: ['token', 'tokens', 'go wide', 'swarm', 'populate'],
    counters: ['counter', 'counters', '+1/+1', 'proliferate', 'grow'],
    aristocrats: ['aristocrat', 'aristocrats', 'sacrifice', 'sac', 'death', 'drain'],
    graveyard: ['graveyard', 'reanimator', 'reanimate', 'mill', 'self-mill', 'recursion', 'dredge'],
    spells: ['spellslinger', 'spells', 'instants', 'sorceries', 'storm', 'burn', 'izzet'],
    artifacts: ['artifact', 'artifacts', 'affinity', 'treasure', 'thopter'],
    lifegain: ['lifegain', 'life', 'soul sisters', 'drain'],
    landfall: ['landfall', 'lands', 'ramp'],
    blink: ['blink', 'flicker', 'etb', 'enter the battlefield', 'value'],
    voltron: ['voltron', 'equipment', 'auras', 'commander damage'],
    wheels: ['wheel', 'wheels', 'discard', 'group draw'],
    zombies: ['zombie', 'zombies', 'undead'],
    dragons: ['dragon', 'dragons'],
    elves: ['elf', 'elves', 'elfball'],
  };

  function matchTheme(text) {
    const v = lower(text).trim();
    if (!v) return null;
    for (const a of T().archetypes) {
      if (a.key === v || lower(a.name).includes(v)) return a.key;
    }
    for (const [key, words] of Object.entries(ALIASES)) {
      if (words.some((w) => v.includes(w))) return key;
    }
    return null;
  }

  function archetype(key) { return T().archetypes.find((a) => a.key === key) || null; }
  function brainFor(key) {
    const b = window.VAULT_BRAIN;
    return b && b.archetypes && b.archetypes[key] ? b.archetypes[key] : null;
  }
  function directory(key) {
    const d = window.VAULT_COMMANDERS;
    return d && d.archetypes && d.archetypes[key] ? d.archetypes[key] : [];
  }
  function allCommanders() {
    const d = window.VAULT_COMMANDERS;
    return d && d.commanders ? d.commanders : [];
  }
  function findCommander(name) {
    const v = (name || '').trim().toLowerCase();
    if (!v) return null;
    return allCommanders().find((c) => c.n.toLowerCase() === v) ||
      allCommanders().find((c) => c.n.toLowerCase().startsWith(v)) || null;
  }
  // Archetypes that genuinely fit a commander, best first.
  function fittingArchetypes(cmdEntry) {
    if (!cmdEntry || !cmdEntry.archs) return [];
    const t = T();
    return Object.entries(cmdEntry.archs)
      .sort((a, b) => b[1] - a[1])
      .map(([key, w]) => {
        const a = (t.archetypes || []).find((x) => x.key === key);
        return { key, w, name: a ? a.name : key.charAt(0).toUpperCase() + key.slice(1) };
      });
  }

  // Load any commander's popular list on demand (EDHREC average deck, CORS-open),
  // enrich through Scryfall, classify roles, and cache locally.
  const TPL_LRU = 'av_tpl_lru';
  async function loadCommanderTemplate(slug, onProgress) {
    // baked?
    for (const a of T().archetypes) {
      const i = a.commanders.findIndex((c) => c.slug === slug);
      if (i >= 0) return a.commanders[i];
    }
    // cached?
    try {
      const c = localStorage.getItem('av_tpl_' + slug);
      if (c) return JSON.parse(c);
    } catch (e) { /* refetch */ }
    if (onProgress) onProgress('Fetching the popular list...');
    const r = await fetch('https://json.edhrec.com/pages/average-decks/' + slug + '.json', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Could not load that commander\'s list.');
    const d = await r.json();
    if (!d.deck || !d.deck.cards) throw new Error('No average deck available for that commander yet.');
    const cmdName = (d.deck.commander || [])[0] || '';
    const names = [cmdName];
    const raw = [];
    for (const group of Object.values(d.deck.cards)) {
      for (const [n, q] of group) { raw.push({ n, q }); names.push(n); }
    }
    if (onProgress) onProgress('Verifying ' + names.length + ' cards...');
    const res = await Scry.fullCards(names.map((name) => ({ name })), (done, total) => {
      if (onProgress) onProgress('Verifying ' + done + ' of ' + total + '...');
    });
    const roleOf = (f) => {
      const c = { o: f.o, t: f.t, mv: f.mv };
      if (Rules.isLand(c)) return 'land';
      if (Rules.isWipe(c)) return 'wipe';
      if (Rules.isRemoval(c)) return 'removal';
      if (Rules.isRamp(c)) return 'ramp';
      if (Rules.isDraw(c)) return 'draw';
      return 'none';
    };
    const cf = res.byName[cmdName.toLowerCase()];
    const cards = [];
    for (const c of raw) {
      const f = res.byName[c.n.toLowerCase()];
      if (!f) continue;
      cards.push({
        n: f.name, q: c.q, sid: f.sid, usd: f.usd, mv: f.mv, ci: f.ci,
        t: f.t.includes('land') ? 'Land' : f.t.includes('creature') ? 'Creature' : f.t.includes('instant') ? 'Instant' : f.t.includes('sorcery') ? 'Sorcery' : f.t.includes('planeswalker') ? 'Planeswalker' : f.t.includes('artifact') ? 'Artifact' : f.t.includes('enchantment') ? 'Enchantment' : 'Other',
        role: roleOf(f), gc: Rules.GC.has(f.name.toLowerCase()) ? 1 : 0,
        basic: /^basic land/.test(f.t) ? 1 : 0,
      });
    }
    const tpl = { name: cmdName, slug, ci: cf ? cf.ci : '', sid: cf ? cf.sid : '', usd: cf ? cf.usd : null, cards };
    try {
      localStorage.setItem('av_tpl_' + slug, JSON.stringify(tpl));
      const lru = JSON.parse(localStorage.getItem(TPL_LRU) || '[]').filter((s) => s !== slug);
      lru.push(slug);
      while (lru.length > 24) localStorage.removeItem('av_tpl_' + lru.shift());
      localStorage.setItem(TPL_LRU, JSON.stringify(lru));
    } catch (e) { /* cache optional */ }
    return tpl;
  }

  const BASIC_FOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

  function poolPick(role, ci, usedNames) {
    const pool = T().pool[role] || [];
    for (const p of pool) {
      if (usedNames.has(Store.norm(p.n))) continue;
      if ([...(p.ci || '')].some((x) => !ci.includes(x))) continue;
      return p;
    }
    return null;
  }

  // Facts for owned cards (role detection needs oracle text). Uses the analyzer cache.
  async function scanCollection(onProgress) {
    const uniques = [];
    const seen = new Set();
    for (const r of Store.rows()) {
      const k = lower(r.n);
      if (seen.has(k)) continue;
      seen.add(k);
      uniques.push({ n: r.n, sid: r.sid });
    }
    const facts = await Analyze.facts(uniques, onProgress);
    return facts; // { lowername: {o,t,mv,ci,...} }
  }

  function ownedRole(fact) {
    if (!fact) return null;
    const c = { o: fact.o, t: fact.t, mv: fact.mv };
    if (Rules.isLand(c)) return 'land';
    if (Rules.isWipe(c)) return 'wipe';
    if (Rules.isRemoval(c)) return 'removal';
    if (Rules.isRamp(c)) return 'ramp';
    if (Rules.isDraw(c)) return 'draw';
    return 'none';
  }

  function build(opts) {
    // opts: {archKey (may be null with cmdOverride), cmdIdx, cmdOverride, bracket, useCollection, substitute, ownedFacts}
    const a = opts.archKey ? archetype(opts.archKey) : null;
    if (!a && !opts.cmdOverride) return { error: 'Unknown theme.' };
    const cmd = opts.cmdOverride || a.commanders[Math.min(opts.cmdIdx || 0, a.commanders.length - 1)];
    const archName = a ? a.name : 'Popular build';
    const ci = cmd.ci || '';
    const notes = [];
    const cards = cmd.cards.map((c) => ({ ...c }));
    const used = new Set(cards.map((c) => Store.norm(c.n)));
    used.add(Store.norm(cmd.name));

    const replace = (idx, why) => {
      const old = cards[idx];
      const rolesToTry = old.role !== 'none' && old.role !== 'land' ? [old.role] : ['draw', 'removal', 'ramp'];
      let sub = null;
      for (const role of rolesToTry) { sub = poolPick(role, ci, used); if (sub) break; }
      if (sub) {
        cards[idx] = { n: sub.n, q: old.q, sid: sub.sid, usd: sub.usd, mv: sub.mv, ci: sub.ci, t: 'Spell', role: rolesToTry[0], gc: 0, basic: 0 };
        used.add(Store.norm(sub.n));
        notes.push('Swapped ' + old.n + ' for ' + sub.n + ' (' + why + ').');
      } else {
        const basic = BASIC_FOR[ci[0]] || 'Wastes';
        cards[idx] = { n: basic, q: old.q, sid: '', usd: 0, mv: 0, ci: '', t: 'Land', role: 'land', gc: 0, basic: 1 };
        notes.push('Removed ' + old.n + ' (' + why + '), slot became a ' + basic + '.');
      }
    };

    // bracket shaping
    const bracket = opts.bracket || 3;
    const gcLimit = bracket >= 4 ? Infinity : bracket === 3 ? 3 : 0;
    const isGc = (c) => !!c.gc || Rules.GC.has(lower(c.n)); // never trust baked flags alone
    function enforceGcLimit() {
      if (gcLimit === Infinity) return;
      const gcIdx = cards.map((c, i) => ({ c, i })).filter((x) => isGc(x.c));
      if (gcIdx.length <= gcLimit) return;
      gcIdx.sort((x, y) => ((x.c.role === 'none' ? 0 : 1) - (y.c.role === 'none' ? 0 : 1)) || ((y.c.usd || 0) - (x.c.usd || 0)));
      for (const x of gcIdx.slice(0, gcIdx.length - gcLimit)) replace(x.i, 'Game Changer over the Bracket ' + bracket + ' limit');
    }
    enforceGcLimit();
    if (bracket <= 3) {
      for (const [i, c] of cards.entries()) {
        if (Rules.MLD.has(lower(c.n))) replace(i, 'mass land denial is Bracket 4 territory');
      }
      const names = new Set(cards.map((c) => lower(c.n)));
      for (const p of Rules.comboPairs()) {
        const isFast = Rules.comboIsFast(p);
        if (bracket === 3 && !isFast) continue;
        if (!names.has(lower(p.a)) || !names.has(lower(p.b))) continue;
        const ia = cards.findIndex((c) => lower(c.n) === lower(p.a));
        const ib = cards.findIndex((c) => lower(c.n) === lower(p.b));
        if (ia < 0 || ib < 0) continue; // half already swapped out by an earlier rule
        const pick = (cards[ia].role === 'none' ? ia : cards[ib].role === 'none' ? ib : ((cards[ia].usd || 0) > (cards[ib].usd || 0) ? ia : ib));
        const removed = lower(cards[pick].n);
        replace(pick, 'breaks the ' + p.a + ' + ' + p.b + ' combo for Bracket ' + bracket);
        names.delete(removed);
        names.add(lower(cards[pick].n));
      }
    }

    // ownership + substitution
    const ownedFacts = opts.ownedFacts || null;
    const usedOwned = new Set();
    for (const d of Store.state.userdecks) for (const c of d.cards) usedOwned.add(lower(c.n));

    for (const c of cards) {
      if (c.basic) { c.status = 'basic'; continue; }
      const own = opts.useCollection ? Store.byName[Store.norm(c.n)] : null;
      if (own && own.qty > 0) { c.status = 'owned'; c.inDeckAlready = usedOwned.has(lower(c.n)); continue; }
      c.status = 'buy';
      if (opts.substitute && ownedFacts && c.role !== 'none' && c.role !== 'land') {
        // Prefer owned cards that real decks of this archetype actually play.
        const brain = brainFor(opts.archKey);
        const brainF = {};
        if (brain) for (const bc of brain.cards) brainF[Store.norm(bc.n)] = bc.f;
        let best = null;
        for (const [k, agg] of Object.entries(Store.byName)) {
          if (used.has(k) || agg.qty <= 0) continue;
          const f = ownedFacts[lower(agg.name)];
          if (!f) continue;
          if ([...(f.ci || '')].some((x) => !ci.includes(x))) continue;
          if (ownedRole(f) !== c.role) continue;
          const d = Math.abs((f.mv || 0) - c.mv);
          const pop = brainF[k] || 0;
          if (d > 2 && pop < 0.15) continue;
          const score = pop * 10 - d * 1.2;
          if (!best || score > best.score) best = { name: agg.name, sid: agg.sid || f.sid, score, pop };
        }
        if (best) {
          c.status = 'sub';
          c.subFor = c.n;
          c.n = best.name;
          c.sid = best.sid;
          c.usd = 0;
          c.pop = best.pop;
          used.add(Store.norm(best.name));
        }
      }
    }

    // brain recommendations: what real decks of this theme play
    const brain = brainFor(opts.archKey);
    const recommendations = { ownedPopular: [], upgrades: [], decks: brain ? brain.decks : 0 };
    if (brain) {
      for (const bc of brain.cards) {
        const k = Store.norm(bc.n);
        if (used.has(k)) continue;
        if ([...(bc.ci || '')].some((x) => !ci.includes(x))) continue;
        const own = opts.useCollection ? Store.byName[k] : null;
        if (own && own.qty > 0 && bc.f >= 0.12 && recommendations.ownedPopular.length < 10) {
          recommendations.ownedPopular.push({ n: bc.n, f: bc.f, sid: own.sid || bc.sid });
        } else if ((!own || own.qty <= 0) && bc.f >= 0.2 && recommendations.upgrades.length < 10) {
          recommendations.upgrades.push({ n: bc.n, f: bc.f, sid: bc.sid, usd: bc.usd });
        }
        if (recommendations.ownedPopular.length >= 10 && recommendations.upgrades.length >= 10) break;
      }
    }

    // substitutions can sneak a Game Changer back in; enforce once more
    enforceGcLimit();

    // budget ceiling: swap the priciest to-buy cards down until under the cap
    if (opts.budget > 0) {
      const inCost = (c) => (c.status === 'buy' || !opts.useCollection) && !c.basic;
      const cost = () => cards.filter(inCost).reduce((s, c) => s + (c.usd || 0) * c.q, 0) +
        (opts.useCollection && Store.byName[Store.norm(cmd.name)] ? 0 : (cmd.usd || 0));
      let guard = 30;
      while (cost() > opts.budget && guard-- > 0) {
        const list = cards.filter(inCost).sort((a, b) => (b.usd || 0) - (a.usd || 0));
        const target = list[0];
        if (!target || (target.usd || 0) < 1) break;
        const i = cards.indexOf(target);
        const before = target.usd || 0;
        replace(i, 'keeps the build under your $' + opts.budget + ' ceiling, was $' + before.toFixed(0));
        cards[i].status = opts.useCollection && Store.byName[Store.norm(cards[i].n)] ? 'owned' : (cards[i].basic ? 'basic' : 'buy');
        if ((cards[i].usd || 0) >= before) break; // nothing cheaper left in the pool
      }
      if (cost() > opts.budget) notes.push('Closest to the $' + opts.budget + ' ceiling without gutting the deck: $' + cost().toFixed(0) + '.');
      enforceGcLimit();
    }

    // exact-99 guarantee: averaged templates occasionally run a few cards short
    let total99 = cards.reduce((s, c) => s + c.q, 0);
    if (total99 < 99) {
      const basics = [...ci].map((x) => BASIC_FOR[x]).filter(Boolean);
      let bi = 0;
      while (total99 < 99) {
        const bn = basics.length ? basics[bi++ % basics.length] : 'Wastes';
        const row = cards.find((c) => c.n === bn);
        if (row) row.q++;
        else cards.push({ n: bn, q: 1, sid: '', usd: 0, mv: 0, ci: '', t: 'Basic Land', role: 'land', gc: 0, basic: 1, status: 'basic' });
        total99++;
      }
      notes.push('Topped up to 99 with basic lands.');
    } else if (total99 > 99) {
      const order = cards.map((c) => c).filter((c) => !c.basic).sort((a, b) => ((a.role === 'none' ? 0 : 1) - (b.role === 'none' ? 0 : 1)) || ((a.usd || 0) - (b.usd || 0)));
      let oi = 0;
      while (total99 > 99 && oi < order.length) {
        const c = order[oi];
        if (c.q > 1) { c.q--; total99--; }
        else { cards.splice(cards.indexOf(c), 1); total99--; oi++; }
      }
    }

    const buy = cards.filter((c) => c.status === 'buy');
    const stats = {
      commander: cmd.name, ci, bracket,
      totalValue: cards.reduce((s, c) => s + (c.usd || 0) * c.q, 0) + (cmd.usd || 0),
      buyCost: buy.reduce((s, c) => s + (c.usd || 0) * c.q, 0) + (opts.useCollection && Store.byName[Store.norm(cmd.name)] ? 0 : (cmd.usd || 0)),
      ownedCount: cards.filter((c) => c.status === 'owned').reduce((s, c) => s + c.q, 0),
      subCount: cards.filter((c) => c.status === 'sub').reduce((s, c) => s + c.q, 0),
      basicCount: cards.filter((c) => c.status === 'basic').reduce((s, c) => s + c.q, 0),
      buyCount: buy.reduce((s, c) => s + c.q, 0),
      commanderOwned: !!(opts.useCollection && Store.byName[Store.norm(cmd.name)]),
      gcs: cards.filter((c) => isGc(c)).map((c) => c.n),
    };
    return { archetype: archName, commander: cmd, cards, notes, stats, recommendations };
  }

  function decklistText(result) {
    const lines = ['1 ' + result.commander.name];
    for (const c of result.cards) lines.push(c.q + ' ' + c.n);
    return lines.join('\n');
  }
  function buylistText(result) {
    const lines = [];
    if (!result.stats.commanderOwned) lines.push('1 ' + result.commander.name);
    for (const c of result.cards) if (c.status === 'buy') lines.push(c.q + ' ' + c.n);
    return lines.join('\n');
  }

  // wishlist compare: resolved cards vs collection; touches nothing.
  function compare(cards) {
    const rows = [];
    let buyCost = 0, ownedCount = 0, needCount = 0;
    for (const c of cards) {
      const own = Store.byName[Store.norm(c.n)];
      const have = own ? own.qty : 0;
      const need = Math.max(0, c.q - have);
      const res = Store.state.resolved[lower(c.n)];
      const unit = res && res.usd != null ? res.usd : Store.cardValue(c.n, c.sid || Store.sidFor(c.n));
      if (need > 0) { needCount += need; buyCost += unit * need; }
      ownedCount += Math.min(have, c.q);
      rows.push({ n: c.n, q: c.q, have: Math.min(have, c.q), need, unit, sid: c.sid || Store.sidFor(c.n) });
    }
    rows.sort((a, b) => (b.need - a.need) || (b.unit - a.unit));
    return { rows, buyCost, ownedCount, needCount };
  }
  function compareBuylistText(cmp) {
    return cmp.rows.filter((r) => r.need > 0).map((r) => r.need + ' ' + r.n).join('\n');
  }

  // Fill an under-99 user deck with the benchmark-adopted ranker: best-match
  // archetype staples scored f*0.65 + cos*0.35, color-filtered, lands topped
  // up to what real decks of the theme run. Returns a proposal, mutates nothing.
  function completeMyDeck(dv) {
    const BR = window.VAULT_BRAIN;
    if (!BR) return { error: 'Deck intelligence is still loading.' };
    const nonCmd = dv.cards.filter((c) => c.src !== 'commander');
    const total = nonCmd.reduce((s, c) => s + c.q, 0);
    const needed = 99 - total;
    if (needed <= 0) return { adds: [], basics: [], needed: 0 };
    const keys = new Set(nonCmd.map((c) => Store.norm(c.n)));
    let best = null, bestS = 0, bestKey = null;
    for (const [key, arch] of Object.entries(BR.archetypes)) {
      let hit = 0, denom = 0;
      for (const bc of arch.cards.slice(0, 60)) { denom += bc.f; if (keys.has(Store.norm(bc.n))) hit += bc.f; }
      const s = denom ? hit / denom : 0;
      if (s > bestS) { bestS = s; best = arch; bestKey = key; }
    }
    if (bestS < 0.05) best = null;
    const ci = dv.ci || '';
    const landTarget = best ? best.comp.lands : 36;
    let lands = 0;
    for (const c of nonCmd) {
      const f = Store.card(c.n);
      if ((f && /land/i.test(f.t)) || /^(plains|island|swamp|mountain|forest|wastes|snow-covered)/i.test(c.n)) lands += c.q;
    }
    let landsNeeded = Math.max(0, Math.min(needed, landTarget - lands));
    const spellsNeeded = needed - landsNeeded;
    const adds = [];
    if (best && spellsNeeded > 0) {
      const vec = Vec.deckVector(nonCmd.map((c) => c.n));
      const ranked = [];
      for (const bc of best.cards) {
        const k = Store.norm(bc.n);
        if (keys.has(k)) continue;
        if (ci && [...(bc.ci || '')].some((x) => !ci.includes(x))) continue;
        if (bc.role === 'land') continue;
        const cos = vec ? Vec.scoreCard(vec, bc.n) : 0;
        ranked.push({
          n: bc.n, sid: bc.sid, usd: bc.usd, f: bc.f, role: bc.role,
          score: bc.f * 0.65 + cos * 0.35,
          owned: !!(Store.byName[k] && Store.byName[k].qty > 0),
          because: Vec.because(bc.n, keys, 2),
        });
      }
      ranked.sort((a, b) => b.score - a.score);
      adds.push(...ranked.slice(0, spellsNeeded));
      if (adds.length < spellsNeeded) landsNeeded += spellsNeeded - adds.length;
    } else if (!best) landsNeeded = Math.max(landsNeeded, 0);
    const basics = [];
    const colors = ci ? [...ci] : [];
    for (let i = 0; i < landsNeeded; i++) {
      const b = colors.length ? BASIC_FOR[colors[i % colors.length]] : 'Wastes';
      const row = basics.find((x) => x.n === b);
      if (row) row.q++; else basics.push({ n: b, q: 1 });
    }
    return { adds, basics, needed, archetype: bestKey, matchScore: bestS, landTarget };
  }

  return { matchTheme, archetype, templates: T, build, scanCollection, decklistText, buylistText, compare, compareBuylistText, directory, loadCommanderTemplate, brainFor, allCommanders, findCommander, fittingArchetypes, completeMyDeck };
})();
