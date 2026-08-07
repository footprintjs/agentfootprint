[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / slidingWindow

# Function: slidingWindow()

> **slidingWindow**(`options`): [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: [src/core/agent/window/strategies/slidingWindow.ts:53](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/strategies/slidingWindow.ts#L53)

Keep the most recent `keepRecentTurns` turns in the live window and drop
the older ones — except anything that refuses.

## Parameters

### options

[`SlidingWindowOptions`](/agentfootprint/api/generated/interfaces/SlidingWindowOptions.md)

## Returns

[`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

## Example

```ts
import { Agent, slidingWindow } from 'agentfootprint';
import { ollama } from 'agentfootprint/providers';

// Works on a provider that reports no usage at all: the trigger is turns.
const agent = Agent.create({ provider: ollama('llama3.2'), model: 'llama3.2' })
  .window(slidingWindow({ keepRecentTurns: 12 }))
  .build();
```
