---
title: tokenBudget
---

# Function: tokenBudget()

> **tokenBudget**(`options`): [`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

Defined in: src/core/agent/window/strategies/tokenBudget.ts:53

Drop the oldest turns whenever the last call's adapter-reported input
tokens exceed `thresholdTokens`.

## Parameters

### options

[`TokenBudgetOptions`](/docs/api/interfaces/TokenBudgetOptions)

## Returns

[`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

## Example

```ts
import { Agent, tokenBudget } from 'agentfootprint';

const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .window(tokenBudget({ thresholdTokens: 120_000 }))
  .build();
```
