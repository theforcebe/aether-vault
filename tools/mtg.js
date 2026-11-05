// Research CLI. No browser state mutations, site deployment, or external writes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateAllocations, effectivePlan, allocationAudit } = require('./mtg-allocations');
const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'knowledge/collection/latest.json');
const ALLOCATIONS = path.join(ROOT, 'knowledge/collection/allocations.json');
const key = s => String(s).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const integer = (v, label, min = 1) => {
  invariant(Number.isSafeInteger(v) && v >= min, `${label} must be an integer >= ${min}`);
  return v;
};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// RFC 4180 quoting, embedded newlines, escaped double quotes, CRLF and UTF-8 BOM.
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      invariant(!cell && !closed, 'Malformed CSV quote'); quoted = true;
    } else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\r' || c === '\n') {
      row.push(cell); if (row.some(x => x !== '')) rows.push(row);
      row = []; cell = ''; closed = false;
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else { invariant(!closed, 'Unexpected text after CSV quote'); cell += c; }
  }
  invariant(!quoted, 'Unclosed CSV quote');
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

function importCollection(source) {
  const raw = fs.readFileSync(source);
  const rows = parseCsv(raw.toString('utf8'));
  invariant(rows.length > 1, 'Collection is empty');
  const header = rows.shift();
  invariant(new Set(header).size === header.length, 'Duplicate CSV headers');
  for (const h of ['Name', 'Quantity', 'Scryfall ID', 'Binder Name', 'Binder Type', 'Foil', 'Proxy'])
    invariant(header.includes(h), `Missing ManaBox header: ${h}`);
  const records = rows.map((r, i) => {
    invariant(r.length === header.length, `CSV row ${i + 2}: wrong column count`);
    const o = Object.fromEntries(header.map((h, j) => [h, r[j]]));
    invariant(o.Name.trim(), `CSV row ${i + 2}: missing card name`);
    invariant(/^\d+$/.test(o.Quantity), `CSV row ${i + 2}: invalid quantity`);
    invariant(['true', 'false'].includes(o.Proxy.toLowerCase()), `CSV row ${i + 2}: invalid proxy flag`);
    invariant(['normal', 'foil', 'etched'].includes(o.Foil), `CSV row ${i + 2}: unknown finish`);
    return { name: o.Name, quantity: integer(Number(o.Quantity), 'Quantity'),
      scryfallId: o['Scryfall ID'] || null, set: o['Set code'], collectorNumber: o['Collector number'],
      finish: o.Foil, binder: o['Binder Name'], binderType: o['Binder Type'],
      proxy: o.Proxy.toLowerCase() === 'true', language: o.Language, condition: o.Condition };
  });
  return { schemaVersion: 1, source: path.resolve(source), sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    importedAt: new Date().toISOString(), rowCount: records.length,
    totalQuantity: records.reduce((s, r) => s + r.quantity, 0),
    uniqueNames: new Set(records.map(r => key(r.name))).size, records };
}

function saveCollection(source, output = BASELINE) {
  const snapshot = importCollection(source);
  const archive = path.join(path.dirname(path.resolve(output)), 'snapshots');
  fs.mkdirSync(archive, { recursive: true });
  const rawSnapshot = path.join(archive, snapshot.sha256 + '.csv');
  if (!fs.existsSync(rawSnapshot)) fs.copyFileSync(source, rawSnapshot, fs.constants.COPYFILE_EXCL);
  invariant(crypto.createHash('sha256').update(fs.readFileSync(rawSnapshot)).digest('hex') === snapshot.sha256, 'Snapshot copy hash mismatch');
  snapshot.rawSnapshot = rawSnapshot;
  const archivedJson = path.join(archive, snapshot.sha256 + '.json');
  if (!fs.existsSync(archivedJson)) write(archivedJson, snapshot);
  write(output, snapshot);
  return snapshot;
}

