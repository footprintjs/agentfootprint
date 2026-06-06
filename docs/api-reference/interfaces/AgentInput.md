[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentInput

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/agent/types.ts#L162)

## Properties

### identity?

> `readonly` `optional` **identity?**: [`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

Defined in: [src/core/agent/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/agent/types.ts#L173)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/agent/types.ts#L163)
