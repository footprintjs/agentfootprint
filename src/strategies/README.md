**Support** — typed sink interfaces (observability, cost, live status, viewer)
plus four in-core defaults: the Tier-4 door where events leave the process and
are forgotten.

## What it reads / what it writes
- Reads events from the dispatcher and the recorder substrate.
- Writes them outward. Nothing here keeps the record — that is Tier 3
  (`src/recorders/`) — and nothing here composes a model-facing sentence.

## The one law here
A sink may drop; the record may not. A strategy that fails takes only its own
copy with it, and `lifecycle.ts` owns who may stop one.

## Files
- `types.ts` — the four sink interfaces.
- `attach.ts` — wiring each strategy to its data source.
- `compose.ts` — the fan-out combinator.
- `lifecycle.ts` — who is still using a strategy, and who may stop it.
- `defaults/`, `index.ts`.
