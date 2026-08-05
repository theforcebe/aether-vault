// v5 verification: vectors, directory, bought flow, upgraded build. Run: node test-v5.js
global.window = {};
require('./data/collection.js'); require('./data/cards.js'); require('./data/decks.js');
require('./data/templates.js'); require('./data/brain.js'); require('./data/vectors.js'); require('./data/commanders.js');
const mem = {};
global.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
global.location = { reload: () => {} };
const fs = require('fs');
for (const f of ['rules', 'vector', 'store', 'analyze', 'builder']) {
  const g = f === 'vector' ? 'Vec' : f.charAt(0).toUpperCase() + f.slice(1);
  eval(fs.readFileSync('js/' + f + '.js', 'utf8').replace('const ' + g + ' =', 'global.' + g + ' ='));
}

// vectors
const V = window.VAULT_VECTORS;
console.log('VECTORS:', V ? Object.keys(V.cards).length + ' cards, ' + V.decks.length + ' decks, built ' + V.built : 'MISSING');
if (V) {
  const vec = Vec.deckVector(['Blood Artist', 'Viscera Seer', 'Zulaport Cutthroat', 'Grave Pact', 'Carrion Feeder', 'Village Rites', 'Ashnod\'s Altar', 'Pitiless Plunderer', 'Mayhem Devil', 'Skullclamp', 'Meren of Clan Nel Toth', 'Sakura-Tribe Elder']);
  const near = Vec.nearestDecks(vec, 3);
  console.log('  aristocrat cards -> nearest decks:', near.map((n) => n.commander + ' ' + Math.round(n.score * 100) + '%').join(' | '));
  console.log('  because(Dictate of Erebos):', Vec.because('Dictate of Erebos', new Set(['bloodartist', 'visceraseer', 'gravepact']), 3).join(', ') || 'none');
}

// directory
const C = window.VAULT_COMMANDERS;
console.log('DIRECTORY:', C ? Object.entries(C.archetypes).map(([k, v]) => k + ':' + v.length).join(' ') : 'MISSING');

// bought flow
Store.importBackup(JSON.parse(require('fs').readFileSync('C:/Users/keane/Downloads/aether-vault-keanen.json','utf8')));
const before = Store.collectionTotal();
const meren = Store.state.userdecks.find((d) => d.name.includes('Meren'));
const missing = Store.missingFromCollection(Store.deckView(meren.id).cards);
console.log('BOUGHT FLOW: Meren missing', missing.length, 'cards, cost $' + missing.reduce((s, m) => s + m.unit * m.q, 0).toFixed(0));
Store.addPurchased(missing.slice(0, 3));
const after = Store.missingFromCollection(Store.deckView(meren.id).cards);
console.log('  after buying 3:', after.length, 'missing (was', missing.length + ')', '| purchased binder rows:', Store.rows().filter((r) => r.b === 'Purchased').length);
console.log('  collection value moved:', (Store.collectionTotal() - before).toFixed(2));

// analyzer with vectors
const db = require('C:/Users/keane/deck-overhaul/data/db.json');
const dv = Store.deckView(meren.id);
const factMap = {};
for (const c of dv.cards) {
  const f = db.cards[Store.norm(c.n)];
  if (f) factMap[c.n.toLowerCase()] = { o: (f.oracle || '').toLowerCase(), t: (f.type_line || '').toLowerCase(), mv: f.mv || 0, ci: f.ci || '' };
}
const rep = Analyze.analyzeWithFacts({ cards: dv.cards, ci: dv.ci }, factMap);
console.log('ANALYZER: matches', (rep.brainMatches || []).map((m) => m.name + ' ' + Math.round(m.score * 100) + '%').join('; '));
console.log('  similar real decks:', (rep.similarDecks || []).map((s) => s.commander + ' ' + Math.round(s.score * 100) + '%').join('; ') || 'none');
if (rep.brainSuggestions) {
  for (const i of rep.brainSuggestions.items.slice(0, 5)) {
    console.log('  add:', i.n, Math.round(i.f * 100) + '%', i.owned ? 'OWNED' : '$' + (i.usd || 0), i.because.length ? 'because ' + i.because.join(', ') : '');
  }
}
console.log('OK');