function spellbookQuery(spec) {
  const allowed = ['cards', 'identity', 'maxCards', 'resultAny', 'excludeTags', 'format', 'commander', 'bracketMax', 'priceMaxUsd'];
  for (const k of Object.keys(spec)) invariant(allowed.includes(k), `Unsupported Spellbook option: ${k}`);
  const text = (s, label) => { invariant(typeof s === 'string' && s.trim() && !/[\r\n\u0000-\u001f]/.test(s), `Invalid ${label}`); return JSON.stringify(s.trim()); };
  const array = (a, label) => { invariant(Array.isArray(a), `${label} must be an array`); return a; };
  const terms = [];
  if (spec.cards) for (const name of array(spec.cards, 'cards')) terms.push(`card=${text(name, 'card name')}`);
  if (spec.identity !== undefined) {
    invariant(typeof spec.identity === 'string' && /^(?:[wubrg]+|c)$/i.test(spec.identity), 'Use WUBRG letters or c for identity');
    const id = spec.identity.toLowerCase();
    invariant(new Set(id).size === id.length, 'Duplicate identity color'); terms.push(`ci<=${id}`);
  }
  if (spec.maxCards !== undefined) terms.push(`cards<=${integer(spec.maxCards, 'maxCards')}`);
  if (spec.resultAny) {
    const parts = array(spec.resultAny, 'resultAny').map(r => `result:${text(r, 'result')}`);
    if (parts.length) terms.push(`(${parts.join(' OR ')})`);
  }
  const formats = ['commander', 'pauper_commander', 'pauper_commander_main', 'oathbreaker', 'predh', 'standard_brawl', 'brawl', 'competitive_brawl', 'alchemy', 'vintage', 'legacy', 'modern', 'premodern', 'pioneer', 'standard', 'pauper'];
  if (spec.format !== undefined) { invariant(formats.includes(spec.format), 'Unsupported format'); terms.push(`legal:${spec.format}`); }
  if (spec.commander !== undefined) terms.push(`commander=${text(spec.commander, 'commander')}`);
  if (spec.excludeTags) for (const tag of array(spec.excludeTags, 'excludeTags')) {
    invariant(['preview', 'commander', 'featured', 'reserved', 'hulkline', 'gamechanger', 'tutor', 'extraturn', 'winning', 'lock', 'mld'].includes(tag), `Unsupported tag: ${tag}`);
    terms.push(`-is:${tag}`);
  }
  if (spec.bracketMax !== undefined) {
    integer(spec.bracketMax, 'bracketMax'); invariant(spec.bracketMax <= 5, 'bracketMax must be <= 5');
    terms.push(`bracket<=${spec.bracketMax}`);
  }
  if (spec.priceMaxUsd !== undefined) {
    invariant(typeof spec.priceMaxUsd === 'number' && Number.isFinite(spec.priceMaxUsd) && spec.priceMaxUsd >= 0, 'Invalid priceMaxUsd');
    terms.push(`price<=${spec.priceMaxUsd}`);
  }
  invariant(terms.length, 'Query needs at least one filter');
  const query = terms.join(' AND ');
  return { query, url: 'https://commanderspellbook.com/search/?q=' + encodeURIComponent(query),
    syntaxSource: 'https://commanderspellbook.com/syntax-guide/', syntaxReviewed: '2026-10-24' };
}

function validatePlan(plan) {
  invariant(plan && Array.isArray(plan.cards) && plan.cards.length, 'Plan needs a nonempty cards array');
  const seen = new Set();
  for (const c of plan.cards) {
    invariant(typeof c.name === 'string' && c.name.trim(), 'Every card needs a name');
    integer(c.quantity, 'Card quantity');
    invariant(!seen.has(key(c.name)), `Combine duplicate card quantities: ${c.name}`); seen.add(key(c.name));
    invariant(['normal', 'foil', 'etched'].includes(c.finish || 'normal'), 'Unsupported finish');
    if (c.scryfallId) invariant(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.scryfallId), 'Invalid printing ID');
  }
  for (const field of ['excludeBinders', 'excludedBinderTypes']) if (plan[field] !== undefined)
    invariant(Array.isArray(plan[field]) && plan[field].every(s => typeof s === 'string'), `${field} must be a string array`);
  invariant(plan.reserved === undefined || Array.isArray(plan.reserved), 'reserved must be an array');
  for (const r of plan.reserved || []) { invariant(typeof r.name === 'string' && r.name.trim(), 'Reservation needs a name'); integer(r.quantity, 'Reservation quantity', 0); }
}

