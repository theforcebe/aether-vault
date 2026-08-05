# Aether Vault Roadmap

> Progress 2026-08-05 overnight: Phase 1 (latency, bake, tests, diagnostics) DONE; Phase 2 (corpus 4.8k decks, bracket labels, micro-brains, Spellbook) DONE; Phase 3 engine gated by BENCHMARKS.md, blend adopted, SVD deferred; Phase 4 guides (overlays, cheat card, coach) DONE; Phase 5 mobile/PWA DONE; Phase 6 sync SHIPPED dormant pending token distribution. Remaining: token handoff, SW cache-version discipline on future bakes, engine v3 ideas per BENCHMARKS.md.

Working plan for iterating this system. Phases are ordered by leverage: stability and
latency first, then data depth, then engine quality, then content, then persistence.
Each phase lists concrete deliverables and an acceptance check. This file is the
source of truth; strike items as they land.

---

## Phase 1: Foundation, stability, latency

The intelligence payload (brain, vectors, commanders, templates) is ~1.8MB raw.
Correct architecture, wrong loading strategy.

- **Lazy-load the intelligence.** Ship the shell with cards facts only (~250KB);
  inject brain/vectors/commanders/templates scripts after first paint or on first
  use (Builder, Analyze). Target: interactive under 1.5s on throttled 4G.
- **Data manifest.** `data/manifest.json` with build dates and sizes per file; Data
  page shows corpus freshness; visible staleness note after 60 days.
- **One-command bake.** `bake.js` orchestrating 07 to 11 with their existing disk
  caches; monthly refresh becomes one command plus a push.
- **Diagnostics without a backend.** Client error ring buffer in localStorage plus a
  Copy diagnostics button on the Data page, so mobile bug reports carry the stack.
- **Test suite consolidation.** Headless render of every view, the 60-combination
  build grid, analyzer and pilot fixtures, backup roundtrip: one `node test.js`.
- **localStorage budget.** Usage meter already exists; add warning at 4MB and
  one-tap pruning of caches (oracle cache, template LRU) that rebuild themselves.

Acceptance: Lighthouse mobile performance 90+, all tests one command, bake one command.

## Phase 2: Knowledge base depth

The brain currently knows 1,960 decks and my curated combo list. Widen and deepen.

- **Corpus expansion.** 140 to 400+ decks per archetype in staged harvests
  (disk-cached, throttled). Split stats **per bracket** using the deck-table bracket
  labels EDHREC already provides: "most-played in Bracket 3 aristocrats" beats
  "most-played in aristocrats".
- **Commander micro-brains.** Commander pages already list top cards with synergy
  scores. Bake top-30 signature cards for all 700 directory commanders so
  recommendations are commander-specific everywhere, not archetype-generic.
- **Combo database.** Replace the hand-curated 40 pairs with a harvested subset of
  Commander Spellbook (bulk API): 2-card and notable 3-card combos, result tags,
  total setup cost. Bracket logic keys off it automatically.
- **Card knowledge base.** Bake oracle-lite facts (role, tags, combo membership,
  GC and banned flags) for the top ~6k EDH staples. Most analyzer runs then need
  zero network calls: lower latency, fewer rate-limit risks.
- **Self-updating rules data.** Bake step pulls `is:gamechanger` and
  `banned:commander` from Scryfall so rules data cannot silently go stale.

Acceptance: 8k+ decks in corpus, bracket-conditional stats live, combo detection
covers Commander Spellbook top pairs, analyzer median run needs no network.

## Phase 3: Recommendation engine v2

Current: PMI co-occurrence over 256 anchors plus frequency blending. Good. Improvable.

- **Better embeddings.** Truncated SVD factorization at bake time (node, no deps)
  into 64-dim dense int8 vectors. Better generalization off-anchor; smaller payload.
- **Hybrid ranker with measurable quality.** Score = archetype frequency + deck
  cosine + curve fit + color fit + budget fit + owned boost. Tune weights against a
  holdout: hide 10 cards from each of 500 real decks, measure hit@10 / hit@25.
  Every engine change runs the benchmark; regressions do not ship. `BENCHMARKS.md`
  tracks the numbers.
- **Complete my deck.** Any partial deck gets remaining slots filled by role targets
  plus the ranker. Entry point on every user deck under 100 cards.
- **Budget-aware building.** A price ceiling slider on the Builder; ranker respects
  it; "upgrade path" output shows what to swap in as budget grows.
