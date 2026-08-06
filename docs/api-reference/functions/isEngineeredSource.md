[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isEngineeredSource

# Function: isEngineeredSource()

> **isEngineeredSource**(`source`): `boolean`

Defined in: [src/recorders/core/contextEngineering.ts:97](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/recorders/core/contextEngineering.ts#L97)

Pure classifier: given a `ContextSource`, is it engineered?

Useful for ad-hoc filtering on a raw `agent.on('agentfootprint.context.injected', ...)`
subscription when you don't need the wrapper helper.

## Parameters

### source

`ContextSource`

## Returns

`boolean`
