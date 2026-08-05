// Aether Vault: client-side vector retrieval over the baked co-occurrence space.
// Cards and real decks are sparse PMI vectors over 256 anchor cards; cosine
// similarity here powers similar-deck lookup, suggestion ranking, and the
// because-clauses that explain every recommendation.

const Vec = (() => {
  const V = () => window.VAULT_VECTORS || null;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  // vectors ship as packed strings: 2-char base36 index + 2-char base36 value per dim
  const decCache = new Map();
  function dec(s) {
    if (Array.isArray(s)) return s;
    let a = decCache.get(s);
    if (a) return a;
    a = [];
    for (let i = 0; i + 3 < s.length + 1; i += 4) a.push([parseInt(s.slice(i, i + 2), 36), parseInt(s.slice(i + 2, i + 4), 36)]);
    decCache.set(s, a);
    return a;
  }

  function magnitude(sparse) {
    let m = 0;
    for (const [, v] of sparse) m += v * v;
    return Math.sqrt(m);
  }

  function cosineSparse(a, b) {
    // a, b: arrays of [idx, val]
    const map = new Map(a);
    let dot = 0;
    for (const [i, v] of b) {
      const av = map.get(i);
      if (av) dot += av * v;
    }
    const d = magnitude(a) * magnitude(b);
    return d ? dot / d : 0;
  }

  function cardVec(name) {
    const d = V();
    const raw = d ? d.cards[norm(name)] : null;
    return raw ? dec(raw) : null;
  }

  // Aggregate vector for a list of card names, as sparse top-48 dims.
  function deckVector(names) {
    const d = V();
    if (!d) return null;
    const acc = new Float64Array(256);
    let hit = 0;
    for (const n of names) {
      const raw = d.cards[norm(n)];
      if (!raw) continue;
      hit++;
      for (const [i, val] of dec(raw)) acc[i] += val;
    }
    if (hit < 10) return null;
    const entries = [];
    for (let i = 0; i < 256; i++) if (acc[i] > 0) entries.push([i, acc[i]]);
    entries.sort((x, y) => y[1] - x[1]);
    return entries.slice(0, 48);
  }

  function nearestDecks(vec, k) {
    const d = V();
    if (!d || !vec) return [];
    const out = [];
    for (const deck of d.decks) {
      const s = cosineSparse(vec, dec(deck.v));
      if (s > 0.15) out.push({
        h: deck.h,
        commander: (d.cmdTable && typeof deck.c === 'number') ? d.cmdTable[deck.c] : deck.c,
        score: s,
        url: 'https://edhrec.com/deckpreview/' + deck.h,
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k || 3);
  }

  // Rank candidate cards (by norm key) against a deck vector.
  function scoreCard(vec, name) {
    const v = cardVec(name);
    if (!v || !vec) return 0;
    return cosineSparse(vec, v);
  }

  // Which cards already in the deck drive the similarity to this suggestion.
  function because(name, deckNormSet, limit) {
    const d = V();
    const v = cardVec(name);
    if (!d || !v) return [];
    const out = [];
    for (const [i] of v) {
      const anchorName = d.anchors[i];
      if (deckNormSet.has(norm(anchorName))) out.push(anchorName);
      if (out.length >= (limit || 3)) break;
    }
    return out;
  }

  function ready() { return !!V(); }

  return { ready, cardVec, deckVector, nearestDecks, scoreCard, because, cosineSparse };
})();
