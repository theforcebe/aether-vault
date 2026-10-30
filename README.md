# Aether Vault

A buildless collection and deck workbench. The existing Commander builder, analysis,
pilot guides, price history, backups, and optional sync remain available.

## Run locally

Use Node.js 18 or newer. On Windows, open `Open Workbench.cmd`. Alternatively:

```sh
node tools/workbench-server.js
```

Open `http://127.0.0.1:8787/#/workbench`. The server binds to loopback, serves only
the app assets, and rejects cross-origin API calls. It requires no npm packages.

The local companion can read the private saved ManaBox baseline and allocation
ledger, cache full Scryfall facts and price observations, compare purchase printings,
and retrieve Commander Spellbook combinations. Without a saved baseline, import a
ManaBox CSV using the existing Data page or the local Workbench collection dialog.
Collection research commands and allocation details are in `knowledge/WORKFLOW.md`.

GitHub Pages runs the browser-only app. It uses the collection and decks in that
browser. Its combo button opens the official Spellbook finder with the deck already
filled in: Spellbook does not permit cross-origin browser requests from GitHub Pages.
The local companion displays results directly inside Interactions.

## Deck formats

Choose **New deck → Commander or Standard** in Workbench or Decks. Standard supports:

- At least 60 main-deck cards and at most 15 sideboard cards (paper Standard).
- Four copies combined across main and sideboard, with basic-card and Oracle-text exceptions.
- Current Scryfall Standard legality, including sideboard cards, bans, and rotation.
- No commander requirement or commander color restriction.
- Standard-legal filtering and format-aware owned alternatives in Workbench.
- Sideboard-aware collection checks, quotes, imports, exports, backups, and deck copies.

Use **Refresh Standard legality** in Decks or **Refresh card facts** in Workbench.
Missing/stale facts remain unresolved. Checks are preliminary; companion conditions,
unusual deck restrictions, and tournament rules still need review. References:
[official Standard rules](https://magic.wizards.com/en/formats/standard) and
[current bans](https://magic.wizards.com/en/banned-restricted-list).

Legacy decks without a format continue to use Commander. Changing a Workbench deck
to Standard moves command-zone cards into the main deck without discarding copies.
The Commander analysis, completion, and pilot tools are not applied to Standard.

## Workbench

Search owned names and Oracle text, filter printings and effects, drag or add cards,
compare owned alternatives, and review card art and quantity coverage. Standard has
an **Add or drag cards into** selector and inspector controls to move individual
copies between main and sideboard. Imports recognize plain and commented section
headers, including `// Commanders` and `// Sideboard`.

**Find deck combinations** runs independently of Scryfall indexing and purchase
quotes. It displays progress, no-match results, and recoverable errors beside the
button. Results preserve prerequisites, component quantities, starting state, steps,
and source links. Spellbook discoveries are candidates, not verified rules proofs.
Only the main deck and command zone are searched; sideboard cards are excluded.

Workbench drafts have their own Backup button and do not alter physical allocations.
**Copy to Decks** and **Open working copy** preserve format and sideboard. Those are
separate copies. Existing Decks backups and configured sync include the saved format
and sideboard. A browser origin has its own storage: use backups to transfer data
between GitHub Pages and localhost.

## Privacy and checks

`knowledge/collection`, `knowledge/cache`, `knowledge/quotes`, and `knowledge/reviews`
are private, ignored working data. Do not commit them or include them in a site build.
The bundled collection/deck seeds remain empty. Prices are Scryfall reference estimates;
unpriced Standard cards are shown as unknown rather than free.

```sh
node test.js
node tools/mtg.test.js
node tools/workbench.test.js
node tools/standard.test.js
```

Responsive QA covers 320, 390, 768, and 1440 pixel widths, with separate list prices,
contained focus outlines, touch controls, and row-safe card previews.
