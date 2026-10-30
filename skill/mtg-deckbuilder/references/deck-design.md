# Deckbuilding decisions

Establish commander(s), intended table, win plan, budget, preferred play patterns, and
protected decks from session context. If commander choice is open, compare promising
owned commanders by actual support, mana requirements, redundancy, and opportunity cost.
Do not optimize only for the number of Spellbook hits or raw card prices.

Use the vault's `data/brain.js`, `data/commanders-cards.js`, `data/templates.js`,
`data/vectors.js`, `js/builder.js`, `js/analyze.js`, and `js/pilot.js` as dated context
for roles, archetypes, commander partners, and play patterns. Look up relevant objects
with targeted scripts rather than loading every large minified file into context.
The app's user decks live in browser storage, while the bundled decks file is empty.
Extract current lists from collection binder allocations or user-supplied exports.

Construct a coherent core before filling slots:

- Identify primary and secondary win paths appropriate to the table. Favor cards
  that support multiple useful lines while still functioning alone. Explain when a
  dedicated combo piece is weak outside its combo and whether redundancy justifies it.
- Count ramp, reliable card flow, targeted answers, board resets, recursion/protection,
  and actual win enablers. Use role counts as diagnostics. Adjust them to commander
  mana value, curve, repeatable resources, speed, and the user's expected opponents.
- Build the mana base for colored pips at the turns they matter. Assess early untapped
  sources, tap-land cost, acceleration colors, utility lands, and commander access.
  Do not use color identity as a substitute for a working distribution of sources.
- For each addition, name the cut and quantify the relevant tradeoff: curve, role,
  speed, consistency, dependence on commander, resilience, or mana. Do not cut a
  necessary role simply because an upgrade has a higher popularity score.
- Separate an owned-only list, low-cost improvements, and higher-cost options when
  that comparison helps. Compare marginal benefit per actual dollar required after
  ownership/allocation checks. Include reusing owned cards from other named decks.

Verify a complete list (including command-zone cards) against current Commander
construction and legality rules. Check all faces, special copy exceptions, commander
pairing restrictions, and relevant text changes. Bracket/community labels help set
expectations but do not certify power or legality.

If testing consistency, state deck size, starting hand/mulligan assumptions, play/draw,
draw steps, commander access, sample size/seed, and event being measured. Report actual
results, not estimates disguised as simulations. Goldfishing does not prove resilience
against opponents. For ranking-engine code changes, use `BENCHMARKS.md`.

Finish with a usable deck list, explicit adds/cuts for an upgrade, core interactions,
opening-hand priorities, a concise play plan, and the few remaining uncertainty points.
Keep evidence and machine records in research files; tailor the user-facing layout
to the scope. Do not reserve proposal cards until the user commits them to a deck.
