# Primary sources and APIs

Commander Spellbook's [syntax guide](https://commanderspellbook.com/syntax-guide/)
defines combo retrieval. Its [style guide](https://commanderspellbook.com/style-guide/)
helps structure prerequisites, action sequences, and outcomes. The vault workflow
documents the supported query subset and its important semantic traps.

The [official API root](https://backend.commanderspellbook.com/) links the current
[OpenAPI schema](https://backend.commanderspellbook.com/schema/?format=json).
Use current schemas before extending an endpoint; response bodies use camelCase.

- `GET /explain-query?q=<encoded-query>` verifies/paraphrases search interpretation.
- `GET /variants?q=<encoded-query>&limit=25` returns full variant records and `next`.
- `GET /variants/<id>` retrieves one candidate's full details.
- `POST /find-my-combos?limit=25` accepts JSON with `main` and `commanders` arrays;
  each entry has `card` (string) and `quantity` (integer). Keep main within 600 entries
  and commanders within 12. Interpret included/almostIncluded separately from groups
  that require adding colors or changing commanders. Do not recommend incompatible
  combos as if they fit the current commander.
- For broad collection research, use the official
  [compressed bulk file](https://json.commanderspellbook.com/variants.json.gz).
  It contains timestamp/version, full variants, and variant aliases. Cache and scan
  it locally; never page through the API to export the complete database.

The supported scripts preserve full returned variants, including template replacements,
quantities, starting states, mana, prerequisites, results, prices, and legality fields.
The scanner is intentionally a discovery filter for named cards; unresolved templates,
card-face aliases, and commander requirements remain visible for follow-up. Retrieve
the selected variant and resolve its template query with Scryfall before confirming it.
Do not silently drop required template cards as the old baked pair/triple data does.

Use sparse requests with a descriptive User-Agent, handle 429, and credit/link Spellbook
in combo results. The scripts throttle calls and bound retries. For more than a page,
follow documented pagination with a deliberate result limit; do not imply the first
25 results are exhaustive.

Scryfall documentation: [API](https://scryfall.com/docs/api),
[search syntax](https://scryfall.com/docs/syntax),
[card objects](https://scryfall.com/docs/api/cards),
[collection lookup](https://scryfall.com/docs/api/cards/collection), and
[rulings](https://scryfall.com/docs/api/rulings). The existing vault client is
`js/scryfall.js`. Research helpers run independently in Node, with descriptive
User-Agent and Accept headers, throttling, timeouts, and bounded retries.

`mtg quote` uses exact-name or printing-ID resolution and complete English paper
printing pagination. It saves Oracle, identity, legality, and a rulings URL; fetch
the rulings URL to inspect the rulings themselves. It excludes printings whose
top-level Oracle identity cannot be verified (e.g. some reversible cards), reporting
the exclusion count. Lowest price means lowest among the supported matching records.
Prices are timestamped reference estimates, not a stock guarantee or checkout quote.

Use [Wizards rules](https://magic.wizards.com/en/rules),
[Commander rules](https://magic.wizards.com/en/formats/commander),
[ban lists](https://magic.wizards.com/en/banned-restricted-list), and
[Gatherer](https://gatherer.wizards.com/) as primary rules authorities. Record relevant
rule numbers and card-specific rulings for difficult interactions. If access fails,
keep the affected verification unresolved rather than substituting a stale local flag.
