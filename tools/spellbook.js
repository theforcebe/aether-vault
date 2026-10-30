'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { indexBulk, readIndex, saveCompressedBody } = require('./mtg-bulk');
const { spellbookQuery, inventoryFor } = require('./mtg');
const { effectivePlan } = require('./mtg-allocations');
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'knowledge/cache/spellbook.json');
const key = s => String(s).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const check = (c, m) => { if (!c) throw new Error(m); };
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
function write(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data) + '\n'); fs.renameSync(tmp, file);
}
function makeClient(fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  let last = 0;
  return async function request(url, options = {}, binary = false) {
    check(['https://backend.commanderspellbook.com', 'https://json.commanderspellbook.com'].includes(new URL(url).origin), 'Unexpected Spellbook host');
    for (let attempt = 0; attempt < 4; attempt++) {
      await pause(Math.max(0, last + 800 - Date.now())); last = Date.now();
      let res;
      try { res = await fetcher(url, { ...options, headers: { 'User-Agent': 'AetherVaultResearch/1.0', Accept: 'application/json', ...options.headers }, signal: AbortSignal.timeout(binary ? 60000 : 25000) }); }
      catch (e) { if (attempt === 3) throw e; await pause(1000 * (attempt + 1)); continue; }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 3) throw new Error('Spellbook HTTP ' + res.status);
        const delay = Number(res.headers.get('retry-after'));
        await pause(Math.min(10000, Math.max(1000, Number.isFinite(delay) ? delay * 1000 : 0))); continue;
      }
      check(res.ok, 'Spellbook HTTP ' + res.status + ': ' + (res.ok ? '' : (await res.text()).slice(0, 300)));
      return binary ? res.body : res.json();
    }
  };
}
async function search(spec, request = makeClient()) {
  const built = spellbookQuery(spec);
  const explanation = await request('https://backend.commanderspellbook.com/explain-query?' + new URLSearchParams({ q: built.query }));
  const source = 'https://backend.commanderspellbook.com/variants?' + new URLSearchParams({ q: built.query, limit: '25' });
  const page = await request(source);
  check(Array.isArray(page.results), 'Unexpected variant response');
  return { ...built, source, fetchedAt: new Date().toISOString(), explanation,
    next: page.next, variants: page.results, verification: 'Candidates only; includes full template and prerequisite records.' };
}
function deckPayload(deck) {
  check(Array.isArray(deck.main) && deck.main.length <= 600 && Array.isArray(deck.commanders || []) && (deck.commanders || []).length <= 12, 'Deck JSON needs main (<=600) and optional commanders (<=12) arrays');
  const entries = list => list.map(c => {
    check(typeof c.card === 'string' && c.card.trim() && c.card.length <= 256, 'Deck card needs a name in card');
    check(Number.isSafeInteger(c.quantity ?? 1) && (c.quantity ?? 1) > 0, 'Invalid deck quantity');
    return { card: c.card, quantity: c.quantity ?? 1 };
  });
  return { main: entries(deck.main), commanders: entries(deck.commanders || []) };
}
async function find(deck, request = makeClient()) {
  const source = 'https://backend.commanderspellbook.com/find-my-combos?limit=25';
  const page = await request(source, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deckPayload(deck)) });
  check(page.results && Array.isArray(page.results.included), 'Unexpected deck combo response');
  return { source, fetchedAt: new Date().toISOString(), ...page,
    verification: 'Discovery only. Inspect templates, starting zones, mana, state, commander requirements, and actual sequence.' };
}
async function bulk(request = makeClient()) {
  const source = 'https://json.commanderspellbook.com/variants.json.gz';
  const body = await request(source, {}, true);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const rawPath = path.join(path.dirname(CACHE), 'spellbook.full.json.gz');
  const rawTmp = rawPath + '.tmp'; await saveCompressedBody(body, rawTmp);
  const data = await indexBulk(rawTmp, path.join(path.dirname(CACHE), 'spellbook.variants.jsonl'), path.join(path.dirname(CACHE), 'spellbook.aliases.jsonl'));
  fs.renameSync(rawTmp, rawPath); data.rawPath = rawPath;
  return { ...data, source, fetchedAt: new Date().toISOString() };
}
function scan(spec, data, snapshot, ledger) {
  check(typeof spec.identity === 'string' && /^(?:[wubrg]+|c)$/i.test(spec.identity), 'Scan needs identity using WUBRG letters or c');
  const maxMissing = spec.maxMissing ?? 1; check(Number.isSafeInteger(maxMissing) && maxMissing >= 0 && maxMissing <= 3, 'maxMissing must be 0..3');
  const plan = effectivePlan({ cards: [], targetDeckId: spec.targetDeckId, releaseDeckIds: spec.releaseDeckIds }, ledger, snapshot);
  const identity = new Set(spec.identity.toUpperCase().replace('C', ''));
  const eligible = new Map();
  for (const name of new Set(snapshot.records.map(r => r.name))) eligible.set(key(name), inventoryFor([name], snapshot, plan).available);
  const candidates = [];
  for (const v of data.variants) {
    if (!v.legalities?.commander || v.spoiler || v.status !== 'OK' || [...v.identity.replace('C', '')].some(c => !identity.has(c))) continue;
    const missing = [];
    for (const component of v.uses || []) {
      const count = Math.max(0, component.quantity - (eligible.get(key(component.card.name)) || 0));
      if (count) missing.push({ name: component.card.name, quantity: count });
    }
    if (missing.reduce((s, c) => s + c.quantity, 0) > maxMissing) continue;
    candidates.push({ variantId: v.id, url: 'https://commanderspellbook.com/combo/' + v.id + '/', missing,
      unresolvedTemplates: (v.requires || []).map(t => ({ name: t.template.name, quantity: t.quantity, scryfallQuery: t.template.scryfallQuery })),
      requiredCommanders: [...(v.uses || []).filter(c => c.mustBeCommander).map(c => c.card.name), ...(v.requires || []).filter(c => c.mustBeCommander).map(c => c.template.name)],
      namedComponents: (v.uses || []).map(c => ({ name: c.card.name, quantity: c.quantity })),
      results: (v.produces || []).map(p => p.feature.name), popularity: v.popularity || 0,
      verification: 'Candidate only; templates, face aliases, commander eligibility, rules, prerequisites, and price still require checking.' });
  }
  candidates.sort((a, b) => a.missing.reduce((s, c) => s + c.quantity, 0) - b.missing.reduce((s, c) => s + c.quantity, 0) || b.popularity - a.popularity);
  return { generatedAt: new Date().toISOString(), bulkFetchedAt: data.fetchedAt, bulkTimestamp: data.timestamp,
    inventoryHash: snapshot.sha256, allocationContext: plan.allocationContext, candidateCount: candidates.length,
    candidates: candidates.slice(0, 50), note: 'Limited to 50 discovery candidates, sorted by missing copies then popularity. Popularity is not a deck-quality score.' };
}
async function main(args) {
  const [command, file, ...rest] = args;
  if (!command || command === '--help') { console.log('node tools/spellbook.js search <query.json> [--out report.json]\nnode tools/spellbook.js find <deck.json> [--out report.json]\nnode tools/spellbook.js bulk [--out cache.json]\nnode tools/spellbook.js scan <constraints.json> [--out report.json]\nSearch/find return one page plus next; bulk uses the official whole-dataset download. Scan uses current collection and allocations.'); return; }
  let input = file, options = rest;
  if (command === 'bulk') { options = file ? [file, ...rest] : []; input = null; }
  let output;
  if (options.length) { check(options.length === 2 && options[0] === '--out', 'Expected --out <file>'); output = options[1]; }
  let result;
  if (command === 'search') result = await search(read(input));
  else if (command === 'find') result = await find(read(input));
  else if (command === 'bulk') { result = await bulk(); output ||= CACHE; }
  else if (command === 'scan') {
    check(fs.existsSync(CACHE), 'Run bulk once to cache the full dataset first');
    const cache = read(CACHE);
    result = scan(read(input), { ...cache, variants: readIndex(cache.indexPath) }, read(path.join(ROOT, 'knowledge/collection/latest.json')), read(path.join(ROOT, 'knowledge/collection/allocations.json')));
  } else throw new Error('Unknown Spellbook command');
  if (output) { write(output, result); console.log(JSON.stringify({ output, fetchedAt: result.fetchedAt, variants: result.variantCount ?? result.variants?.length, aliases: result.aliasCount, candidateCount: result.candidateCount, next: result.next }, null, 2)); }
  else console.log(JSON.stringify(result, null, 2));
}
module.exports = { makeClient, search, deckPayload, find, bulk, scan };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
