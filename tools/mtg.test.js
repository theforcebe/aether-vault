'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsv, importCollection, saveCollection, spellbookQuery, inventoryFor, cents, selectPrinting, quote, makeApi, validatePlan } = require('./mtg');
const { effectivePlan, allocationAudit, validateAllocations } = require('./mtg-allocations');
const { deckPayload, search, find, scan } = require('./spellbook');
const { Readable } = require('node:stream');
const { parseTopLevel, indexBulk, readIndex, saveCompressedBody } = require('./mtg-bulk');
const card = (overrides = {}) => ({ object: 'card', id: 'printing-one', oracle_id: 'oracle-one', name: 'Test Card',
  games: ['paper'], finishes: ['nonfoil', 'foil'], lang: 'en', prices: { usd: '2.50', usd_foil: '5.00' },
  scryfall_uri: 'https://scryfall.com/card/test/1', set: 'test', collector_number: '1',
  color_identity: ['U'], legalities: { commander: 'legal' }, ...overrides });
const snapshot = records => ({ schemaVersion: 1, source: 'fixture.csv', sha256: 'fixture', importedAt: '2026-10-24', records });
const record = overrides => ({ name: 'Test Card', quantity: 1, proxy: false, binder: 'Extras', binderType: 'binder', ...overrides });
const api = async url => url.includes('/named') ? card() : ({ data: [card()], has_more: false });

