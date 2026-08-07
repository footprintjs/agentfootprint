[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentInput

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:341](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/types.ts#L341)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:352](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/types.ts#L352)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:342](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/types.ts#L342)
