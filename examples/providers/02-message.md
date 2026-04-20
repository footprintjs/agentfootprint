---
name: MessageStrategy — context window management
group: providers
guide: ../../docs/guides/providers.md#messagestrategy
defaultInput: ''
---

# MessageStrategy — context window management

Long conversations exceed the model's context window. `MessageStrategy` decides which messages reach the LLM each turn — keep recent N, trim by character budget, or summarize older history into a single paragraph.

## When to use

- The conversation is approaching the model's context limit.
- You want to keep cost predictable per turn even as the conversation grows.
- You want **trim policy** to be a swappable strategy, not bespoke per agent.

## What you'll see

The example doesn't run an LLM — it shows two strategies operating on a 7-message history:

```
{
  original:  '7 messages',
  windowed:  '4 messages (sliding-window)',
  truncated: '4 messages (char-budget)',
}
```

`slidingWindow({ maxMessages: N })` keeps the last N regardless of size. `charBudget({ maxChars: N })` keeps only as many recent messages as fit under the byte cap.

## Key API

- `slidingWindow({ maxMessages })` — pure function, free.
- `charBudget({ maxChars })` — pure function, free.
- `summaryStrategy({ summarizer })` — costs an extra LLM call when triggered.
- `withToolPairSafety(strategy)` — wraps another strategy so tool-call/tool-result pairs never get split (most LLM APIs reject orphans).

## Cost note

`slidingWindow` and `charBudget` are free. `summaryStrategy` adds an LLM call when it triggers. Pick the cheapest one that meets your context constraint.

## Related

- [providers guide](../../docs/guides/providers.md#messagestrategy) — full strategy list + custom implementations.
- [observability/01-recorders](../observability/01-recorders.md) — measure the cost/quality trade-off.
