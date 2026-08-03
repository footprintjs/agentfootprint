---
title: AgentInput
---

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:316](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L316)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:327](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L327)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:317](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L317)
