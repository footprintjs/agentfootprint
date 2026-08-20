---
title: SlidingWindowOptions
---

# Interface: SlidingWindowOptions

Defined in: [src/core/agent/window/types.ts:465](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L465)

What `slidingWindow({...})` accepts.

## Example

```ts
const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .window(slidingWindow({ keepRecentTurns: 12 }))
  .build();
```

## Properties

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:473](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L473)

How many of the most recent turns stay in the window. Everything older is
dropped — unless it refuses by name.

REQUIRED, with no default. It *is* the policy: how much past this agent
needs is a fact about your agent, not about this library.
