---
name: Decay strategy — old memory fades on a half-life
group: memory
guide: ../../src/memory/README.md
defaultInput: Where do I live?
---

# Decay — let old memory fade

Window keeps the last N turns whatever their age. Decay asks the other
question — *is this still worth remembering?* — and answers it with a
**half-life**: every entry loaded this turn is scored by age and dropped if
it has faded.

```
score = 2 ^ (-age / halfLifeMs)      drop when score < minScore
```

Free: a timestamp and an exponent. No LLM, no embeddings, no key.

## When to use

- Long-running assistants where facts go out of date ("I live in Toronto"
  was true last year)
- Anything with a natural freshness horizon — tickets, prices, news, on-call
- You want recency to be a *policy with a number on it*, not a window size
  you tuned by feel

## When to reach for something else

| Symptom | Try instead |
|---|---|
| You just want the last N turns | `MEMORY_STRATEGIES.WINDOW` |
| The entry should be *gone*, not just unrecalled | `ttl` on the entry — the store enforces it |
| Old-but-relevant should still surface | `MEMORY_STRATEGIES.TOP_K` (semantic match ignores age) |
| Context is full, but nothing is stale | `MEMORY_STRATEGIES.BUDGET` |

## Anatomy of one call

```ts
import { Agent } from 'agentfootprint';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore } from 'agentfootprint/memory';

const DAY = 86_400_000;

const memory = defineMemory({
  id: 'fading',
  type: MEMORY_TYPES.EPISODIC,
  strategy: {
    kind: MEMORY_STRATEGIES.DECAY,
    halfLifeMs: DAY,   // worth half as much every day it goes untouched
    minScore: 0.1,     // ≈ 3.3 half-lives — below this it is not injected
  },
  store: new InMemoryStore(),
});
```

A day-old entry scores `0.5`; a week-old one scores `0.008` and is gone. Set
`minScore: 0` to score without dropping.

## What happens at runtime

```
LoadRecent → FilterByDecay → PickDecider → Format
                  ↑
      drops faded entries BEFORE the token budget is spent
```

Dropping first is deliberate: what has faded is not a budget question, and a
stale entry that *fits* should still not be injected.

## Nothing is deleted

Decay is a read-time judgement. The entry stays in the store, unmutated —
a shorter half-life or a lower floor lets it back in, and a different memory
over the same store never sees it faded at all. Reach for `ttl` when you mean
"stop storing this."

## Age, not use

The underlying model (`computeDecayFactor`) also has an access term:
frequently-read entries can be boosted. This strategy passes a neutral `1`
for it, because `accessCount` is only incremented by `store.get()` and no
shipped read path calls `get()` — they `list()` or `search()`. A knob wired
to a counter that never moves would be a dial that does nothing, so there
isn't one yet.

## Related strategies

- **[Window](./01-window-strategy.md)** — last N, regardless of age
- **[Budget](./02-budget-strategy.md)** — fit to tokens rather than to freshness
- **[Top-K](./04-topK-strategy.md)** — semantic recall, age-blind
- **[Causal](./06-causal-snapshot.md)** — store the WHY, not just the WHAT
