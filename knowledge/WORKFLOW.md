# Magic working workflow

Applies to deck building, upgrades, collection research, combo discovery, play guides,
and changes to the vault's Magic logic. User constraints take precedence.

## Start with context

1. Read the relevant vault modules and deck lists. `data/manifest.js` dates the baked
   corpus; `js/rules.js` contains heuristic classifications, not a rules authority.
   The bundled collection and deck seeds are empty. Browser-local decks are not
   available from those files; use an exported list when a task needs those decks.
2. Establish format, commander(s), deck goal, budget, proxy policy, power expectations,
   and whether cards may move between decks. Infer known constraints; ask only for
   missing constraints that affect the result. Do not silently assume Commander.
3. Read `collection/latest.json`. It preserves source path, SHA-256, import timestamp,
   printing IDs, finishes, quantities, proxies, and binder locations. A later import
   replaces the snapshot, never adds its entire quantity to the old export. The
   original CSV is copied into `collection/snapshots/<sha256>.csv`, with an archived
   normalized JSON alongside it; earlier copies stay intact.
4. Check inventory across printings without losing physical quantities. Proxy cards
   do not count as owned paper cards. Deck-type binders are excluded from available
   inventory by default. Identify other committed binders with `excludeBinders` and
   unrecorded commitments with `reserved`. Reservations are additional commitments;
   do not reserve copies already excluded. Do not infer that every binder is free.

`collection/allocations.json` is independent of imports. Binder-mode decks derive their
counts from the current snapshot; list-mode decks reserve copies from the free pool.
Start with `node tools/mtg.js audit`. Resolve missing binders, overallocations, renamed
binders, unclassified locations, and inferred assignments when they affect the task.
Only Extras is initially available; nine deck-like binders are provisionally protected.
For upgrades, `targetDeckId` makes that deck's own cards available. `releaseDeckIds`
defines a separate user-requested reuse scenario. New imports preserve this ledger.
Use `deck-save <deck.json>` to add/update assembled decks or requested reservations,
with unique `id`, `name`, `mode: "binder"` plus `binder`, or `mode: "list"` plus `cards`
entries `{ "name": "Name", "quantity": 1 }`. Proposal lists do not allocate cards.

## Establish rules and legality

