---
title: ContextInjectedEvent
---

# Type Alias: ContextInjectedEvent

> **ContextInjectedEvent** = [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)\[`"agentfootprint.context.injected"`\]

Defined in: [src/recorders/core/contextEngineering.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/contextEngineering.ts#L113)

The shape of the event passed to `onEngineered` / `onBaseline`
callbacks. Same as `agentfootprint.context.injected`'s envelope —
we don't transform it, just route by source.
