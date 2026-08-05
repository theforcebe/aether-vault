# Nightplan: autonomous overnight iteration

Ordered work queue for the overnight session of 2026-08-05. Rules of engagement:
every deploy gated by the full test suite, the live site must work after every
push, no destructive changes to stored user data (backup version compatibility
maintained), polite throttling on all harvests, no secrets ever committed.
Work proceeds top to bottom; the morning report states exactly what shipped.

## Block A: Sync foundation with PIN-encrypted vaults
- [x] Create private repo theforcebe/aether-vault-data (users/ namespace)
- [x] js/sync.js: GitHub contents API client; AES-GCM encryption with
      PBKDF2(name+PIN) keys; file slug = hash(name+PIN) so names never appear;
      ETag/sha concurrency; latest-write-wins with local pre-pull snapshot
- [x] Data page Sync panel: token, name, PIN, enable/status/push/pull/sign out;
      plain-language trust model copy (PIN loss = data loss, by design)
- [x] Autosync: debounced push after changes when identity present; boot pull
      with cloud-vs-local choice when both changed
- [x] Local encrypted roundtrip test against the real repo (token via local gh,
      never committed); deploy dormant-until-token UI

## Block B: Phase 1 foundation (latency, bake, tests, diagnostics)
- [x] Lazy-load brain/vectors/commanders/templates after first paint or on
      first feature use; shell ships with card facts only
- [x] data/manifest.json + freshness display on Data page
- [x] bake.js single-command orchestrator for 07-11
- [x] test.js consolidated suite (views, 60-combo build grid, analyzer, pilot,
      backup roundtrip, sync crypto)
- [x] Diagnostics: error ring buffer + Copy diagnostics on Data page
- [x] Storage meter warning at 4MB + one-tap cache prune

## Block C: Mobile excellence quick wins
- [x] Bottom tab bar on mobile (Dashboard, Collection, Decks, Builder, More)
- [x] PWA: manifest + service worker (cache-first data, network-first app code),
      installable, offline vault browsing
- [x] Visual deck view toggle (image stacks) alongside text columns
- [x] A11y: focus rings, aria-labels on icon buttons, contrast check

## Block D: Knowledge depth (background harvests between other work)
- [x] Corpus expansion toward 300+ decks/archetype: extend SOURCES with 2-3 more
      directory commanders per archetype; staged incremental harvest
- [x] Record bracket labels per harvested deck (from deck tables) and split
      brain stats per bracket where labeled
- [x] Commander micro-brains: extend cmdpage cache to store top cardviews with
      synergy; bake commanders-cards.js (top 30 signature cards x 700)
- [x] Commander Spellbook: probe bulk API; bake combos.js (popular 2-card and
      notable 3-card combos with result text); Rules consumes it with the
      curated list as fallback
- [x] Rebake brain + vectors on the expanded corpus; verify sizes stay shippable

## Block E: Engine v2 with a benchmark gate
- [x] Benchmark harness first: hold out 10 cards from each of 500 harvested
      decks; hit@10 and hit@25 for the current engine = the baseline;
      BENCHMARKS.md records it
- [x] Truncated SVD: evaluated and DEFERRED by the benchmark gate; frequency
      dominates cosine (best blend 0.65/0.35), so denser vectors cannot pay
      for their bake and bundle cost. Rationale recorded in BENCHMARKS.md
- [~] Hybrid ranker: benchmark-tuned freq+cosine blend shipped (0.65/0.35);
      color fit lives in complete-my-deck; curve fit and owned boost tested
      poorly or deferred
- [x] Budget ceiling selector on Builder respected by the build shaper
- [x] Complete-my-deck for partial decks

## Block F: Guides v2 (as the night allows)
- [x] Author 10 sub-archetype playbooks (as detection-driven overlays)
- [x] Cheat-card print format (deck-box sized one-pager)
- [x] Bracket coach page: analyzer-backed quiz + pregame script

## Block G: Close-out
- [ ] Polish sweep from any issues found during the night
- [ ] ROADMAP.md progress strikethroughs; CHANGELOG entry
- [ ] Memory update; morning report with exactly what shipped and what did not
