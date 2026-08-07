[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TokenBudgetOptions

# Interface: TokenBudgetOptions

Defined in: [src/core/agent/window/types.ts:421](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L421)

What `tokenBudget({...})` accepts.

## Example

```ts
const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .window(tokenBudget({ thresholdTokens: 120_000 }))
  .build();
```

## Properties

### keepRecentTurns?

> `readonly` `optional` **keepRecentTurns?**: `number`

Defined in: [src/core/agent/window/types.ts:432](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L432)

How many of the most recent turns are never dropped. Default 6.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:428](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L428)

Drop when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default — the same reason as `.compaction()`: only your
model and your bill know the right number.
