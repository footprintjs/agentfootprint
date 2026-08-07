[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isEngineeredSource

# Function: isEngineeredSource()

> **isEngineeredSource**(`source`): `boolean`

Defined in: [src/recorders/core/contextEngineering.ts:97](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/recorders/core/contextEngineering.ts#L97)

Pure classifier: given a `ContextSource`, is it engineered?

Useful for ad-hoc filtering on a raw `agent.on('agentfootprint.context.injected', ...)`
subscription when you don't need the wrapper helper.

## Parameters

### source

`ContextSource`

## Returns

`boolean`
