[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / tokenBudget

# Function: tokenBudget()

> **tokenBudget**(`options`): [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: [src/core/agent/window/strategies/tokenBudget.ts:53](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategies/tokenBudget.ts#L53)

Drop the oldest turns whenever the last call's adapter-reported input
tokens exceed `thresholdTokens`.

## Parameters

### options

[`TokenBudgetOptions`](/agentfootprint/api/generated/interfaces/TokenBudgetOptions.md)

## Returns

[`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

## Example

```ts
import { Agent, tokenBudget } from 'agentfootprint';

const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .window(tokenBudget({ thresholdTokens: 120_000 }))
  .build();
```
