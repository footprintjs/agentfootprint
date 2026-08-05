[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentInput

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:318](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/types.ts#L318)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:329](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/types.ts#L329)

Multi-tenant memory scope. Populated to `scope.identity` so memory
subflows registered via `.memory()` can isolate reads/writes per
tenant + principal + conversation.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/types.ts#L319)
