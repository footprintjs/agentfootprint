[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SlidingWindowOptions

# Interface: SlidingWindowOptions

Defined in: [src/core/agent/window/types.ts:363](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/types.ts#L363)

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

Defined in: [src/core/agent/window/types.ts:371](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/types.ts#L371)

How many of the most recent turns stay in the window. Everything older is
dropped — unless it refuses by name.

REQUIRED, with no default. It *is* the policy: how much past this agent
needs is a fact about your agent, not about this library.
