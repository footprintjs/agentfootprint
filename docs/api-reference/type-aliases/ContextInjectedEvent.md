[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextInjectedEvent

# Type Alias: ContextInjectedEvent

> **ContextInjectedEvent** = `AgentfootprintEventMap`\[`"agentfootprint.context.injected"`\]

Defined in: [src/recorders/core/contextEngineering.ts:113](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/recorders/core/contextEngineering.ts#L113)

The shape of the event passed to `onEngineered` / `onBaseline`
callbacks. Same as `agentfootprint.context.injected`'s envelope —
we don't transform it, just route by source.
