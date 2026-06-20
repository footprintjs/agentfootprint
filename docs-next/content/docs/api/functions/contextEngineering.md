---
title: contextEngineering
---

# Function: contextEngineering()

> **contextEngineering**(`agent`): [`ContextEngineeringHandle`](/docs/api/interfaces/ContextEngineeringHandle)

Defined in: [src/recorders/core/contextEngineering.ts:167](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/contextEngineering.ts#L167)

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

[`ContextEngineeringHandle`](/docs/api/interfaces/ContextEngineeringHandle)
