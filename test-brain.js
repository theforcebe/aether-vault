// Post-bake verification for the recommendation brain (run with node test-brain.js)
global.window = {};
require('./data/collection.js'); require('./data/cards.js'); require('./data/decks.js');
require('./data/templates.js'); require('./data/brain.js');
const mem = {};
global.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
global.location = { reload: () => {} };
const fs = require('fs');
eval(fs.readFileSync('js/rules.js', 'utf8').replace('const Rules =', 'global.Rules ='));
eval(fs.readFileSync('js/store.js', 'utf8').replace('const Store =', 'global.Store ='));
eval(fs.readFileSync('js/analyze.js', 'utf8').replace('const Analyze =', 'global.Analyze ='));
eval(fs.readFileSync('js/builder.js', 'utf8').replace('const Builder =', 'global.Builder ='));

const B = window.VAULT_BRAIN;
if (!B || !B.archetypes) { console.log('FAIL: brain missing'); process.exit(1); }
console.log('BRAIN: built', B.built, '| decks total', B.decksTotal);
let under100 = 0;
for (const [k, a] of Object.entries(B.archetypes)) {
  if (a.decks < 100) under100++;
  console.log(' ', k.padEnd(12), a.decks, 'decks |', a.cards.length, 'cards | comp', JSON.stringify(a.comp),
    '| top:', a.cards.slice(0, 3).map((c) => c.n + ' ' + Math.round(c.f * 100) + '%').join(', '));
}
console.log(under100 ? 'WARN: ' + under100 + ' archetypes under 100 decks' : 'All archetypes at 100+ decks');

// builder with brain recommendations against the seeded collection
Store.importSeed();
const db = require('C:/Users/keane/deck-overhaul/data/db.json');
const ownedFacts = {};
for (const [k, v] of Object.entries(Store.byName)) {
  const f = db.cards[Store.norm(v.name)];
  if (f) ownedFacts[v.name.toLowerCase()] = { o: (f.oracle || '').toLowerCase(), t: (f.type_line || '').toLowerCase(), mv: f.mv || 0, ci: f.ci || '' };
}
const r = Builder.build({ archKey: 'aristocrats', cmdIdx: 0, bracket: 3, useCollection: true, substitute: true, ownedFacts });
console.log('\nBUILDER aristocrats: owned', r.stats.ownedCount, 'subs', r.stats.subCount, 'buy $' + r.stats.buyCost.toFixed(0));
console.log('  ownedPopular:', r.recommendations.ownedPopular.map((i) => i.n + ' ' + Math.round(i.f * 100) + '%').join('; ') || 'none');
console.log('  upgrades:', r.recommendations.upgrades.slice(0, 6).map((i) => i.n + ' ' + Math.round(i.f * 100) + '%').join('; ') || 'none');

// analyzer brain matching on the seeded Meren deck
const meren = Store.state.userdecks.find((d) => d.name.includes('Meren'));
const dv = Store.deckView(meren.id);
const factMap = {};
for (const c of dv.cards) {
  const f = db.cards[Store.norm(c.n)];
  if (f) factMap[c.n.toLowerCase()] = { o: (f.oracle || '').toLowerCase(), t: (f.type_line || '').toLowerCase(), mv: f.mv || 0, ci: f.ci || '' };
}
const rep = Analyze.analyzeWithFacts({ cards: dv.cards, ci: dv.ci }, factMap);
console.log('\nANALYZER Meren deck brain matches:', (rep.brainMatches || []).map((m) => m.name + ' ' + Math.round(m.score * 100) + '%').join('; ') || 'NONE');
if (rep.brainSuggestions) {
  console.log('  missing staples (' + rep.brainSuggestions.arch + '):',
    rep.brainSuggestions.items.slice(0, 8).map((i) => i.n + ' ' + Math.round(i.f * 100) + '%' + (i.owned ? ' OWNED' : '')).join('; '));
}
console.log('\nOK');
