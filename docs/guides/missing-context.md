# Missing-context finder — interface #3

> `findDroppedContext` · `ContextUnit` · `MissingContextResult`
> — from `agentfootprint/observe`.

## The three interfaces for identifying a context error

| # | interface | finds | causal confirmation |
|---|---|---|---|
| 1 | influence ranking (`scoreInfluence` + `rankingConfidence`) | orders **present** suspects (speed) | — |
| 2 | ablation | a **present** culprit — *remove* it, see if the outcome flips | removal |
| 3 | **missing-context finder (`findDroppedContext`)** | a culprit that is **absent** — available but never reached the model | **restoration** |

Interfaces #1 and #2 are blind to one whole class of failure: a needed unit that
was **dropped** — truncated out of the context window, or never selected — so the
model never saw it. You cannot ablate what isn't there. Interface #3 is the
mirror image: find what's *missing*, and confirm by *restoring* it.

## Why it's cheap (no embeddings, no LLM)

The library tracks context as **identified units** — every injection, memory
entry, and tool result has a stable id. So "what got dropped" is a **set
difference over ids**:

```
dropped = available − sent
```

- **available** = the units assembled as candidates for the turn (before any
  windowing / truncation).
- **sent** = the units that actually reached the model in the final prompt.

That's O(n), exact, deterministic — no semantic comparison of big text blobs.
Memory being huge doesn't matter: you diff the bounded candidate set for the
turn, not all of long-term memory.

## Use

```typescript
import { findDroppedContext } from 'agentfootprint/observe';

const { dropped, anyDropped, reason } = findDroppedContext(assembled, sentToModel);
if (anyDropped) {
  // each dropped unit is a CANDIDATE — confirm by restoration (below)
}
```

`MissingContextResult`:

| field | meaning |
|---|---|
| `dropped` | units available but not sent (`available − sent`, by id) — candidates |
| `availableCount` / `sentCount` | distinct units each side |
| `anyDropped` | true when a missing-context bug is possible |
| `reason` | presentation-only string |

## Confirm by restoration (the causal tier)

A dropped unit is a **candidate**, never a confirmed cause — most dropped context
is *correctly* dropped. Confirm causally the same way ablation does, mirrored:
**add the unit back and re-run; an outcome flip is the proof.** The re-run is
consumer-owned (the library doesn't own your agent loop), exactly like the
ablation runner.

```typescript
const { dropped } = findDroppedContext(assembled, sentToModel);
for (const unit of dropped) {
  const outcome = await rerunWithRestored(unit);   // your agent, this unit added back
  if (outcome !== wrongOutcome) {
    report(unit);                                   // restoration flipped it → causal
    break;
  }
}
```

Optional speed-up: order the dropped units by relevance (embedding similarity of
each to the task) before restoration-testing, so you re-run fewer times — the
same "scorer = speed, re-run = truth" claim ladder, mirrored. The core finder
stays a pure diff; prioritization is an optional layer on top.

## Honest limits

- The finder lists what was **dropped**; it does not rank which dropped unit
  matters — only restoration confirms.
- It catches the **truncation / dilution** case (a unit that was available and
  fell out). A unit that was *never available* (e.g. a relevant memory that
  retrieval never surfaced) is a different question — that needs a relevance
  signal (embeddings), not a diff.

## See also

- Runnable: [`examples/observability/10-missing-context.ts`](../../examples/observability/10-missing-context.ts)
- Interface #1's honesty marker: [`ranking-confidence.md`](./ranking-confidence.md)
- Interface #2: `localizeContextBug`'s ablation tier (RFC-003 Part B)