function inventoryFor(names, snapshot, plan) {
  const namesSet = new Set(names.map(key));
  const excluded = new Set((plan.excludeBinders || []).map(key));
  const types = new Set((plan.excludedBinderTypes || ['deck']).map(key));
  const records = snapshot.records.filter(r => namesSet.has(key(r.name)));
  const accessibleBinders = new Set((plan.allocationContext?.accessibleBinders || []).map(key));
  const eligible = r => !r.proxy && !excluded.has(key(r.binder)) && (!types.has(key(r.binderType)) || accessibleBinders.has(key(r.binder)));
  const totalOwned = records.filter(r => !r.proxy).reduce((s, r) => s + r.quantity, 0);
  const eligibleOwned = records.filter(eligible).reduce((s, r) => s + r.quantity, 0);
  const reserved = (plan.reserved || []).filter(r => namesSet.has(key(r.name))).reduce((s, r) => s + r.quantity, 0);
  const usedInDecks = (plan.allocationContext?.deckAllocations || []).map(d => ({ deckId: d.id, deckName: d.name,
    quantity: d.mode === 'binder' ? records.filter(r => !r.proxy && key(r.binder) === key(d.binder)).reduce((s, r) => s + r.quantity, 0) :
      d.cards.filter(c => namesSet.has(key(c.name))).reduce((s, c) => s + c.quantity, 0),
    accessibleForPlan: d.accessibleForPlan, status: d.status })).filter(d => d.quantity > 0);
  return { totalOwned, eligibleOwned, reserved, available: Math.max(0, eligibleOwned - reserved),
    proxyQuantity: records.filter(r => r.proxy).reduce((s, r) => s + r.quantity, 0),
    usedInDecks,
    copiesInOtherDecks: usedInDecks.filter(d => !d.accessibleForPlan).reduce((s, d) => s + d.quantity, 0),
    locations: [...new Set(records.map(r => r.binder))].map(binder => ({ binder,
      ownedQuantity: records.filter(r => r.binder === binder && !r.proxy).reduce((s, r) => s + r.quantity, 0),
      eligibleQuantity: records.filter(r => r.binder === binder && eligible(r)).reduce((s, r) => s + r.quantity, 0) })) };
}

function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  invariant(/^\d+(?:\.\d{1,2})?$/.test(String(value)), `Unexpected USD price: ${value}`);
  const [whole, decimal = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
function selectPrinting(cards, finish = 'normal') {
  const priceField = { normal: 'usd', foil: 'usd_foil', etched: 'usd_etched' }[finish];
  invariant(priceField, 'Unsupported finish');
  return cards.filter(c => (c.games || []).includes('paper') && (c.finishes || []).includes(finish === 'normal' ? 'nonfoil' : finish) && c.lang === 'en')
    .map(card => ({ card, unitCents: cents(card.prices?.[priceField]) }))
    .filter(x => x.unitCents !== null).sort((a, b) => a.unitCents - b.unitCents || a.card.id.localeCompare(b.card.id))[0] || null;
}

function makeApi(fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  let last = 0;
  return async function api(url, options = {}) {
    const target = new URL(url, 'https://api.scryfall.com');
    invariant(target.origin === 'https://api.scryfall.com', 'Unexpected Scryfall API host');
    for (let attempt = 0; attempt < 4; attempt++) {
      await pause(Math.max(0, last + 550 - Date.now())); last = Date.now();
      let response;
      try { response = await fetcher(target.href, { ...options,
        headers: { 'User-Agent': 'AetherVaultResearch/1.0 (local Magic collection research)', Accept: 'application/json', ...options.headers },
        signal: AbortSignal.timeout(20000) }); }
      catch (e) { if (attempt === 3) throw e; await pause(750 * (attempt + 1)); continue; }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) throw new Error(`Scryfall HTTP ${response.status}`);
        const delay = Number(response.headers.get('retry-after'));
        await pause(Math.min(10000, Math.max(1000, Number.isFinite(delay) ? delay * 1000 : 0))); continue;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(`Scryfall HTTP ${response.status}: ${data.details || data.code}`);
      invariant(!data.warnings?.length, `Scryfall query warnings: ${data.warnings?.join('; ')}`);
      return data;
    }
  };
}

