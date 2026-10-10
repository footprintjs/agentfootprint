---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/adapters/types.ts:739](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L739)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/adapters/types.ts:746](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L746)

***

### capability

> `readonly` **capability**: [`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

Defined in: [src/adapters/types.ts:745](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L745)

What kind of operation is being asked about. See
[PermissionCapability](/docs/api/type-aliases/PermissionCapability) for which values the framework actually sends
and when.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:755](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L755)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:768](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L768)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/adapters/types.ts:778](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L778)

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

Defined in: [src/adapters/types.ts:773](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L773)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/adapters/types.ts:762](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L762)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:788](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L788)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/adapters/types.ts:754](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L754)

What is being asked about, in the vocabulary of the capability:

- `'tool_call'` and every [ToolCapability](/docs/api/type-aliases/ToolCapability) — the TOOL NAME.
- `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
  the same name are two different subjects to a policy that lists ids.
