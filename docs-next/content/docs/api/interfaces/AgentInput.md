---
title: AgentInput
---

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L252)

## Properties

### identity?

> `readonly` `optional` **identity?**: [`MemoryIdentity`](/docs/api/interfaces/MemoryIdentity)

Defined in: [src/core/agent/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L263)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L253)