async function quote(plan, snapshot, api = makeApi()) {
  validatePlan(plan);
  invariant(snapshot && snapshot.schemaVersion === 1 && Array.isArray(snapshot.records), 'Import a collection baseline first');
  const lines = [], canonicalSeen = new Set();
  for (const item of plan.cards) {
    let inventory = inventoryFor([item.name], snapshot, plan);
    const line = { requestedName: item.name, required: item.quantity, purchaseFinish: item.finish || 'normal' };
    try {
      const cardUrl = item.scryfallId ? `https://api.scryfall.com/cards/${item.scryfallId}` :
        'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(item.name);
      const card = await api(cardUrl);
      invariant(card.object === 'card' && card.oracle_id, 'No playable Oracle card resolved');
      const aliases = [card.name, ...(card.card_faces || []).map(f => f.name)];
      invariant(aliases.some(n => key(n) === key(item.name)), 'Resolved printing does not match requested name');
      invariant(!canonicalSeen.has(card.oracle_id), `Duplicate Oracle card: ${card.name}; combine aliases in the plan`);
      canonicalSeen.add(card.oracle_id);
      inventory = inventoryFor(aliases, snapshot, plan);
      Object.assign(line, { name: card.name, oracleId: card.oracle_id,
        oracle: { text: card.oracle_text || null, faces: card.card_faces || [], type: card.type_line,
          manaCost: card.mana_cost || null, manaValue: card.cmc, colorIdentity: card.color_identity,
          legalities: card.legalities, rulingsUrl: card.rulings_uri },
        cardSource: cardUrl, scryfallUrl: card.scryfall_uri });
      let printings = [card]; const printingSources = [];
      if (!item.scryfallId) {
        printings = [];
        let next = 'https://api.scryfall.com/cards/search?' + new URLSearchParams({ q: `oracleid:${card.oracle_id} game:paper lang:en`, unique: 'prints', include_variations: 'true' });
        const visited = new Set();
        while (next) {
          invariant(!visited.has(next) && visited.size < 100, 'Invalid Scryfall pagination'); visited.add(next);
          printingSources.push(next); const page = await api(next);
          invariant(Array.isArray(page.data), 'Invalid printing response'); printings.push(...page.data);
          invariant(!page.has_more || page.next_page, 'Missing next printing page');
          next = page.has_more ? page.next_page : null;
        }
      }
      // Reversible printings may store Oracle IDs on their faces, not the card.
      // Exclude these unless the top-level identity is an exact verified match.
      const matching = printings.filter(c => c.oracle_id === card.oracle_id);
      const selected = selectPrinting(matching, line.purchaseFinish);
      Object.assign(line, { status: selected ? 'priced' : 'unpriced', unitCents: selected?.unitCents ?? null,
        excludedNonmatchingPrintings: printings.length - matching.length,
        printingSources, fetchedAt: new Date().toISOString(),
        printing: selected ? { id: selected.card.id, set: selected.card.set, collectorNumber: selected.card.collector_number,
          language: selected.card.lang, finish: line.purchaseFinish, source: selected.card.scryfall_uri,
          purchaseLinks: selected.card.purchase_uris || {} } : null });
    } catch (e) { Object.assign(line, { status: 'unresolved', error: e.message, unitCents: null, fetchedAt: new Date().toISOString() }); }
    Object.assign(line, { inventory, missing: Math.max(0, item.quantity - inventory.available) });
    line.purchaseSubtotalCents = line.missing === 0 ? 0 : line.unitCents === null ? null : line.missing * line.unitCents;
    line.missingIfReusingOtherDeckCopies = Math.max(0, item.quantity - Math.min(inventory.totalOwned, inventory.available + inventory.copiesInOtherDecks));
    line.purchaseSubtotalIfReusingDeckCopiesCents = line.missingIfReusingOtherDeckCopies === 0 ? 0 : line.unitCents === null ? null : line.missingIfReusingOtherDeckCopies * line.unitCents;
    line.fullSubtotalCents = line.unitCents === null ? null : line.required * line.unitCents;
    lines.push(line);
  }
  const unresolved = lines.filter(l => l.status === 'unresolved').length;
  const unknownPurchaseLines = lines.filter(l => l.purchaseSubtotalCents === null).length;
  const purchaseComplete = unresolved === 0 && unknownPurchaseLines === 0;
  const fullComplete = lines.every(l => l.fullSubtotalCents !== null) && unresolved === 0;
  const sum = field => lines.reduce((s, l) => s + (l[field] ?? 0), 0);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), currency: 'USD',
    source: 'Scryfall current API reference prices; not verified retailer inventory or checkout quotes',
    inventory: { source: snapshot.source, sha256: snapshot.sha256, revision: snapshot.revision, updatedAt: snapshot.updatedAt, importedAt: snapshot.importedAt },
    assumptions: { excludedBinderTypes: plan.excludedBinderTypes || ['deck'], excludeBinders: plan.excludeBinders || [], reserved: plan.reserved || [],
      allocationContext: plan.allocationContext || null,
      purchaseSelection: 'Lowest priced English paper printing in requested finish; owned cards count across finishes',
      shippingAndTaxIncluded: false, conditionOrStockVerified: false },
    purchaseComplete, fullComplete, unresolvedLines: unresolved, unknownPurchaseLines,
    knownPurchaseSubtotalCents: sum('purchaseSubtotalCents'),
    purchaseTotalCents: purchaseComplete ? sum('purchaseSubtotalCents') : null,
    purchaseTotalIfReusingDeckCopiesCents: unresolved === 0 && lines.every(l => l.purchaseSubtotalIfReusingDeckCopiesCents !== null) ? sum('purchaseSubtotalIfReusingDeckCopiesCents') : null,
    fullDeckTotalCents: fullComplete ? sum('fullSubtotalCents') : null,
    rulesVerification: 'Not performed. Review current rules, rulings, deck construction, and combo prerequisites separately.', lines };
}

