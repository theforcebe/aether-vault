# Aether Vault working instructions

For all Magic work, read `knowledge/WORKFLOW.md` before recommending cards,
building decks, explaining interactions, or estimating upgrade costs.

- Collection baseline: `knowledge/collection/latest.json`, imported from the user's
  `Downloads/ManaBox_Collection (3).csv`. Refresh when a newer export is provided.
- Project context: `ROADMAP.md`, `BENCHMARKS.md`, `js/rules.js`, `js/builder.js`,
  `js/analyze.js`, `js/pilot.js`, and relevant `data/` files. Baked facts are historical.
- Run `node tools/mtg.js --help` for collection import, Spellbook search construction,
  live Oracle/legality lookup, and collection-aware USD purchase estimates.
- Preserve the original CSV, browser-local decks, and the app's neutral empty state.
  Collection research files are private working data; do not add them to site payloads.
- Never assert legality or a working combo from a name match or baked score alone.
  Record sources, retrieval times, and unresolved checks using the workflow template.
- Before quoting purchase costs, fetch fresh prices. Missing prices remain unknown.
  Do not buy cards, deploy, sync, or publish collection data without an explicit request.
- Code checks: `node tools/mtg.test.js`; app changes also require `node test.js`.
  Changes to ranking also require the benchmark process in `BENCHMARKS.md`.
