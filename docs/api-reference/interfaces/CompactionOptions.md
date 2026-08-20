[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionOptions

# Interface: CompactionOptions

Defined in: [src/core/agent/window/types.ts:387](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L387)

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

Defined in: [src/core/agent/window/types.ts:402](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L402)

How many of the most recent turns are never folded. Default 6.

The recent turns are what the model is actually reasoning over; folding
them is how a compacting agent loses the thread.

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/window/types.ts:425](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L425)

Model id for the summarizer call.

**Required since 8.14.0** whenever `summarizer` is set. It used to default
to the agent's own model, which quietly billed the expensive model on the
same-provider path and sent an unknown model id to the vendor on the
cross-provider one. Name it — usually the cheap one.

***

### retain?

> `readonly` `optional` **retain?**: [`CompactionRetention`](/agentfootprint/api/generated/type-aliases/CompactionRetention.md)

Defined in: [src/core/agent/window/types.ts:442](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L442)

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

Defined in: [src/core/agent/window/types.ts:416](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L416)

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

Defined in: [src/core/agent/window/types.ts:395](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L395)

Fold when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default. A default budget here would be a number the
library invented for a window whose size only the consumer's model and
wallet know — and every run would silently inherit it.
