---
name: mtg-deckbuilder
description: Build and upgrade Magic Commander decks from Keane's changing ManaBox collection, using Aether Vault context, full Commander Spellbook combo data, current Oracle and legality evidence, deck allocations, and live Scryfall purchase estimates. Use for collection updates, deck planning, synergy and combo research, and upgrade recommendations.
---

# Collection-aware Magic deckbuilding

Use the user's current collection to build coherent decks for their commander,
budget, power goals, and playgroup. Distinguish free copies from copies in other decks,
and offer useful upgrades with current prices. Optimize for the stated goal; do not
claim a mathematically best deck or force competitive combos into casual requests.

## Local context and tools

Read [config.json](references/config.json) to locate the user's vault. Then read its
`AGENTS.md` and `knowledge/WORKFLOW.md`. The vault is an intentional dependency of this
personal skill. Its collection data and tools are maintained there; the skill remains
stable when the source CSV filename or its contents changes. If the vault moves,
update the config path, not every instruction or snapshot.

Run the launcher with Node 18+:

```powershell
node <skill-directory>/scripts/run.js mtg --help
node <skill-directory>/scripts/run.js spellbook --help
```

Use the actual installed skill directory. Tools run from the configured vault root;
pass user input paths as absolute paths. Scripts do not update the live website.

## Collection updates and existing decks

- On a new export, run `mtg import <absolute-csv-path>`. This validates the export,
  copies its exact bytes into an immutable hash-named snapshot, updates `latest.json`,
  and audits the independent allocation ledger. Replacement exports never add their
  quantities on top of the previous export. A malformed import leaves the baseline intact.
- Start work from the current snapshot and `mtg audit`. Collection size and card names
  are data, never hardcoded into this skill. New binders and missing deck binders are
  surfaced for reconciliation; imports never discard deck assignments.
- `knowledge/collection/allocations.json` tracks deck-bound binders or explicit deck
  lists. Initial deck names are inferred and labeled as such. Only Extras is initially
  treated as free. Resolve unclassified locations using user context.
- `mtg deck-save <deck.json>` records an assembled deck or an explicitly requested
  reservation. A proposed list alone does not commit physical cards. Use binder mode
  when the deck's physical copies already occupy a named binder; list mode reserves
  copies from the free inventory. Do not represent the same copies in both modes.
- For an existing-deck upgrade, set `targetDeckId` on the quote plan. Its cards become
  usable for that deck; other decks stay protected. `releaseDeckIds` is an explicit
  borrowing scenario, never a default assumption. Copy quantities, not presence alone,
  determine whether two decks can coexist.

## Build, research, and validate

Read [deck-design.md](references/deck-design.md) when building or substantially tuning
a deck. Use relevant vault context, not its baked heuristic scores as rules evidence.
Use current official rules/ban lists and live Oracle/rulings for actual verification.

- Search: `spellbook search <query.json> --out <report.json>` validates structured
  query syntax through the site's explanation endpoint and preserves full variants.
- Existing deck: `spellbook find <deck.json> --out <report.json>` discovers included
  and almost-included combos. The documented JSON has `main` and `commanders` arrays
  of `{ "card": "Name", "quantity": 1 }`.
- Whole collection: `spellbook bulk` caches the official complete variant dataset;
  `spellbook scan <constraints.json> --out <report.json>` compares it with available
  inventory. Supply identity and optionally targetDeckId, releaseDeckIds, maxMissing.
  Refresh the cache for new collection-wide research when it is over 7 days old, or
  when new cards/changed interactions matter. Check the bulk build timestamp too.
- Use the full named components, quantities, template requirements, commander flags,
  starting zones/states/mana, prerequisites, steps, results, and legality metadata.
  A scan candidate is not a verified combo. Resolve templates and aliases and prove
  the actual line under current rules before recommending it as functional.
- Consult [API usage](references/api-usage.md) when extending searches, fetching specific
  variants/rulings, or working beyond the scripts' supported query subset.

## Price and present useful choices

Run `mtg quote <plan.json> --out <report.json>` for each real upgrade estimate. Plan
`cards` entries use `{ "name": "Name", "quantity": 1 }`, optional finish/scryfallId;
quantities represent the full needed quantity. The tool automatically uses current
collection and allocations, resolves exact card facts, and prices paper printings.

For every recommended card, explicitly show how many copies are free and which named
decks contain additional owned copies. Even when buying is recommended to preserve
other decks, tell the user that the card is already owned and can be moved. Include
quantities and distinguish inferred deck assignments. Never hide usable owned cards
behind a generic "missing" label. Compare purchase costs keeping decks intact with
the alternative of reusing copies, explaining which decks would lose those cards.

Give concrete adds/cuts, roles and partners, a playable mana base, verified combo lines,
and a plain-language plan. Show upgrade unit/line/total estimates with printing/finish,
USD, date, and sources. Unknown prices stay unknown; retailer stock, shipping, tax, and
condition need separate verification. Persist substantive evidence using the vault's
review template. Ask only for choices that materially change the build.