- **Flex-slot honesty.** Builds mark their lowest-conviction slots with listed
  alternatives, because pretending all 99 are equally certain is false precision.

Acceptance: hit@10 beats the current engine by a measured margin on the holdout;
budget slider works; benchmarks file exists and gates changes.

## Phase 4: Guides and teaching

- **Playbook depth.** 14 archetype playbooks grow to ~30 sub-archetype variants
  (tokens-aristocrats plays differently from reanimator-aristocrats). Same authored
  quality bar, parameterized by the deck's actual cards.
- **Pod-aware matchups.** Select up to 3 opponents from saved decks; the pilot guide
  gains a table-specific section: threat assessment per opponent, what to counter,
  what to let resolve, who to pressure first.
- **Bracket coach.** Interactive "which bracket is this" flow on top of the
  analyzer, plus a pregame-conversation script generator.
- **Rules gotchas.** Card-triggered primers: deck contains layers-heavy or
  replacement-effect cards, guide appends the relevant two-paragraph explainer.
- **Cheat card.** One-page print format sized for a deck box: opening hand rules,
  combo lines, kill math.

Acceptance: guides read like they were written for that exact deck; pod section
ships; print outputs stay beautiful.

## Phase 5: UX and mobile excellence

- **Bottom tab bar on mobile** (Dashboard, Collection, Decks, Builder, More) in
  thumb reach; top bar remains on desktop.
- **Visual deck view.** Moxfield-style image-stack toggle alongside text columns.
- **Omnibox.** One search over cards, decks, and views.
- **PWA.** Manifest plus service worker, cache-first for baked data: installable,
  offline-capable vault. Biggest single mobile upgrade available.
- **Virtualized grids** for 5k+ card collections.
- **A11y pass.** Focus states, aria labels, contrast, reduced-motion everywhere.
- **First-run tour.** Three steps, skippable, never shown again.

Acceptance: installable PWA, offline vault browsing works, tab bar ships, no
horizontal scroll anywhere on a 320px viewport.

## Phase 6: Persistence and sharing (the second-repo question)

The honest engineering on the idea of a private data repo with users:

- **The landmine.** A static site cannot keep a secret. Any token committed to the
  code or fetched by the page is public. A shared repo token embedded in the app
  means anyone can read, write, or wreck everything, and it cannot be that way.
- **What works, friends-circle tier.** A private GitHub repo you own, plus a
  fine-grained personal access token scoped to only that repo, distributed by you
  personally (text message, not code), pasted once per device into the app and kept
  in localStorage. The app syncs each person's vault to `users/<name>/vault.json`
  via the GitHub contents API with ETag optimistic concurrency. Git history makes
  every save versioned and any vandalism recoverable. A per-person PIN can salt
  their path for casual privacy, and the app says plainly: everyone holding the
  token can technically read the repo. That is a trust circle, not security, and
  for a friends tool it is fine.
- **Personal tier first.** The same mechanism with a token only you hold gives you
  cross-device sync immediately, zero auth UX for anyone else. Recommended starting
  point.
- **Growth tier.** If this outgrows trusted friends: Supabase free tier with
  magic-link auth and row-level security. Real accounts, real isolation, still no
  server to run. The sync payload is already the backup JSON, so migration is a
  transport swap, not a rewrite.
- **What this needs from you.** Creating the private repo and generating the
  fine-grained PAT (or a Supabase project, if that path). Exact click-by-click
  instructions provided when you say go.

Acceptance: your vault syncs across your phone and desktop with history; friends
tier documented in-app with its trust model stated plainly.

## Phase 7: Evaluation, continuously

- Bracket grader validated against EDHREC's community bracket labels on 1k decks;
  confusion matrix drives threshold tuning.
- Recommendation holdout benchmark runs on every engine change.
- Monthly ritual: one bake command, benchmark run, CHANGELOG entry, push.

---

## Standing constraints

- Scryfall and EDHREC courtesy: throttled, cached, attributed, bake-time-heavy
  rather than runtime-heavy. No scraping behind auth walls.
- No PII beyond a chosen display name if sync ships. No analytics trackers.
- Prices remain estimates and say so where money decisions happen.
- Product surfaces stay terse; methodology lives on Guide and Data pages.

## Suggested execution order

1 and the mobile half of 5 first (stability, latency, tab bar, PWA), then 2, then 3
with its benchmark gate, 4 alongside as content sessions, 6 whenever you create the
repo or pick Supabase, 7 woven through everything.
