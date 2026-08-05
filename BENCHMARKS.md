# Recommendation engine benchmarks

Harness: `node benchmark.js`. Hold out 10 suggestible cards from each of 500
harvested decks (round-robin sampled across 28 commanders, seeded PRNG
20260805 so splits are identical across runs), rank suggestions from the
remaining ~89, score recall@10, recall@25, MRR. 494 decks match an archetype
at the 0.08 floor and get scored.

Honesty notes: the brain was distilled from this same corpus, so absolute
numbers carry leakage (each deck is ~1/344 of its archetype stats). The value
is relative movement; engine changes must hold or beat the adopted line.
Held-out cards are restricted to cards some archetype could suggest.

## 2026-08-05, corpus 4,816 decks, vectors 3,458 cards / 2,600 decks

| config | r@10 | r@25 | MRR |
|---|---|---|---|
| f*0.6+cos*0.4, best archetype (old prod) | 0.2160 | 0.3630 | 0.5678 |
| f*0.5+cos*0.5 | 0.2014 | 0.3508 | 0.5599 |
| top-2 archetype union, f*0.6+cos*0.4 | 0.1976 | 0.3409 | 0.5401 |
| top-2 union, f*0.5+cos*0.5 | 0.1935 | 0.3346 | 0.5475 |
| top-2 union, RRF k=60 | 0.1909 | 0.3431 | 0.4517 |
| top-2 union, f^0.7*(0.6+cos) | 0.1846 | 0.3192 | 0.5271 |
| f*0.7+cos*0.3 | 0.2198 | 0.3603 | 0.5949 |
| **f*0.65+cos*0.35 (ADOPTED)** | **0.2188** | **0.3648** | **0.5821** |
| f*0.75+cos*0.25 | 0.2178 | 0.3538 | 0.5950 |
| f*(1+cos) | 0.2105 | 0.3443 | 0.5729 |
| score-weighted union, f*0.65+cos*0.35 | 0.2170 | 0.3621 | 0.5817 |
| score-weighted union, f*0.7+cos*0.3 | 0.2200 | 0.3597 | 0.5962 |

Findings:
- Archetype frequency is the dominant signal; cosine helps most at ~0.35
  weight. Every attempt to lean harder on vectors or widen the candidate pool
  lost recall: precision of the best-matched archetype beats breadth.
- Adopted f*0.65+cos*0.35 over the old prod blend: +1.3% r@10, +0.5% r@25,
  +2.5% MRR relative. Shipped in analyze.js brainSuggestions.
- SVD dense embeddings (64-dim int8) deferred: with cosine contributing at
  most a third of the useful signal here, a denser vector space cannot move
  the headline numbers enough tonight to justify bake + bundle cost. The
  harness stays; run any future embedding against this table before shipping.
