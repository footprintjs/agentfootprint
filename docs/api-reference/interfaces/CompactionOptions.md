[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionOptions

# Interface: CompactionOptions

Defined in: [src/core/agent/window/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L290)

What `.compaction({...})` — and `summarizeOldest({...})` — accepts.

## Example

```ts
const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .compaction({
    thresholdTokens: 120_000,
    summarizer: anthropic(),          // a SECOND instance, not the agent's
    model: 'claude-haiku-4-5',        // required — name the cheap model
    keepRecentTurns: 6,
  })
  .build();
```

## Properties

### keepRecentTurns?

> `readonly` `optional` **keepRecentTurns?**: `number`

Defined in: [src/core/agent/window/types.ts:305](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L305)

How many of the most recent turns are never folded. Default 6.

The recent turns are what the model is actually reasoning over; folding
them is how a compacting agent loses the thread.

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/window/types.ts:328](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L328)

Model id for the summarizer call.

**Required since 8.14.0** whenever `summarizer` is set. It used to default
to the agent's own model, which quietly billed the expensive model on the
same-provider path and sent an unknown model id to the vendor on the
cross-provider one. Name it — usually the cheap one.

***

### retain?

> `readonly` `optional` **retain?**: [`CompactionRetention`](/agentfootprint/api/generated/type-aliases/CompactionRetention.md)

Defined in: [src/core/agent/window/types.ts:345](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L345)

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

Defined in: [src/core/agent/window/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L319)

The provider that writes the summary. Explicitly chosen — the library
never quietly bills your main model for compaction.

**This call is not wrapped by anything.** `reliability`, `withRetry`,
`withFallback`, the circuit breaker and the cache subflow all sit around
the agent's own `call-llm` stage; the summarizer is invoked directly
(`runSummarizer`), so it gets one attempt, no fallback, no cache. That is
deliberate — a fold is optional work and a broken summarizer must not
take the run down — but it means passing the agent's OWN provider
instance here gives you the same object behaving two different ways in
one run. Pass a separate instance.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:298](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L298)

Fold when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default. A default budget here would be a number the
library invented for a window whose size only the consumer's model and
wallet know — and every run would silently inherit it.
