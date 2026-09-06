**Fold** — the one scoring engine three consumers derive their numbers from.

## What it reads / what it writes
- Reads text units and an `Embedder`; returns scores and ranked units.
- Writes nothing. Every score is stated as a deterministic embedding-geometry
  PROXY for semantic alignment — never model internals, never causal
  attribution.

## The one law here
One engine, one contract: a number's meaning is fixed here so three consumers
cannot each mean something slightly different by "influence".
`attributability.ts` publishes the honesty marker that says when a ranking is
too flat to pick from.

## Files
- `signals.ts` — the four-signal composite.
- `margin.ts`, `attribute.ts`, `contrastive.ts`, `explain.ts` — the consumer
  shapes over it.
- `lexical.ts` — the zero-dependency deterministic scorer.
- `similarity.ts`, `snippets.ts`, `cache.ts`, `strategies.ts`,
  `attributability.ts`, `types.ts`, `index.ts`.
