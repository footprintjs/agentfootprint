---
name: Budget strategy — fit-to-tokens (decider-based)
group: memory
guide: ../../src/memory/README.md
defaultInput: Summarize what we discussed.
---

# Budget — pick what fits within a token cap

Like `Window`, but caps by **token count** instead of entry count.
Wraps a `decide()`-based stage so the narrative records WHY memory was
(or wasn't) injected — useful when "no memory" is a deliberate choice.

## When to use

- Long-running chats with **variable-length turns** (one user types
  paragraphs, another types one-liners — Window over-allocates for
  the first and under-allocates for the second)
- **Cost-sensitive deployments** — reserve tokens explicitly so memory
  doesn't crowd out the user's message
- You want **observable "memory skipped"** events in narrative + Lens

## The three branches the decider routes to

| Branch | Triggered when | Result |
|---|---|---|
| `pick` | Entries exist AND budget meets `minimumTokens` | Pick most-recent entries fitting within `reserveTokens` |
| `skip-empty` | No entries in store | No memory injection |
| `skip-no-budget` | Budget below `minimumTokens` floor | No memory injection (don't pollute small budgets) |

## Anatomy

```ts
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore } from 'agentfootprint';

const memory = defineMemory({
  id: 'budgeted',
  type: MEMORY_TYPES.EPISODIC,
  strategy: {
    kind: MEMORY_STRATEGIES.BUDGET,
    reserveTokens: 512,   // reserve N tokens for headers + new user message
    minimumTokens: 100,   // floor: skip injection below this
    maxEntries: 20,       // hard cap to defend against lost-in-the-middle
  },
  store: new InMemoryStore(),
});
```

## Tuning notes

- `reserveTokens` should approximate `(model context limit) - (max
  expected user message + system prompt headers + safety margin)`.
  Common value: 512–1024 for GPT-4 / Claude.
- `minimumTokens` is a guard against pathological cases (e.g. a
  catastrophically long user message leaves no room for memory). Below
  that floor, just skip rather than inject 1–2 fragmented entries.
- `maxEntries` is independent of token math — it caps "lost in the
  middle" degradation that LLMs show with long context windows.

## Lens

The decider's evidence (which branch was chosen + why) renders as a
chip in the memory slot. Hover reveals the per-branch signal that
fired (`budget=420`, `minimumTokens=100`, `entries=8`).

## Related

- **[Window](./01-window-strategy.md)** — caps by entry count instead
- **[Summarize](./03-summarize-strategy.md)** — when budget can't fit even one full turn, compress older
