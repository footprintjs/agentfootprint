---
title: TokenBudgetOptions
---

# Interface: TokenBudgetOptions

Defined in: [src/core/agent/window/types.ts:389](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L389)

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

Defined in: [src/core/agent/window/types.ts:400](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L400)

How many of the most recent turns are never dropped. Default 6.

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:396](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L396)

Drop when the LAST call's adapter-reported input tokens exceed this.

REQUIRED, with no default — the same reason as `.compaction()`: only your
model and your bill know the right number.
