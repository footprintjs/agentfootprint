---
title: CompactionOptions
---

# Interface: CompactionOptions

Defined in: src/core/agent/compaction/types.ts:37

What `.compaction({...})` accepts.

## Example

```ts
const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .compaction({
    thresholdTokens: 120_000,
    summarizer: anthropic(),          // usually the cheap one
    model: 'claude-haiku-4-5',
    keepRecentTurns: 6,
  })
  .build();
```

## Properties

### keepRecentTurns?

> `readonly` `optional` **keepRecentTurns?**: `number`

Defined in: src/core/agent/compaction/types.ts:52

How many of the most recent turns are never folded. Default 6.

The recent turns are what the model is actually reasoning over; folding
them is how a compacting agent loses the thread.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: src/core/agent/compaction/types.ts:62

Model id for the summarizer call. Defaults to the agent's own model, so
`summarizer: anthropic()` alone works; name a cheap model to spend less.

***

### summarizer

> `readonly` **summarizer**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/core/agent/compaction/types.ts:57

The provider that writes the summary. Explicitly chosen — the library
never quietly bills your main model for compaction.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: src/core/agent/compaction/types.ts:45

Fold when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default. A default budget here would be a number the
library invented for a window whose size only the consumer's model and
wallet know — and every run would silently inherit it.
