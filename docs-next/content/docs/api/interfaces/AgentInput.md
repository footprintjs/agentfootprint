---
title: AgentInput
---

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L278)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L289)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:279](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L279)
