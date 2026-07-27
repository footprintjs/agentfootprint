---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/adapters/types.ts:405](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L405)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/adapters/types.ts:407](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L407)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [src/adapters/types.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L406)

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:409](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L409)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:422](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L422)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/adapters/types.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L432)

v2.12 — Caller identity from `agent.run({ identity })`. Permission
predicates can role-check on `identity.principal` / `identity.tenant`.

#### conversationId

> `readonly` **conversationId**: `string`

#### principal?

> `readonly` `optional` **principal?**: `string`

#### tenant?

> `readonly` `optional` **tenant?**: `string`

***

### iteration?

> `readonly` `optional` **iteration?**: `number`

Defined in: [src/adapters/types.ts:427](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L427)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/adapters/types.ts:416](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L416)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:442](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L442)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/adapters/types.ts:408](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L408)