- Consult the current [Wizards rules](https://magic.wizards.com/en/rules),
  [format rules](https://magic.wizards.com/en/formats), and
  [ban lists](https://magic.wizards.com/en/banned-restricted-list).
  Use [Gatherer](https://gatherer.wizards.com/) for official card text and rulings;
  Scryfall supplies convenient Oracle, identity, legality, and rulings records.
- Retrieve facts during the task. Date the evidence and retain rule numbers for
  interactions. If an authoritative source is unavailable, mark the affected claim
  unresolved. A cached list, popularity rank, or model recollection cannot clear it.
- Validate total size, zones, copy exceptions, commander eligibility and pairings,
  identity (including all faces), bans/restrictions, companions, and house rules.
  The quote tool supplies card facts; it does NOT certify a deck's legality.
- Follow state-based actions, triggers, costs, targets, priority, replacement effects,
  layers, timing, summoning sickness, and opponent choices where relevant.

## Search with the correct language

Use the [Commander Spellbook syntax guide](https://commanderspellbook.com/syntax-guide/)
for combo queries and its [style guide](https://commanderspellbook.com/style-guide/)
for writing combo records. Search strings are retrieval instructions, not rules proofs.
The query builder emits a validated subset and a URL; recheck the guide when extending it.

- Quote names; `card="Name"` is exact, whereas `card:"Name"` is a substring search.
- `ci<=ub` includes narrower identities; `ci=ub` requires that exact identity.
- `cards<=3` limits component count. `mv<=3` tests a card's mana value, not setup cost.
- Group alternatives with parentheses and `OR`; join independent constraints with `AND`.
  Exclusions use `-`, not `NOT`. Add `legal:commander` only for Commander work.
- `commander=` means the combo requires that commander. For any combo compatible with
  a deck, start with its identity; requiring the commander can hide useful results.
- `pre:` does not reliably search starting mana, zones, or all starting states.
  Open the variant. Treat bracket filters as guidance, not a deck certification.

For card discovery, use [Scryfall syntax](https://scryfall.com/docs/syntax) separately.
The quote tool uses the API's exact-name lookup, then `oracleid:<id> game:paper lang:en`
with `unique=prints` to compare printings. Do not paste Spellbook syntax into Scryfall.
Inspect returned `warnings` and errors; a failed or empty query proves no rules claim.
For EDHREC or other ranking sources, use the site's documented filters and record the
selected commander, archetype, bracket, and date. Popularity supports discovery only.

## Verify combos and synergy

For each candidate, save the specific variant URL/ID, all components and template
replacements, required quantities, zones, states, starting mana, other resources,
and relevant Oracle/rulings sources. Write numbered actions with costs and triggers
in order. Trace a full iteration and its resource change before claiming repetition.
State the actual outcome, limits, opponent dependencies, and interruption windows.
Check whether the loop is optional and can legally end; mandatory loops can draw.
Distinguish finite value, repeatable engines, unbounded loops, locks, and actual wins.
Database inclusion alone does not verify the line in this deck or game state.

For recommendations, explain each card's role, relevant partners, standalone utility,
mana requirements, curve impact, resilience, and proposed cut. Support consistency
claims with stated assumptions or measured samples. Re-run legality and ownership
checks after substitutions. Use the review template; keep unknown checks unresolved.

## Get current purchase estimates

Run from the vault directory (Node 18+):

```powershell
node tools/mtg.js import "C:\Users\keane\Downloads\ManaBox_Collection (3).csv"
node tools/mtg.js query knowledge/examples/combo-query.json
node tools/spellbook.js search knowledge/examples/combo-query.json --out knowledge/reviews/combo-search.json
node tools/spellbook.js find knowledge/examples/spellbook-deck.json --out knowledge/reviews/deck-combos.json
node tools/spellbook.js bulk
node tools/spellbook.js scan knowledge/examples/collection-scan.json --out knowledge/reviews/collection-combos.json
node tools/mtg.js quote knowledge/examples/upgrade-plan.json --out knowledge/quotes/example.json
node tools/mtg.test.js
```

The example plan is a tooling demonstration, not a recommendation or purchase request.
For actual decks create a plan with one entry per card and the total quantity needed,
including commanders and already owned cards. For additions alone, use addition
quantities and reserve existing copies still required by the retained deck.

The tool fetches Scryfall exact-name card facts and all matching English paper
printings, then selects the lowest non-null USD reference price in the requested
purchase finish (`normal`, `foil`, or `etched`). An optional `scryfallId` selects a
specific printing. Owned playable copies count across finishes; a purchase finish is
a buying preference, not a requirement to replace owned cards. Different requirements
need an explicit inventory adjustment. All supplied quantities are validated.

Report required, total owned, eligible owned, reserved, available, and missing copies;
then unit estimate, finish, set/number, line subtotal, source URL, and retrieval time.
The total cost to buy everything is distinct from the cost of missing copies only.
Always show `inventory.usedInDecks`: the named decks, quantities, and assignment status
for cards already owned in use. Compare the cost keeping those decks intact with
`purchaseTotalIfReusingDeckCopiesCents`, identifying which decks would lose cards.
This is a reuse alternative, not automatic permission to dismantle another deck.
Unresolved names/API errors/unpriced lines make totals incomplete, never zero-cost.
Use integer cents for totals. Fresh retrieval does not mean the underlying market
reference price updated at that instant. Shipping, taxes, seller stock, condition,
and delivered checkout totals require retailer verification. Do not invent them.
Scryfall purchase links point toward retailers; confirm listings before calling a
price purchasable. No currency conversion is assumed; the current tool supports USD.

API calls use descriptive headers, throttling, bounded retries, and timeouts. Price
reports preserve retrieval provenance and card facts. Re-run for each new purchase
estimate; do not reuse an old report as today's quote. No account credentials needed.

## Completion evidence

Copy `templates/review.json` for substantive builds and recommendations. Record
constraints, inventory hash, search strings, live sources/dates, checks, card roles,
combo proofs, and purchase report path. Mark each required check `pass`, `fail`, or
`unresolved` with evidence. Do not label a deck fully verified while a required check
is unresolved. Summarize the actual result and limitations plainly to the user.

Keep research JSON outside the site's JS payload and browser persistence. These files
do not update the live app or deploy anything. App behavior changes require `node test.js`;
ranker changes also follow `BENCHMARKS.md`. Do not change existing heuristics merely
to make their output match a preferred result.