test('CSV handles BOM, commas, embedded line endings, escaped quotes, and rejects broken rows', () => {
  assert.deepEqual(parseCsv('\uFEFFA,B\r\n"a,b","x""y\r\nz"\r\n'), [['A', 'B'], ['a,b', 'x"y\r\nz']]);
  assert.throws(() => parseCsv('A\n"unfinished'), /Unclosed/);
  assert.throws(() => parseCsv('"a"bad'), /Unexpected/);
});
test('ManaBox import preserves printing/finish/quantity/proxy provenance and rejects bad quantity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-mtg-test-'));
  const file = path.join(dir, 'fixture.csv');
  const header = 'Name,Quantity,Scryfall ID,Binder Name,Binder Type,Foil,Proxy,Set code,Collector number,Language,Condition\n';
  try {
    fs.writeFileSync(file, header + '"Test, Card",2,id,Extras,binder,foil,false,TST,1,en,near_mint\n');
    const data = importCollection(file);
    assert.equal(data.totalQuantity, 2); assert.equal(data.records[0].finish, 'foil');
    assert.equal(data.records[0].name, 'Test, Card'); assert.equal(data.sha256.length, 64);
    fs.writeFileSync(file, header + 'Name,-1,id,Extras,binder,normal,false,TST,1,en,near_mint\n');
    assert.throws(() => importCollection(file), /quantity/i);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
test('Spellbook builder quotes injection-like names and groups OR constraints', () => {
  const result = spellbookQuery({ cards: ['Name "quoted" (test)'], identity: 'ub', maxCards: 3,
    resultAny: ['Infinite mana', 'Win the game'], excludeTags: ['lock'], format: 'commander' });
  assert.match(result.query, /card="Name \\"quoted\\" \(test\)"/);
  assert.ok(result.query.includes('ci<=ub AND cards<=3 AND (result:"Infinite mana" OR result:"Win the game")'));
  assert.equal(new URL(result.url).searchParams.get('q'), result.query);
  assert.throws(() => spellbookQuery({ maxCards: 1.5 }), /integer/);
  assert.throws(() => spellbookQuery({ identity: 'u OR banned' }), /identity/);
  assert.throws(() => spellbookQuery({ invented: true }), /Unsupported/);
});
test('Inventory excludes proxies, committed binders and reservations without negative availability', () => {
  const data = snapshot([record({ quantity: 4 }), record({ quantity: 10, proxy: true }),
    record({ quantity: 2, binder: 'Deck A', binderType: 'deck' }), record({ quantity: 3, binder: 'Keep' })]);
  const result = inventoryFor(['Test Card'], data, { excludeBinders: ['Keep'], reserved: [{ name: 'Test Card', quantity: 1 }] });
  assert.equal(result.totalOwned, 9); assert.equal(result.eligibleOwned, 4); assert.equal(result.available, 3);
  assert.equal(result.proxyQuantity, 10);
  assert.equal(inventoryFor(['Test Card'], data, { reserved: [{ name: 'Test Card', quantity: 100 }] }).available, 0);
});
test('Prices use exact cents, preserve unknown, and select paper/English/correct finish', () => {
  assert.equal(cents('0.29'), 29); assert.equal(cents('0.00'), 0); assert.equal(cents(null), null);
  assert.throws(() => cents('1.001'), /Unexpected/);
  const cards = [card(), card({ id: 'cheap', prices: { usd: '0.99', usd_foil: null } }),
    card({ id: 'digital', games: ['mtgo'], prices: { usd: '0.01' } }),
    card({ id: 'foreign', lang: 'ja', prices: { usd: '0.02' } })];
  assert.equal(selectPrinting(cards).card.id, 'cheap');
  assert.equal(selectPrinting(cards, 'foil').unitCents, 500);
  assert.equal(selectPrinting(cards, 'etched'), null);
});
test('Quote buys only missing copies and separates full value from purchase subtotal', async () => {
  const report = await quote({ cards: [{ name: 'Test Card', quantity: 3 }], reserved: [{ name: 'Test Card', quantity: 1 }] }, snapshot([record({ quantity: 2 })]), api);
  assert.equal(report.lines[0].missing, 2); assert.equal(report.purchaseTotalCents, 500);
  assert.equal(report.fullDeckTotalCents, 750); assert.equal(report.lines[0].oracle.legalities.commander, 'legal');
  assert.equal(report.assumptions.shippingAndTaxIncluded, false);
});
test('API failure and missing price cannot produce a complete purchase total', async () => {
  const plan = { cards: [{ name: 'Test Card', quantity: 1 }] };
  const failed = await quote(plan, snapshot([]), async () => { throw new Error('Offline'); });
  assert.equal(failed.purchaseTotalCents, null); assert.equal(failed.unresolvedLines, 1);
  const unpriced = await quote(plan, snapshot([]), async url => url.includes('/named') ? card() : ({ data: [card({ prices: { usd: null } })], has_more: false }));
  assert.equal(unpriced.purchaseTotalCents, null); assert.equal(unpriced.lines[0].status, 'unpriced');
  const owned = await quote(plan, snapshot([record()]), async url => url.includes('/named') ? card() : ({ data: [card({ prices: { usd: null } })], has_more: false }));
  assert.equal(owned.purchaseTotalCents, 0); assert.equal(owned.fullDeckTotalCents, null);
});
test('Pagination is followed before choosing cheapest printing', async () => {
  let calls = 0;
  const report = await quote({ cards: [{ name: 'Test Card', quantity: 1 }] }, snapshot([]), async url => {
    calls++; if (url.includes('/named')) return card();
    if (url.includes('page=2')) return { data: [card({ id: 'cheap', prices: { usd: '0.50' } })], has_more: false };
    return { data: [card()], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' };
  });
  assert.equal(calls, 3); assert.equal(report.purchaseTotalCents, 50);
});
test('Aliases cannot receive ownership credit twice; mismatched printing is unresolved', async () => {
  const face = card({ name: 'Front // Back', card_faces: [{ name: 'Front' }, { name: 'Back' }] });
  const report = await quote({ cards: [{ name: 'Front', quantity: 1 }, { name: 'Front // Back', quantity: 1 }] }, snapshot([record({ name: 'Front' })]), async url => url.includes('/named') ? face : ({ data: [face], has_more: false }));
  assert.equal(report.lines[0].missing, 0); assert.equal(report.purchaseTotalCents, null);
  assert.match(report.lines[1].error, /Duplicate Oracle/);
  const bad = await quote({ cards: [{ name: 'Wrong', quantity: 1 }] }, snapshot([]), api);
  assert.equal(bad.lines[0].status, 'unresolved');
});
test('Malformed quantities and duplicate plan rows are rejected before network requests', () => {
  assert.throws(() => validatePlan({ cards: [{ name: 'A', quantity: -1 }] }), /integer/);
  assert.throws(() => validatePlan({ cards: [{ name: 'A', quantity: 1 }, { name: ' a ', quantity: 1 }] }), /duplicate/i);
});
test('HTTP client retries rate limits, sends required headers, and rejects warning responses', async () => {
  let calls = 0; let headers;
  const client = makeApi(async (_url, options) => {
    headers = options.headers; calls++;
    return calls === 1 ? { status: 429, headers: new Headers() } : { status: 200, ok: true, json: async () => ({ object: 'card' }) };
  }, async () => {});
  await client('/cards/named?exact=Test'); assert.equal(calls, 2);
  assert.ok(headers['User-Agent']); assert.equal(headers.Accept, 'application/json');
  await assert.rejects(client('https://example.com/'), /host/);
  await assert.rejects(makeApi(async () => ({ status: 200, ok: true, json: async () => ({ warnings: ['ignored filter'] }) }), async () => {})('/cards/search'), /warnings/);
});
test('Collection updates archive exact bytes, replace totals, and preserve old snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-mtg-update-'));
  const source = path.join(dir, 'input.csv'), output = path.join(dir, 'latest.json');
  const header = 'Name,Quantity,Scryfall ID,Binder Name,Binder Type,Foil,Proxy\n';
  try {
    fs.writeFileSync(source, header + 'A,2,id,Extras,binder,normal,false\n');
    const first = saveCollection(source, output);
    const original = fs.readFileSync(first.rawSnapshot);
    fs.writeFileSync(source, header + 'A,5,id,Extras,binder,normal,false\n');
    const second = saveCollection(source, output);
    assert.equal(second.totalQuantity, 5); assert.notEqual(second.sha256, first.sha256);
    assert.deepEqual(fs.readFileSync(first.rawSnapshot), original);
    fs.writeFileSync(source, 'broken'); assert.throws(() => saveCollection(source, output));
    assert.equal(JSON.parse(fs.readFileSync(output)).sha256, second.sha256);
  } finally {
    // Only delete files created in this unique test directory.
    for (const file of fs.readdirSync(path.join(dir, 'snapshots'))) fs.unlinkSync(path.join(dir, 'snapshots', file));
    fs.rmdirSync(path.join(dir, 'snapshots')); fs.unlinkSync(source); fs.unlinkSync(output); fs.rmdirSync(dir);
  }
});
const ledger = () => ({ schemaVersion: 1, availableBinders: ['Extras'], decks: [
  { id: 'deck-a', name: 'Deck A', mode: 'binder', binder: 'Deck A' },
  { id: 'deck-b', name: 'Deck B', mode: 'list', cards: [{ name: 'Test Card', quantity: 1 }] }
] });
test('Deck allocations survive collection changes and expose exact donor deck quantities', async () => {
  const data = snapshot([record({ quantity: 2 }), record({ binder: 'Deck A', quantity: 1 }), record({ binder: 'Unknown', quantity: 4 })]);
  const saved = JSON.stringify(ledger());
  const plan = effectivePlan({ cards: [{ name: 'Test Card', quantity: 3 }] }, ledger(), data);
  const report = await quote(plan, data, api);
  assert.equal(report.lines[0].inventory.available, 1);
  assert.deepEqual(report.lines[0].inventory.usedInDecks.map(d => [d.deckName, d.quantity]), [['Deck A', 1], ['Deck B', 1]]);
  assert.equal(report.lines[0].missing, 2); assert.equal(report.lines[0].missingIfReusingOtherDeckCopies, 0);
  assert.equal(report.purchaseTotalCents, 500); assert.equal(report.purchaseTotalIfReusingDeckCopiesCents, 0);
  const updated = snapshot([record({ quantity: 0 }), record({ binder: 'Deck A' })]);
  assert.equal(allocationAudit(ledger(), updated).conflicts.length, 1);
  assert.equal(JSON.stringify(ledger()), saved);
});
test('Upgrading a target deck releases its own copies only, even with deck-type binders', () => {
  const data = snapshot([record({ binder: 'Deck A', binderType: 'deck' }), record({ quantity: 2 })]);
  const plan = effectivePlan({ cards: [], targetDeckId: 'deck-a' }, ledger(), data);
  const counts = inventoryFor(['Test Card'], data, plan);
  assert.equal(counts.available, 2); assert.equal(counts.usedInDecks.find(d => d.deckId === 'deck-a').accessibleForPlan, true);
  assert.throws(() => effectivePlan({ targetDeckId: 'missing' }, ledger(), data), /Unknown/);
  assert.throws(() => validateAllocations({ ...ledger(), availableBinders: ['Extras', 'Deck A'] }), /freely available/);
});
test('Reversible or nonmatching printings do not corrupt normal prices', async () => {
  const report = await quote({ cards: [{ name: 'Test Card', quantity: 1 }] }, snapshot([]), async url => url.includes('/named') ? card() :
    ({ data: [card(), card({ id: 'reversible', oracle_id: undefined, prices: { usd: '0.01' } })], has_more: false }));
  assert.equal(report.purchaseTotalCents, 250); assert.equal(report.lines[0].excludedNonmatchingPrintings, 1);
});
test('Spellbook requests preserve full variants, explanation and near-combo categories', async () => {
  const variant = { id: '1-2', requires: [{ template: { name: 'Extra permanent' } }], notablePrerequisites: 'Start condition' };
  const result = await search({ cards: ['Test Card'] }, async url => url.includes('explain-query') ? { explanation: 'Exact card' } : ({ results: [variant], next: 'next' }));
  assert.deepEqual(result.variants[0].requires, variant.requires); assert.equal(result.next, 'next');
  assert.throws(() => deckPayload({ main: [{ card: 'A', quantity: 0 }] }), /quantity/);
  const found = await find({ main: [{ card: 'A' }] }, async (_url, options) => {
    assert.equal(JSON.parse(options.body).main[0].quantity, 1);
    return { results: { included: [], almostIncluded: [variant], almostIncludedByAddingColors: [variant] }, next: null };
  });
  assert.equal(found.results.almostIncluded.length, 1); assert.equal(found.results.almostIncludedByAddingColors.length, 1);
});
test('Bulk scan respects physical availability, color, quantities, templates and Commander flags', () => {
  const v = { id: '1-2', status: 'OK', identity: 'U', legalities: { commander: true }, popularity: 10,
    uses: [{ card: { name: 'Test Card' }, quantity: 2, mustBeCommander: true }],
    requires: [{ template: { name: 'A replacement', scryfallQuery: 'type:artifact' }, quantity: 1 }], produces: [] };
  const data = snapshot([record({ quantity: 2 }), record({ binder: 'Deck A' })]);
  const report = scan({ identity: 'u', maxMissing: 1 }, { variants: [v] }, data, ledger());
  assert.equal(report.candidateCount, 1); assert.equal(report.candidates[0].missing[0].quantity, 1);
  assert.equal(report.candidates[0].unresolvedTemplates[0].name, 'A replacement');
  assert.deepEqual(report.candidates[0].requiredCommanders, ['Test Card']);
  assert.equal(scan({ identity: 'g' }, { variants: [v] }, data, ledger()).candidateCount, 0);
});
test('Streaming bulk parser handles split escapes/Unicode, metadata, nested records and aliases', async () => {
  const document = { timestamp: 'now', version: 3, variants: [{ id: 'é', notes: 'text with "variants": [ and \\ and 雪', nested: [{ a: 1 }] }], aliases: [{ id: 1, variant: 'é' }], trailing: null };
  const text = JSON.stringify(document), items = {}, metadata = {};
  // One-character chunks exercise every boundary without materializing a big string.
  await parseTopLevel(Readable.from([...text]), (property, value) => { (items[property] ||= []).push(value); }, (property, value) => { metadata[property] = value; });
  assert.deepEqual(items.variants, document.variants); assert.deepEqual(items.aliases, document.aliases);
  assert.equal(metadata.version, 3); assert.equal(metadata.trailing, null);
  await assert.rejects(parseTopLevel(Readable.from(['{"variants":[{"id":1}']), () => {}, () => {}), /Truncated/);
});
test('Bulk indexes retain requirements and remove only image metadata; raw archive stays intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-bulk-test-'));
  const raw = path.join(dir, 'raw.gz'), index = path.join(dir, 'variants.jsonl'), aliases = path.join(dir, 'aliases.jsonl');
  const document = { timestamp: 42, variants: [{ id: '1', uses: [{ card: { name: 'A', imageUriFrontNormal: 'image' } }], requires: [{ quantity: 1, template: { name: 'Extra' } }] }], aliases: [{ id: 'old', variant: '1' }] };
  try {
    const compressed = require('node:zlib').gzipSync(JSON.stringify(document)); fs.writeFileSync(raw, compressed);
    const metadata = await indexBulk(raw, index, aliases);
    assert.equal(metadata.variantCount, 1); assert.equal(metadata.aliasCount, 1);
    const [variant] = [...readIndex(index)]; assert.deepEqual(variant.requires, document.variants[0].requires);
    assert.equal(variant.uses[0].card.imageUriFrontNormal, undefined);
    assert.deepEqual(fs.readFileSync(raw), compressed);
  } finally { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); fs.rmdirSync(dir); }
});
test('Bulk network downloads stay compressed whether HTTP decoding already happened or not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-bulk-download-'));
  const plain = Buffer.from('{"variants":[]}'), compressed = require('node:zlib').gzipSync(plain);
  try {
    for (const [index, bytes] of [plain, compressed].entries()) {
      const file = path.join(dir, index + '.gz');
      await saveCompressedBody(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), file);
      assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(file)), plain);
    }
  } finally { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); fs.rmdirSync(dir); }
});
