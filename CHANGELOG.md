# Changelog

## 2026-08-05, overnight build

Data and intelligence
- Brain rebuilt on 4,816 real decks (344 per archetype, up from 140), with
  per-bracket composition splits from 108,740 bracket-labeled table rows.
- Commander micro-brains: signature cards with synergy and inclusion rates for
  700 commanders (355KB lazy bundle). Surfaced in the analyzer ("signature
  cards you are not running") and in builder results.
- Commander Spellbook bake: 912 popular combos (536 two-card), bracket-tagged
  (Core/Exhibition vs Powerful/Spicy/Ruthless). Merged into rules: combo
  detection, fast-combo bracket signals, 3-card lines in the report.
- Vectors rebuilt: 3,458 card vectors, 2,600 commander-diverse deck vectors.

Engine
- Benchmark harness (`benchmark.js`, results in BENCHMARKS.md): 500 held-out
  decks, recall@10/25 + MRR. Twelve configurations tested; adopted
  f*0.65 + cos*0.35 (beats prior blend on all three metrics). SVD dense
  embeddings evaluated and deferred with recorded rationale.
- Complete-my-deck: fills partial decks with the benchmark-adopted ranker,
  color-filtered, lands topped to the archetype's real average.
- Budget ceiling on the builder: shapes the priciest to-buy cards down until
  the build fits under $50/100/200/400.
- Builder correctness: Game Changer limits enforced by name (stale baked flags
  ignored), re-enforced after substitutions; every build is exactly 99 cards.

Guides
- 10 sub-archetype overlays (equipment, auras, superfriends, vehicles,
  reanimation, treasure, mill, extra combats, poison, taxes) detected per deck
  and layered onto the pilot guide.
- Cheat card: deck-box one-pager print view on the pilot page.
- Bracket coach: pick a deck, get the honest pregame pitch as copyable text,
  plus what to change to honestly claim a target bracket.

App
- Mobile bottom tab bar; top nav hidden on small screens.
- PWA: installable (manifest + icons), offline browsing via service worker
  (network-first app, cache-first card art; sync APIs never intercepted).
- Visual deck view: Moxfield-style image stacks alongside the list view.
- Encrypted cross-device sync (name + PIN, AES-GCM, private repo) with
  autosync; shipped dormant until a token is entered.
- Lazy-loaded intelligence bundles: first paint ~450KB, heavy data on demand.
- Data page: bundle freshness from the bake manifest, storage meter with
  4MB warning and cache prune, error ring buffer with copy-diagnostics.
- Accessibility: focus-visible rings, aria-labels on icon buttons, live-region
  toasts, keyboard-operable visual stacks.

Pipeline
- bake.js one-command orchestrator (07 through 14).
- Consolidated test suite (test.js): 77 checks gating every deploy.
