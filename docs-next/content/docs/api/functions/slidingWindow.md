---
title: slidingWindow
---

# Function: slidingWindow()

> **slidingWindow**(`options`): [`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

Defined in: [src/core/agent/window/strategies/slidingWindow.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategies/slidingWindow.ts#L53)

Keep the most recent `keepRecentTurns` turns in the live window and drop
the older ones — except anything that refuses.

## Parameters

### options

[`SlidingWindowOptions`](/docs/api/interfaces/SlidingWindowOptions)

## Returns

[`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

## Example

```ts
import { Agent, slidingWindow } from 'agentfootprint';
import { ollama } from 'agentfootprint/providers';

// Works on a provider that reports no usage at all: the trigger is turns.
const agent = Agent.create({ provider: ollama('llama3.2'), model: 'llama3.2' })
  .window(slidingWindow({ keepRecentTurns: 12 }))
  .build();
```
