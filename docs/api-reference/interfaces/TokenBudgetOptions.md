[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TokenBudgetOptions

# Interface: TokenBudgetOptions

Defined in: [src/core/agent/window/types.ts:550](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L550)

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

Defined in: [src/core/agent/window/types.ts:561](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L561)

How many of the most recent turns are never dropped. Default 6.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:557](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L557)

Drop when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default — the same reason as `.compaction()`: only your
model and your bill know the right number.
