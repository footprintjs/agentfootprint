[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / tokenBudget

# Function: tokenBudget()

> **tokenBudget**(`options`): [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: [src/core/agent/window/strategies/tokenBudget.ts:53](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/window/strategies/tokenBudget.ts#L53)

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
