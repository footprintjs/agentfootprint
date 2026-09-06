**Mixed** — per-provider prompt-cache policy: it changes what a call COSTS,
never what the model is shown.
Walker: `CacheDecisionSubflow.ts` and `CacheGateDecider.ts` run inside the loop,
one pass per iteration.
Trace: `cacheRecorder.ts` is the cache layer's meter — it writes the events a
cost fold later reads.
Support: `strategyRegistry.ts`, `strategies/`, `applyCachePolicy.ts`,
`portUsage.ts`, `types.ts`.

## What it reads / what it writes
- Reads `activeInjections` (owner: the injection-engine subflow's outputMapper)
  and `iterationsRemaining` (owner: `src/lib/iterationBudget.ts` · `iterationsRemainingOf`).
- Writes cache markers onto the composed request, and cache-usage events.

## The one law here
A cache marker may annotate the wire; it may not add, remove or reorder a
sentence on it. Anything a model would READ differently is a Lens change and
does not belong here.

## Files
- `CacheDecisionSubflow.ts` — directives + active injections → `CacheMarker[]`.
- `CacheGateDecider.ts` — the runtime gate over marker application.
- `applyCachePolicy.ts` — the helper every injection factory shares.
- `cacheRecorder.ts` — the meter.
- `portUsage.ts` — the one reader of port-shaped usage.
- `strategyRegistry.ts` / `types.ts` / `index.ts` — registry and public surface.
