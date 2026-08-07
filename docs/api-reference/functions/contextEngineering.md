[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / contextEngineering

# Function: contextEngineering()

> **contextEngineering**(`agent`): [`ContextEngineeringHandle`](/agentfootprint/api/generated/interfaces/ContextEngineeringHandle.md)

Defined in: [src/recorders/core/contextEngineering.ts:167](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/recorders/core/contextEngineering.ts#L167)

Wrap a runner's `agentfootprint.context.injected` stream into two
filtered subscriptions: engineered + baseline. Multiple listeners
per stream are allowed; `detach()` removes all of them.

The classifier inspects `event.payload.source`. Unknown sources
(forward-compat: `ContextSource` is open-extensible) are routed
to NEITHER stream — preferring under-firing over miscategorizing.
Use `agent.on('agentfootprint.context.injected', ...)` directly
if you need to observe sources that aren't (yet) classified.

## Parameters

### agent

`RunnerWithEvents`

## Returns

[`ContextEngineeringHandle`](/agentfootprint/api/generated/interfaces/ContextEngineeringHandle.md)