async function main(args) {
  const [command, file, ...rest] = args;
  if (command === '--help' || !command) {
    console.log('Commands (run from aether-vault):\n  node tools/mtg.js import <ManaBox.csv> [--out <snapshot.json>]\n  node tools/mtg.js audit [--collection <snapshot.json>]\n  node tools/mtg.js deck-save <deck.json>\n  node tools/mtg.js query <query.json>\n  node tools/mtg.js quote <plan.json> [--out <report.json>] [--collection <snapshot.json>]\nQuotes use the allocation ledger automatically. Updates archive CSV/JSON snapshots and preserve the ledger.'); return;
  }
  if (command === 'audit') {
    invariant(!file || file === '--collection', 'Usage: audit [--collection <snapshot.json>]');
    const report = allocationAudit(read(ALLOCATIONS), read(file ? rest[0] : BASELINE));
    console.log(JSON.stringify(report, null, 2)); if (report.conflicts.length || report.missingBinders.length) process.exitCode = 2; return;
  }
  invariant(file, 'Input file required');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    invariant(['--out', '--collection'].includes(rest[i]) && rest[i + 1] && !options[rest[i]], 'Unknown or malformed CLI option'); options[rest[i]] = rest[i + 1];
  }
  if (command === 'import') {
    const output = options['--out'] || BASELINE; const snapshot = saveCollection(file, output);
    console.log(JSON.stringify({ output, rawSnapshot: snapshot.rawSnapshot, rows: snapshot.rowCount, quantity: snapshot.totalQuantity, uniqueNames: snapshot.uniqueNames, sha256: snapshot.sha256,
      allocationAudit: allocationAudit(read(ALLOCATIONS), snapshot) }, null, 2));
  } else if (command === 'deck-save') {
    const deck = read(file), ledger = read(ALLOCATIONS);
    const updated = { ...ledger, decks: [...ledger.decks.filter(d => d.id !== deck.id), deck] };
    validateAllocations(updated);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(ALLOCATIONS)).digest('hex');
    write(path.join(path.dirname(ALLOCATIONS), 'allocation-history', digest + '.json'), ledger);
    write(ALLOCATIONS, updated);
    console.log(JSON.stringify(allocationAudit(updated, read(BASELINE)), null, 2));
  } else if (command === 'query') console.log(JSON.stringify(spellbookQuery(read(file)), null, 2));
  else if (command === 'quote') {
    const snapshot = read(options['--collection'] || BASELINE);
    const report = await quote(effectivePlan(read(file), read(ALLOCATIONS), snapshot), snapshot);
    if (options['--out']) write(options['--out'], report);
    console.log(JSON.stringify(options['--out'] ? { output: options['--out'], purchaseComplete: report.purchaseComplete,
      purchaseTotalCents: report.purchaseTotalCents, fullDeckTotalCents: report.fullDeckTotalCents,
      unresolvedLines: report.unresolvedLines, unknownPurchaseLines: report.unknownPurchaseLines,
      purchaseTotalIfReusingDeckCopiesCents: report.purchaseTotalIfReusingDeckCopiesCents,
      lines: report.lines.map(l => ({ name: l.name || l.requestedName, owned: l.inventory.totalOwned, available: l.inventory.available,
        usedInDecks: l.inventory.usedInDecks, missingKeepingDecksIntact: l.missing,
        missingIfReusingOtherDeckCopies: l.missingIfReusingOtherDeckCopies,
        unitCents: l.unitCents, status: l.status, error: l.error })) } : report, null, 2));
    if (!report.purchaseComplete) process.exitCode = 2;
  } else throw new Error('Unknown command: ' + command);
}

module.exports = { parseCsv, importCollection, saveCollection, spellbookQuery, validatePlan, inventoryFor, cents, selectPrinting, makeApi, quote };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
