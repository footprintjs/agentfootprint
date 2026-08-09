[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentInput

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/types.ts#L392)

## Properties

### continueFrom?

> `readonly` `optional` **continueFrom?**: [`AgentRunCheckpoint`](/agentfootprint/api/generated/interfaces/AgentRunCheckpoint.md)

Defined in: [src/core/agent/types.ts:445](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/types.ts#L445)

The conversation this turn continues — an `AgentRunCheckpoint` from
`agent.checkpoint()`, persisted anywhere and handed back here.

This is THE conversation door, and the reason it has to be asked for:
`run()` is **one turn**. Without `continueFrom` the run seeds its history
from this call's `message` alone, so a second `run()` on the same agent
starts a new conversation and the model will honestly say it has not
spoken to you before.

The stored history is restored, this call's `message` is appended to it as
the next user turn, and the run proceeds. `identity` and the conversation's
folded spans ride along from the checkpoint unless this call overrides
them — a continued turn that silently re-namespaced its own memory would
write turn two somewhere turn one cannot be read from.

`agent.followUp(message)` is the same thing for the common case, reading
the conversation off this agent's own last completed run.

#### Example

```ts
await agent.run({ message: 'Book me a table for two.' });
const conversation = agent.checkpoint();     // persist anywhere
// …a restart later, on a fresh Agent:
await agent.run({ message: 'Make it three.', continueFrom: conversation });
```

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:416](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/types.ts#L416)

WHO this run is for — the scoping tuple, not a session handle.

Committed to `scope.runIdentity` at seed and read by five consumers:
memory + RAG namespacing (`.memory()` / `.rag()` isolate reads and
writes per tenant + principal + conversation), `PermissionChecker.check`,
the `.toolMiddleware()` / `.messageMiddleware()` chains,
`ToolProvider.list(ctx)`, and the credential provider. It does NOT reach
`tool.execute` — `ToolExecutionContext` carries no identity field.

Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
without memory work unchanged.

**`conversationId` is a namespace key, not a conversation.** Passing the
same `conversationId` to two `run()` calls does NOT continue the first
one: `run()` is one turn and seeds `history` from this call's message
alone. What continues a conversation is [AgentInput.continueFrom](/agentfootprint/api/generated/interfaces/AgentInput.md#continuefrom)
(or `agent.followUp(message)`); what makes prior turns *recallable* under
this key is a registered memory, and that recall arrives in the
system-prompt slot as a `<memory>` block rather than as message turns.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:393](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/types.ts#L393)
