[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextInjectedEvent

# Type Alias: ContextInjectedEvent

> **ContextInjectedEvent** = `AgentfootprintEventMap`\[`"agentfootprint.context.injected"`\]

Defined in: [src/recorders/core/contextEngineering.ts:113](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/recorders/core/contextEngineering.ts#L113)

The shape of the event passed to `onEngineered` / `onBaseline`
callbacks. Same as `agentfootprint.context.injected`'s envelope —
we don't transform it, just route by source.
