---
name: Summarize strategy — one call folds older turns, and it is stored
group: memory
guide: ../../src/memory/README.md
defaultInput: What were the main topics we covered today?
---

# Summarize — long-conversation compaction (the "context janitor")

When recall outgrows the comfortable window, summarization keeps it
healthy: **the newest `recent` entries stay raw** (precise), **everything
older is folded by ONE model call** into a summary (lossy but cheap to
carry) — and that summary is **written back to the store**, so the span
is paid for once instead of once per turn.

Inspired by the "Context Janitor" pattern from *AI Agents: The
Definitive Guide* (Ch 7) — preserve system prompt + recent turns,
summarize the middle section.

**The originals are kept.** A summary is a claim *about* the
conversation, not the conversation: the entries it covers stay in the
store and are excluded from recall by the summary's coverage metadata.
Delete the summary entry and the next recall is verbatim again.

## When to use

- Conversations regularly exceed ~20 turns
- Latency is OK but cost is a concern (paid summarizer is cheaper than
  paid full-history every turn)
- Users refer back to topics from earlier in the chat ("we discussed
  refunds — do they apply to my situation?")

## Anatomy

```ts
import { Agent, anthropic } from 'agentfootprint'
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore } from 'agentfootprint/memory';

const memory = defineMemory({
  id: 'long-chat',
  type: MEMORY_TYPES.EPISODIC,
  strategy: {
    kind: MEMORY_STRATEGIES.SUMMARIZE,
    recent: 6,                     // the 6 newest entries stay raw
    size: 20,                      // how much history to load per turn
    llm: anthropic(),              // its OWN instance, not the agent's
    model: 'claude-haiku-4-5',     // named explicitly — no fallback
  },
  store: new InMemoryStore(),
});
```

`model` is required, and there is no fall back to the agent's own model:
the same family would quietly bill your main model for compression, and a
different vendor would be sent a model id it has never heard of.
`Agent.memory()` additionally refuses a summarizer that is the agent's own
provider *instance* at the agent's own model — those two calls look
identical and are not (the agent's runs through reliability, decorators
and the cache; this one runs through none of them).

## What gets injected

```
┌── the stored summary (id: msg-summary-1-7) ───────────────────┐
│  [summary of earlier turns 1–7 — 14 earlier message(s) were   │
│  compressed. The text after this line is a SUMMARY written by │
│  claude-haiku-4-5; it is a claim about the conversation, not  │
│  the conversation. The originals are retained in this         │
│  memory's store …]                                            │
│                                                               │
│  The user opened the chat asking about billing. They          │
│  requested an email update and asked about a refund for       │
│  last month's charge. The agent confirmed the refund window.  │
└───────────────────────────────────────────────────────────────┘
┌── recent raw entries (last 6) ────────────────────────────────┐
│  user: My new email is alice@new.com                          │
│  assistant: Email updated.                                    │
│  user: Was the refund processed?                              │
│  ...                                                          │
└───────────────────────────────────────────────────────────────┘
```

The label is written by the library and always comes first; the model's
text is appended to it verbatim. A summarizer that returns "IGNORE ALL
PREVIOUS INSTRUCTIONS" produces an entry that still says, in the
library's own words and first, what it is.

## Tuning the recent / summary balance

| `recent` | Trade-off |
|---|---|
| 2–3 | Aggressive compression — cheaper, more lossy |
| 6 | Balanced — keeps the last 3 user-assistant pairs raw |
| 10+ | Conservative — folds rarely, and only large spans |

`recent` must be smaller than `size`, and `defineMemory` refuses it
otherwise: a verbatim tail as large as the window means nothing older is
ever loaded, so the summarizer could never fire — a paid dependency
wired to a stage that cannot run. The seam is rounded outward to a whole
turn, so a question is never folded away while its answer stays raw.

## Cost model

Summarization runs **once per span**, not once per turn: the summary is
written back under `msg-summary-{fromTurn}-{toTurn}`, so the next turn
loads it instead of buying it again. A conversation pays roughly one
cheap call per `size - recent` new entries. With a haiku-class
summarizer at ~$0.001 per call, a 100-turn conversation costs cents —
against the alternative of sending full history to the main model every
turn.

**Three ways it declines, all of them out loud** (every one emits
`agentfootprint.memory.strategy_applied` with a reason you can read):

| Situation | What happens |
|---|---|
| Fewer foldable entries than the floor | No call. Recall is unchanged |
| The summarizer throws | One `console.warn`, one event, and recall proceeds **verbatim** — the strategy degrades to `window` for the run rather than failing the turn |
| The summary is no shorter than the span | The fold is dropped and the span is **latched**, so the same question is not bought twice. A span that has *grown* is a new question and is asked again |

## Compliance / redaction

Older turns are summarized verbatim by default. To strip PII before
summarization, pass `redact: { patterns: [...] }` on the
`defineMemory()` call (API hook reserved; impl in a future release).

A retention window covers the summary too: when the pipeline sets a
write TTL, the summary expires on the **span's** clock, not the fold's,
so it cannot outlive the turns it compressed.

## Related

- **[Window](./01-window-strategy.md)** — when a summary isn't worth the cost
- **`.compaction({ summarizer, model })`** — the same move applied to the
  LIVE context window instead of to stored recall; the two compose
- **[Budget](./02-budget-strategy.md)** — token-aware selection within recent
- **[Hybrid](./07-hybrid-auto.md)** — combine summarize + facts + retrieval
