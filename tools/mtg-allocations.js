'use strict';
const key = s => String(s).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const check = (condition, message) => { if (!condition) throw new Error(message); };

function validateAllocations(ledger) {
  check(ledger?.schemaVersion === 1 && Array.isArray(ledger.decks), 'Unsupported allocation ledger');
  check(Array.isArray(ledger.availableBinders) && ledger.availableBinders.every(s => typeof s === 'string'), 'availableBinders must be a string array');
  const ids = new Set(), binders = new Set();
  for (const d of ledger.decks) {
    check(typeof d.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(d.id) && !ids.has(d.id), 'Deck IDs must be unique slugs'); ids.add(d.id);
    check(typeof d.name === 'string' && d.name.trim(), 'Deck needs a name');
    check(['binder', 'list'].includes(d.mode), 'Deck mode must be binder or list');
    if (d.mode === 'binder') {
      check(typeof d.binder === 'string' && d.binder.trim() && !binders.has(key(d.binder)), 'Deck binders must be unique');
      check(!ledger.availableBinders.some(b => key(b) === key(d.binder)), 'A deck binder cannot also be freely available');
      binders.add(key(d.binder));
    } else {
      check(Array.isArray(d.cards) && d.cards.length, 'List deck needs cards');
      const names = new Set();
      for (const c of d.cards) {
        check(typeof c.name === 'string' && c.name.trim() && !names.has(key(c.name)), 'Combine duplicate deck card names'); names.add(key(c.name));
        check(Number.isSafeInteger(c.quantity) && c.quantity > 0, 'Invalid allocated quantity');
      }
    }
  }
  return ledger;
}

function effectivePlan(plan, ledger, snapshot) {
  validateAllocations(ledger);
  const released = new Set(plan.releaseDeckIds || []);
  check(Array.isArray(plan.releaseDeckIds || []), 'releaseDeckIds must be an array');
  const ids = new Set(ledger.decks.map(d => d.id));
  if (plan.targetDeckId) check(ids.has(plan.targetDeckId), `Unknown targetDeckId: ${plan.targetDeckId}`);
  for (const id of released) check(ids.has(id), `Unknown releaseDeckId: ${id}`);
  const accessible = ledger.decks.filter(d => d.id === plan.targetDeckId || released.has(d.id));
  const freeBinders = new Set([...ledger.availableBinders, ...accessible.filter(d => d.mode === 'binder').map(d => d.binder)].map(key));
  const physicalBinders = [...new Set(snapshot.records.map(r => r.binder))];
  const excluded = physicalBinders.filter(b => !freeBinders.has(key(b)));
  const committedLists = ledger.decks.filter(d => d.mode === 'list' && !accessible.includes(d));
  return { ...plan, excludeBinders: [...new Set([...(plan.excludeBinders || []), ...excluded])],
    reserved: [...(plan.reserved || []), ...committedLists.flatMap(d => d.cards)],
    allocationContext: { targetDeckId: plan.targetDeckId || null, releasedDeckIds: [...released],
      deckAllocations: ledger.decks.map(d => ({ id: d.id, name: d.name, mode: d.mode, binder: d.binder,
        cards: d.mode === 'list' ? d.cards : undefined, accessibleForPlan: accessible.includes(d), status: d.status || 'recorded' })),
      accessibleBinders: accessible.filter(d => d.mode === 'binder').map(d => d.binder),
      unclassifiedBinders: physicalBinders.filter(b => !ledger.availableBinders.some(f => key(f) === key(b)) && !ledger.decks.some(d => d.mode === 'binder' && key(d.binder) === key(b))),
      protectedDecks: ledger.decks.filter(d => !accessible.includes(d)).map(d => ({ id: d.id, name: d.name, mode: d.mode, status: d.status || 'recorded' })) } };
}

function allocationAudit(ledger, snapshot) {
  const plan = effectivePlan({ cards: [] }, ledger, snapshot);
  const excluded = new Set(plan.excludeBinders.map(key));
  const available = new Map(), reservations = new Map();
  for (const r of snapshot.records) if (!r.proxy && !excluded.has(key(r.binder)) && key(r.binderType) !== 'deck')
    available.set(key(r.name), (available.get(key(r.name)) || 0) + r.quantity);
  for (const c of plan.reserved) reservations.set(key(c.name), (reservations.get(key(c.name)) || 0) + c.quantity);
  const conflicts = [...reservations].filter(([name, count]) => count > (available.get(name) || 0))
    .map(([name, reserved]) => ({ name, reserved, eligibleOwned: available.get(name) || 0 }));
  const missingBinders = ledger.decks.filter(d => d.mode === 'binder' && !snapshot.records.some(r => key(r.binder) === key(d.binder))).map(d => d.binder);
  return { schemaVersion: 1, inventoryHash: snapshot.sha256, conflicts, missingBinders,
    unclassifiedBinders: plan.allocationContext.unclassifiedBinders,
    provisionalDecks: ledger.decks.filter(d => d.status === 'inferred').map(d => d.name),
    decks: ledger.decks.map(d => ({ id: d.id, name: d.name, mode: d.mode,
      quantity: d.mode === 'binder' ? snapshot.records.filter(r => !r.proxy && key(r.binder) === key(d.binder)).reduce((s, r) => s + r.quantity, 0) : d.cards.reduce((s, c) => s + c.quantity, 0) })) };
}
module.exports = { validateAllocations, effectivePlan, allocationAudit };
