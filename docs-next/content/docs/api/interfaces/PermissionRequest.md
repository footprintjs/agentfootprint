---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/adapters/types.ts:423](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L423)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/adapters/types.ts:425](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L425)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [src/adapters/types.ts:424](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L424)

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:427](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L427)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:440](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L440)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/adapters/types.ts:450](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L450)

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

Defined in: [src/adapters/types.ts:445](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L445)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/adapters/types.ts:434](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L434)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:460](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L460)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/adapters/types.ts:426](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L426)
