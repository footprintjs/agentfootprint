---
name: Summarize strategy — LLM compresses older turns
group: memory
guide: ../../src/memory/README.md
defaultInput: What were the main topics we covered today?
---

# Summarize — long-conversation compaction (the "context janitor")

When a conversation outgrows the comfortable window, summarization
keeps it healthy: **recent N turns stay raw** (precise), **older turns
get LLM-compressed** into a paragraph (lossy but cheap to carry).

Inspired by the "Context Janitor" pattern from *AI Agents: The
Definitive Guide* (Ch 7) — preserve system prompt + recent turns,
summarize the middle section.

## When to use

- Conversations regularly exceed ~20 turns
- Latency is OK but cost is a concern (paid summarizer is cheaper than
  paid full-history every turn)
- Users refer back to topics from earlier in the chat ("we discussed
  refunds — do they apply to my situation?")

## Anatomy

```ts
import { Agent, defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore, anthropic } from 'agentfootprint';

const memory = defineMemory({
  id: 'long-chat',
  type: MEMORY_TYPES.EPISODIC,
  strategy: {
    kind: MEMORY_STRATEGIES.SUMMARIZE,
    recent: 6,                                    // last 6 turns stay raw
    llm: anthropic('claude-haiku-4-5'),           // cheap model for the summary
  },
  store: new InMemoryStore(),
});
```

## What gets injected

```
┌── system message ──────────────────────────────────────────────┐
│  Earlier in this conversation:                                 │
│  The user opened the chat asking about billing. They           │
│  requested an email update and asked about a refund for        │
│  last month's charge. The agent confirmed the refund window.   │
└────────────────────────────────────────────────────────────────┘
┌── recent raw turns (last 6) ───────────────────────────────────┐
│  user: My new email is alice@new.com                           │
│  assistant: Email updated.                                     │
│  user: Was the refund processed?                               │
│  ...                                                           │
└────────────────────────────────────────────────────────────────┘
```

## Tuning the recent / summary balance

| `recent` | Trade-off |
|---|---|
| 2–3 | Aggressive compression — cheaper, more lossy |
| 6 | Balanced default — keeps last 3 user-assistant pairs raw |
| 10+ | Conservative — barely compressing, summarizer rarely fires |

## Cost model

Summarization runs **once per turn** when the conversation exceeds the
recent threshold. With a haiku-class summarizer at ~$0.001 per call,
this adds ~$0.10 per 100 turns of compression — tiny vs the alternative
of paying full-history tokens to the main model every turn.

## Compliance / redaction

Older turns are summarized verbatim by default. To strip PII before
summarization, pass `redact: { patterns: [...] }` on the
`defineMemory()` call (API hook reserved; impl in a future release).

## Related

- **[Window](./01-window-strategy.md)** — when summary isn't worth the cost
- **[Budget](./02-budget-strategy.md)** — token-aware selection within recent
- **[Hybrid](./07-hybrid-auto.md)** — combine summarize + facts + retrieval
