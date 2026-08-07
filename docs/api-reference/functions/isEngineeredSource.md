[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isEngineeredSource

# Function: isEngineeredSource()

> **isEngineeredSource**(`source`): `boolean`

Defined in: [src/recorders/core/contextEngineering.ts:97](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/recorders/core/contextEngineering.ts#L97)

Pure classifier: given a `ContextSource`, is it engineered?

Useful for ad-hoc filtering on a raw `agent.on('agentfootprint.context.injected', ...)`
subscription when you don't need the wrapper helper.

## Parameters

### source

`ContextSource`

## Returns

`boolean`
