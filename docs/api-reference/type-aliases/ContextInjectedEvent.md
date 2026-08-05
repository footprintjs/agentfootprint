[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextInjectedEvent

# Type Alias: ContextInjectedEvent

> **ContextInjectedEvent** = `AgentfootprintEventMap`\[`"agentfootprint.context.injected"`\]

Defined in: [src/recorders/core/contextEngineering.ts:113](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/contextEngineering.ts#L113)

The shape of the event passed to `onEngineered` / `onBaseline`
callbacks. Same as `agentfootprint.context.injected`'s envelope —
we don't transform it, just route by source.
