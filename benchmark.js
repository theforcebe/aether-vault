// Recommendation engine benchmark. Holds out 10 cards from each of ~500
// harvested decks, asks the engine to rank suggestions from the remaining
// cards, and scores recall@10/25 + MRR. Seeded PRNG so runs are comparable.
// Run: node benchmark.js   Results belong in BENCHMARKS.md.
//
// Notes on honesty: the brain was distilled FROM this corpus, so absolute
// numbers carry leakage (one deck among ~344 per archetype). The value is in
// RELATIVE movement: any engine change must hold or beat the recorded line.
// Held-out cards are restricted to ones the engine could possibly suggest
// (present in the brain pool for some archetype), which is standard practice.

const fs = require('fs');
const path = require('path');

global.window = {};
require('./data/brain.js'); require('./data/vectors.js'); require('./data/templates.js');
const mem = {};
global.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
global.document = { addEventListener: () => {} };
for (const [f, g] of [['rules', 'Rules'], ['vector', 'Vec'], ['store', 'Store']]) {
  eval(fs.readFileSync('js/' + f + '.js', 'utf8').replace('const ' + g + ' =', 'global.' + g + ' ='));
}

const DECKS_DIR = 'C:/Users/keane/deck-overhaul/harvest/decks';
const norm = Store.norm;
const B = window.VAULT_BRAIN;

// seeded PRNG
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260805);

// every card any archetype could suggest
const suggestible = new Set();
for (const a of Object.values(B.archetypes)) for (const c of a.cards) suggestible.add(norm(c.n));

const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);

// load decks, group by commander, round-robin sample for diversity
const byCmd = new Map();
for (const f of fs.readdirSync(DECKS_DIR)) {
  if (!f.endsWith('.json')) continue;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), 'utf8')); } catch (e) { continue; }
  if (!d.deck || d.deck.length < 80) continue;
  const cmd = (d.commanders || []).join(' + ') || '?';
  const cmdSet = new Set((d.commanders || []).map((c) => norm(c)));
  const cards = [];
  for (const line of d.deck) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    const n = (m ? m[2] : line).trim();
    const k = norm(n);
    if (BASICS.has(n.toLowerCase()) || cmdSet.has(k)) continue;
    cards.push({ n, k });
  }
  if (cards.length < 60) continue;
  if (!byCmd.has(cmd)) byCmd.set(cmd, []);
  byCmd.get(cmd).push({ cmd, cards });
}
const sample = [];
let round = 0;
const lists = [...byCmd.values()];
while (sample.length < 500) {
  let added = 0;
  for (const list of lists) {
    if (round < list.length && sample.length < 500) { sample.push(list[round]); added++; }
  }
  if (!added) break;
  round++;
}

// archetype matches sorted best-first (frequency overlap over brain top-60)
function archMatches(visibleKeys) {
  const out = [];
  for (const arch of Object.values(B.archetypes)) {
    let hit = 0, denom = 0;
    for (const bc of arch.cards.slice(0, 60)) {
      denom += bc.f;
      if (visibleKeys.has(norm(bc.n))) hit += bc.f;
    }
    if (denom > 0) out.push({ arch, s: hit / denom });
  }
  out.sort((a, b) => b.s - a.s);
  return out.filter((m) => m.s >= 0.08);
}

// candidate pool: cards of the top-N matched archetypes, max f on overlap.
// weighted: secondary archetypes contribute f scaled by (match/best)^2 so a
// weak second match barely dilutes, a strong one genuinely merges.
function pool(matches, n, visibleKeys, weighted) {
  const cand = new Map();
  const sBest = matches[0].s;
  for (const m of matches.slice(0, n)) {
    const w = weighted ? Math.pow(m.s / sBest, 2) : 1;
    for (const bc of m.arch.cards) {
      const k = norm(bc.n);
      if (visibleKeys.has(k)) continue;
      const f = bc.f * w;
      const prev = cand.get(k);
      if (!prev || f > prev.f) cand.set(k, { k, n: bc.n, f });
    }
  }
  return [...cand.values()];
}

// keep the adopted config plus the old baseline as a regression pair; add
// experimental configs alongside when trying engine changes
const CONFIGS = {
  'old f.6/c.4': { pools: 1, rank: (c) => c.f * 0.6 + c.cos * 0.4 },
  'PROD f.65/c.35': { pools: 1, rank: (c) => c.f * 0.65 + c.cos * 0.35 },
};

// precompute holdouts once so every config sees identical splits
const cases = [];
for (const d of sample) {
  const holdable = d.cards.filter((c) => suggestible.has(c.k));
  if (holdable.length < 10) continue;
  const idx = new Set();
  while (idx.size < 10) idx.add(Math.floor(rand() * holdable.length));
  const held = new Set([...idx].map((i) => holdable[i].k));
  const visible = d.cards.filter((c) => !held.has(c.k));
  cases.push({ held, vKeys: new Set(visible.map((c) => c.k)), vNames: visible.map((c) => c.n) });
}
console.log('cases:', cases.length, 'decks (', byCmd.size, 'commanders )\n');

for (const [name, cfg] of Object.entries(CONFIGS)) {
  let r10 = 0, r25 = 0, mrr = 0, used = 0;
  for (const cs of cases) {
    const matches = archMatches(cs.vKeys);
    if (!matches.length) continue;
    const cands = pool(matches, cfg.pools, cs.vKeys, cfg.weighted);
    const vec = Vec.deckVector(cs.vNames);
    for (const c of cands) c.cos = vec ? Vec.scoreCard(vec, c.n) : 0;
    let ranked;
    if (cfg.rrf) {
      const byF = [...cands].sort((a, b) => b.f - a.f);
      const byC = [...cands].sort((a, b) => b.cos - a.cos);
      const rankF = new Map(byF.map((c, i) => [c.k, i]));
      const rankC = new Map(byC.map((c, i) => [c.k, i]));
      for (const c of cands) c.score = 1 / (60 + rankF.get(c.k)) + 1 / (60 + rankC.get(c.k));
      ranked = cands.sort((a, b) => b.score - a.score);
    } else {
      for (const c of cands) c.score = cfg.rank(c);
      ranked = cands.sort((a, b) => b.score - a.score);
    }
    const top = ranked.slice(0, 25).map((x) => x.k);
    used++;
    r10 += top.slice(0, 10).filter((k) => cs.held.has(k)).length / 10;
    r25 += top.filter((k) => cs.held.has(k)).length / 10;
    const first = top.findIndex((k) => cs.held.has(k));
    mrr += first >= 0 ? 1 / (first + 1) : 0;
  }
  console.log(name.padEnd(22), 'r@10', (r10 / used).toFixed(4), ' r@25', (r25 / used).toFixed(4), ' MRR', (mrr / used).toFixed(4), ' n=' + used);
}
