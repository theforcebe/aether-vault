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

## Card versions and prices

Collection shows each printing and finish separately, with its set, collector
number, foil/non-foil/etched finish, matching art, and unit price. Set and finish
filters also constrain quantities. Full set names and treatment labels (such as
borderless or showcase) appear when printing metadata is available; Refresh prices
retrieves it. Clicking a Collection row opens that exact printing.

In Workbench, click **owned versions · choose** or a deck entry. Select a version
to preview its art, finish-specific price/history, owned quantity, and binders.
Adding or dragging a binder card keeps the displayed version. For an existing deck
entry, **Use for these copies** saves the choice; changing only part of its quantity
splits the entry so foil and non-foil copies can coexist. Undo, browser persistence,
Workbench JSON backups, and copies to/from Decks retain those selections. Plain text
decklists describe playable cards; use JSON backups to transfer exact selections.
Older and imported decklists remain explicitly unassigned until a version is chosen.

**Collection check → Exact selected versions** values the saved printings and
estimates the cost of versions not owned, including Standard sideboards. Owned counts
include protected decks. The separate playable-copy check respects allocations and
quotes cheapest paper printings, which may differ from the chosen versions.
**Refresh selected-version prices** fetches current data for selected printing IDs.
Missing finish prices remain **Unknown**; they never fall back to another finish
or another printing. USD references exclude condition, language premiums, shipping,
tax, and stock verification. Draft selections do not reserve or move physical cards.

## Adding cards to your collection

Use **Collection → Add cards**, or **Add cards to collection** in Workbench.
Search a card name, optionally enter a set code, and choose the printing by its
artwork, full set name, and collector number. Choose a supported non-foil, foil,
or etched finish, quantity, binder, and condition. **Queue this version** lets you
continue searching and add several different cards or editions in one batch.
The queue shows the price for each selected finish; missing prices stay unpriced.
**Add cards to collection** saves the batch and updates Collection and Workbench.
Closing the dialog retains your queue. Repeated save requests do not add a batch twice.
The Decks **Bought** actions also open this edition picker before adding inventory.

The **Active collection** selector on Collection is shared with Workbench:

- **Collection on this computer** uses the local companion's saved ManaBox baseline.
  Additions update `knowledge/collection/latest.json`, with an immutable copy of the
  previous JSON in `knowledge/collection/snapshots`. Original CSV archives, their
  source hash, and `allocations.json` stay intact. Manual additions have their own
  revision and receipt history. This local inventory is not sent through browser sync.
- **Browser collection** saves to the existing browser collection and its backup/sync
  settings. It works on the hosted site too. Your separate browser inventory is retained
  when you view the collection on this computer.
- **Workbench upload** edits a loaded Workbench CSV override and saves it in Workbench
  backups. It leaves the saved collection on this computer intact.

**Export collection CSV** downloads the active, updated collection with printing IDs,
finishes, quantities, locations, languages, and conditions. Keep this export when moving
between devices. A later full ManaBox import replaces its destination; make sure new
manual additions are in that export first. Browser CSV uploads select the browser source;
Workbench CSV uploads select the Workbench source. Free/protected binder rules continue
to apply to new copies, and adding to a draft never changes physical ownership.

Search currently lists English paper printings. Scryfall prices are USD market references,
not condition-adjusted appraisals. Card search needs internet access; a failed save keeps
the queue for retry. If another tab updates the collection, use **Refresh collection**
in the dialog, review the queue, then save again.

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
node tools/printings.test.js
node tools/collection-additions.test.js
```

Responsive QA covers 320, 390, 768, and 1440 pixel widths, with separate list prices,
contained focus outlines, touch controls, and row-safe card previews.
