# Nightplan: autonomous overnight iteration

Ordered work queue for the overnight session of 2026-08-05. Rules of engagement:
every deploy gated by the full test suite, the live site must work after every
push, no destructive changes to stored user data (backup version compatibility
maintained), polite throttling on all harvests, no secrets ever committed.
Work proceeds top to bottom; the morning report states exactly what shipped.

## Block A: Sync foundation with PIN-encrypted vaults
- [ ] Create private repo theforcebe/aether-vault-data (users/ namespace)
- [ ] js/sync.js: GitHub contents API client; AES-GCM encryption with
      PBKDF2(name+PIN) keys; file slug = hash(name+PIN) so names never appear;
      ETag/sha concurrency; latest-write-wins with local pre-pull snapshot
- [ ] Data page Sync panel: token, name, PIN, enable/status/push/pull/sign out;
      plain-language trust model copy (PIN loss = data loss, by design)
- [ ] Autosync: debounced push after changes when identity present; boot pull
      with cloud-vs-local choice when both changed
- [ ] Local encrypted roundtrip test against the real repo (token via local gh,
      never committed); deploy dormant-until-token UI

## Block B: Phase 1 foundation (latency, bake, tests, diagnostics)
- [ ] Lazy-load brain/vectors/commanders/templates after first paint or on
      first feature use; shell ships with card facts only
- [ ] data/manifest.json + freshness display on Data page
- [ ] bake.js single-command orchestrator for 07-11
- [ ] test.js consolidated suite (views, 60-combo build grid, analyzer, pilot,
      backup roundtrip, sync crypto)
- [ ] Diagnostics: error ring buffer + Copy diagnostics on Data page
- [ ] Storage meter warning at 4MB + one-tap cache prune

## Block C: Mobile excellence quick wins
- [ ] Bottom tab bar on mobile (Dashboard, Collection, Decks, Builder, More)
- [ ] PWA: manifest + service worker (cache-first data, network-first app code),
      installable, offline vault browsing
- [ ] Visual deck view toggle (image stacks) alongside text columns
- [ ] A11y: focus rings, aria-labels on icon buttons, contrast check

## Block D: Knowledge depth (background harvests between other work)
- [ ] Corpus expansion toward 300+ decks/archetype: extend SOURCES with 2-3 more
      directory commanders per archetype; staged incremental harvest
- [ ] Record bracket labels per harvested deck (from deck tables) and split
      brain stats per bracket where labeled
- [ ] Commander micro-brains: extend cmdpage cache to store top cardviews with
      synergy; bake commanders-cards.js (top 30 signature cards x 700)
- [ ] Commander Spellbook: probe bulk API; bake combos.js (popular 2-card and
      notable 3-card combos with result text); Rules consumes it with the
      curated list as fallback
- [ ] Rebake brain + vectors on the expanded corpus; verify sizes stay shippable

## Block E: Engine v2 with a benchmark gate
- [ ] Benchmark harness first: hold out 10 cards from each of 500 harvested
      decks; hit@10 and hit@25 for the current engine = the baseline;
      BENCHMARKS.md records it
- [ ] Truncated SVD (power iteration, dependency-free) over the PMI matrix to
      64-dim int8 dense vectors; ship only if benchmark holds or improves
- [ ] Hybrid ranker: freq + cosine + curve fit + color fit + owned boost
- [ ] Budget ceiling slider on Builder respected by ranker
- [ ] Complete-my-deck for partial decks

## Block F: Guides v2 (as the night allows)
- [ ] Author 10 additional sub-archetype playbooks
- [ ] Cheat-card print format (deck-box sized one-pager)
- [ ] Bracket coach page: analyzer-backed quiz + pregame script

## Block G: Close-out
- [ ] Polish sweep from any issues found during the night
- [ ] ROADMAP.md progress strikethroughs; CHANGELOG entry
- [ ] Memory update; morning report with exactly what shipped and what did not
