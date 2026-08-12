[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentInput

# Interface: AgentInput

Defined in: [src/core/agent/types.ts:450](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/types.ts#L450)

## Properties

### continueFrom?

> `readonly` `optional` **continueFrom?**: [`AgentRunCheckpoint`](/agentfootprint/api/generated/interfaces/AgentRunCheckpoint.md)

Defined in: [src/core/agent/types.ts:523](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/types.ts#L523)

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

Defined in: [src/core/agent/types.ts:494](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/types.ts#L494)

WHO this run is for — the scoping tuple, not a session handle.

Committed to `scope.runIdentity` at seed and read by five consumers:
memory + RAG namespacing (`.memory()` / `.rag()` isolate reads and
writes per tenant + principal + conversation), `PermissionChecker.check`,
the `.toolMiddleware()` / `.messageMiddleware()` chains,
`ToolProvider.list(ctx)`, and the credential provider.

Since 9.7.0 it also reaches `tool.execute` as `ctx.identity` — but only
when you PASSED one. The default `{ conversationId: '<runId>' }` below is
synthesized, and a tool told about a conversation nobody named would key a
session on a fiction, so `ctx.identity` is absent in that case. A DERIVED
identity (the session rule below) is synthesized too, and is absent there
for the same reason.

**When omitted, one of two defaults applies (9.10.0):**

 - the run carries a `sessionId` (`agent.run(input, { sessionId })`, which
   is what `standingAgent` passes from every served request) →
   `{ conversationId: sessionId }`. A hosting session IS a conversation, so
   a served session gets durable per-user memory with no configuration at
   all. Before 9.10.0 it got the per-run default below and a fresh runId
   every turn, which meant a registered `.memory()` recalled nothing across
   the turns of one session.
 - no session either → `{ conversationId: '<runId>' }`, unchanged, so
   agents without memory and scripts that name nobody work exactly as they
   did.

An identity you pass ALWAYS wins over the derivation — including the one a
continued conversation carries, so a turn cannot silently re-namespace the
conversation it is continuing.

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

Defined in: [src/core/agent/types.ts:451](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/types.ts#L451)
