[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionOptions

# Interface: CompactionOptions

Defined in: [src/core/agent/window/types.ts:299](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L299)

What `.compaction({...})` — and `summarizeOldest({...})` — accepts.

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

Defined in: [src/core/agent/window/types.ts:314](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L314)

How many of the most recent turns are never folded. Default 6.

The recent turns are what the model is actually reasoning over; folding
them is how a compacting agent loses the thread.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/window/types.ts:324](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L324)

Model id for the summarizer call. Defaults to the agent's own model, so
`summarizer: anthropic()` alone works; name a cheap model to spend less.

***

### retain?

> `readonly` `optional` **retain?**: [`CompactionRetention`](/agentfootprint/api/generated/type-aliases/CompactionRetention.md)

Defined in: [src/core/agent/window/types.ts:341](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L341)

What happens to the messages a fold removes. Default `'conversation'` —
they ride with the conversation checkpoint and survive the process.

Pass `'discard'` to opt out. Nothing is ever destroyed silently: the only
way to lose the originals is to name this.

#### Example

```ts
.compaction({
  thresholdTokens: 120_000,
  summarizer: anthropic(),
  retain: 'conversation',   // the default, spelled out
})
```

***

### summarizer

> `readonly` **summarizer**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/window/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L319)

The provider that writes the summary. Explicitly chosen — the library
never quietly bills your main model for compaction.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/window/types.ts#L307)

Fold when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default. A default budget here would be a number the
library invented for a window whose size only the consumer's model and
wallet know — and every run would silently inherit it.
