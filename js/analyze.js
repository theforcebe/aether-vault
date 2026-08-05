// Aether Vault: the deck doctor.
// Fetches full oracle text for a deck (cached), then grades it against the
// October 2025 Commander Bracket system and common deckbuilding baselines,
// detects archetypes, and produces concrete suggestions.

const Analyze = (() => {
  const CACHE_KEY = 'av_oracle';
  const lower = (s) => (s || '').toLowerCase();

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCache(c) {
    try {
      const keys = Object.keys(c);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete c[k];
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* cache is optional */ }
  }

  // Resolve full facts for every card in the deck, using cache first.
  async function facts(cards, onProgress) {
    const cache = loadCache();
    const out = {};
    const need = [];
    for (const c of cards) {
      const key = lower(c.n);
      if (cache[key]) out[key] = cache[key];
      else need.push(c);
    }
    if (need.length) {
      const identifiers = need.map((c) => (c.sid ? { id: c.sid } : { name: c.n }));
      const res = await Scry.fullCards(identifiers, onProgress);
      for (const c of need) {
        const f = c.sid ? res.bySid[c.sid] : res.byName[lower(c.n)];
        if (f) { out[lower(c.n)] = f; cache[lower(c.n)] = f; }
      }
      saveCache(cache);
    }
    return out;
  }

  function analyzeWithFacts(deck, factMap) {
    const cards = [];
    let unresolved = 0;
    for (const c of deck.cards) {
      const f = factMap[lower(c.n)];
      if (!f) { unresolved++; continue; }
      cards.push({ n: c.n, q: c.q, src: c.src, o: f.o, t: f.t, mv: f.mv, ci: f.ci });
    }
    const nonland = cards.filter((c) => !Rules.isLand(c));
    const count = (fn) => cards.filter(fn).reduce((s, c) => s + c.q, 0);
    const names = new Set(cards.map((c) => lower(c.n)));
    const totalCards = deck.cards.reduce((s, c) => s + c.q, 0);

    // composition
    const comp = {
      lands: count(Rules.isLand),
      ramp: count(Rules.isRamp),
      draw: count((c) => !Rules.isLand(c) && Rules.isDraw(c)),
      removal: count((c) => Rules.isRemoval(c) && !Rules.isWipe(c)),
      wipes: count(Rules.isWipe),
    };
    const mvs = [];
    for (const c of nonland) for (let i = 0; i < c.q; i++) mvs.push(c.mv);
    const avgMv = mvs.length ? mvs.reduce((a, b) => a + b, 0) / mvs.length : 0;

    // bracket signals
    const gcs = cards.filter((c) => Rules.GC.has(lower(c.n)));
    const gcCount = gcs.reduce((s, c) => s + c.q, 0);
    const mld = cards.filter((c) => Rules.MLD.has(lower(c.n)));
    const turns = cards.filter((c) => Rules.TURNS.has(lower(c.n)));
    const fast = cards.filter((c) => Rules.FAST.has(lower(c.n)));
    const free = cards.filter((c) => Rules.FREE.has(lower(c.n)));
    const tutors = cards.filter((c) => Rules.TUTORS.has(lower(c.n)) || (Rules.genericTutor(c) && !Rules.isLand(c)));
    const combos = Rules.comboPairs().filter((p) => names.has(lower(p.a)) && names.has(lower(p.b)));
    const fastCombos = combos.filter((p) => Rules.comboIsFast(p));
    const triples = Rules.comboTriples().filter((t) => t.c.every((n) => names.has(lower(n))));

    // bracket floor from hard rules
    let bracket = 2;
    const why = [];
    if (gcCount === 0) why.push('No Game Changers.');
    if (gcCount >= 1 && gcCount <= 3) { bracket = Math.max(bracket, 3); why.push(gcCount + ' Game Changer' + (gcCount > 1 ? 's' : '') + ': ' + gcs.map((c) => c.n).join(', ') + '.'); }
    if (gcCount >= 4) { bracket = Math.max(bracket, 4); why.push(gcCount + ' Game Changers puts this past Bracket 3’s limit of three.'); }
    if (mld.length) { bracket = Math.max(bracket, 4); why.push('Mass land denial (' + mld.map((c) => c.n).join(', ') + ') is Bracket 4 territory.'); }
    if (fastCombos.length) { bracket = Math.max(bracket, 4); why.push('Fast two-card combo: ' + fastCombos.map((p) => p.a + ' + ' + p.b).join('; ') + '.'); }
    else if (combos.length) { bracket = Math.max(bracket, 3); why.push('Two-card combo present (' + combos.map((p) => p.a + ' + ' + p.b).join('; ') + '), acceptable in Bracket 3 as a late-game line.'); }
    if (turns.reduce((s, c) => s + c.q, 0) >= 3) { why.push(turns.length + ' extra-turn cards. Chaining them is not Bracket 1-3 behavior.'); bracket = Math.max(bracket, 3); }

    // power feel on top of the floor
    let power = 0;
    power += Math.min(fast.length, 5) * 1.2;
    power += Math.min(tutors.length, 8) * 0.8;
    power += free.length * 1.1;
    power += fastCombos.length * 2.5 + (combos.length - fastCombos.length) * 1.2;
    power += gcCount * 0.9;
    if (avgMv && avgMv < 2.9) power += 2;
    if (comp.draw >= 9 && comp.ramp >= 10) power += 1.5;
    let feel = bracket;
    if (bracket <= 3 && power >= 9) feel = Math.max(feel, 3);
    if (power >= 13) feel = Math.max(feel, 4);
    if (power >= 22 && fastCombos.length && free.length >= 2 && fast.length >= 4) feel = 5;

    // archetypes
    const arch = [];
    for (const a of Rules.ARCHETYPES) {
      const hits = cards.filter((c) => a.test(c)).reduce((s, c) => s + c.q, 0);
      if (hits >= a.min) arch.push({ key: a.key, name: a.name, hits, staples: a.staples });
    }
    arch.sort((x, y) => y.hits - x.hits);
    // tribal check via creature subtypes
    const subCounts = {};
    let creatureTotal = 0;
    for (const c of cards) {
      if (!c.t.includes('creature') || c.t.startsWith('basic')) continue;
      creatureTotal += c.q;
      const after = (c.t.split('—')[1] || '').trim();
      for (const st of after.split(/[ /]+/)) if (st && st.length > 2) subCounts[st] = (subCounts[st] || 0) + c.q;
    }
    const topSub = Object.entries(subCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSub && creatureTotal >= 15 && topSub[1] / creatureTotal >= 0.45) {
      arch.unshift({ key: 'tribal', name: 'Tribal: ' + topSub[0][0].toUpperCase() + topSub[0].slice(1), hits: topSub[1],
        staples: ['Vanquisher’s Banner', 'Herald’s Horn', 'Kindred Discovery', 'Door of Destinies', 'Coat of Arms', 'Path of Ancestry', 'Reflections of Littjara'] });
    }

    // suggestions
    const ci = deck.ci || (() => {
      const cmd = cards.find((c) => c.src === 'commander');
      return cmd ? cmd.ci : '';
    })();
    const fitsCi = (name) => {
      if (!ci) return true;
      const f = Store.card(name);
      if (!f) return true;
      return [...(f.ci || '')].every((x) => ci.includes(x));
    };
    const notInDeck = (name) => !names.has(lower(name));
    const suggestions = [];
    const [lo, hi] = [0, 1];
    for (const [role, range] of Object.entries(Rules.BASELINES)) {
      const have = comp[role];
      if (have < range[lo]) {
        const picks = (Rules.GAP_SUGGESTIONS[role] || []).filter((n) => fitsCi(n) && notInDeck(n)).slice(0, 4);
        suggestions.push({
          kind: 'gap', role,
          text: 'Light on ' + role + ': ' + have + ' vs a typical ' + range[0] + '-' + range[1] + '.',
          picks,
        });
      }
    }
    for (const a of arch.slice(0, 2)) {
      const picks = a.staples.filter((n) => fitsCi(n) && notInDeck(n)).slice(0, 5);
      if (picks.length) suggestions.push({ kind: 'arch', role: a.name, text: a.name + ' payoffs worth considering.', picks });
    }
    // cut candidates: expensive cards with no detected role or archetype fit
    const cuts = nonland.filter((c) =>
      c.src !== 'commander' && c.mv >= 5 &&
      !Rules.isRamp(c) && !Rules.isDraw(c) && !Rules.isRemoval(c) && !Rules.isWipe(c) &&
      !Rules.GC.has(lower(c.n)) &&
      !arch.slice(0, 2).some((a) => (Rules.ARCHETYPES.find((x) => x.key === a.key) || { test: () => false }).test(c))
    ).sort((a, b) => b.mv - a.mv).slice(0, 5);

    // brain matching: which real-deck population does this list most resemble,
    // and what do those decks play that this list is missing
    let brainMatches = [];
    let brainSuggestions = null;
    const BR = window.VAULT_BRAIN;
    if (BR && BR.archetypes) {
      const deckNames = names;
      const tName = (key) => {
        const t = window.VAULT_TEMPLATES;
        const a = t && t.archetypes ? t.archetypes.find((x) => x.key === key) : null;
        return a ? a.name : key.charAt(0).toUpperCase() + key.slice(1);
      };
      for (const [key, arch] of Object.entries(BR.archetypes)) {
        const topCards = arch.cards.slice(0, 60);
        let hit = 0, denom = 0;
        for (const bc of topCards) {
          denom += bc.f;
          if (deckNames.has(lower(bc.n))) hit += bc.f;
        }
        if (denom > 0) brainMatches.push({ key, name: tName(key), score: hit / denom, decks: arch.decks });
      }
      brainMatches.sort((a, b) => b.score - a.score);
      brainMatches = brainMatches.filter((m) => m.score >= 0.08).slice(0, 3);
      const top = brainMatches[0];
      if (top) {
        const arch = BR.archetypes[top.key];
        const deckNormSet = new Set(cards.map((c) => Store.norm(c.n)));
        const vec = (typeof Vec !== 'undefined' && Vec.ready()) ? Vec.deckVector(cards.map((c) => c.n)) : null;
        const items = [];
        for (const bc of arch.cards) {
          if (bc.f < 0.2) continue;
          if (deckNames.has(lower(bc.n))) continue;
          if (ci && [...(bc.ci || '')].some((x) => !ci.includes(x))) continue;
          const own = Store.byName[Store.norm(bc.n)];
          const cos = vec ? Vec.scoreCard(vec, bc.n) : 0;
          items.push({
            n: bc.n, f: bc.f, usd: bc.usd, sid: bc.sid,
            owned: !!(own && own.qty > 0),
            score: bc.f * 0.6 + cos * 0.4,
            because: vec ? Vec.because(bc.n, deckNormSet, 3) : [],
          });
        }
        items.sort((a, b) => b.score - a.score);
        if (items.length) brainSuggestions = { arch: top.name, decks: arch.decks, items: items.slice(0, 12) };
      }
    }

    // closest real decks via vector retrieval
    let similarDecks = [];
    if (typeof Vec !== 'undefined' && Vec.ready()) {
      const vec = Vec.deckVector(cards.map((c) => c.n));
      if (vec) similarDecks = Vec.nearestDecks(vec, 3);
    }

    return {
      totalCards, unresolved, comp, avgMv: avgMv.toFixed(2),
      gcs: gcs.map((c) => c.n), mld: mld.map((c) => c.n), turns: turns.map((c) => c.n),
      fast: fast.map((c) => c.n), free: free.map((c) => c.n), tutors: tutors.map((c) => c.n),
      combos, fastCombos: fastCombos.length, triples,
      bracket, feel, why, power: Math.round(power * 10) / 10,
      archetypes: arch.slice(0, 4), suggestions, cuts: cuts.map((c) => ({ n: c.n, mv: c.mv })),
      brainMatches, brainSuggestions, similarDecks,
    };
  }

  async function run(deck, onProgress) {
    const factMap = await facts(deck.cards, onProgress);
    return analyzeWithFacts(deck, factMap);
  }

  return { run, analyzeWithFacts, facts };
})();
