---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/provider-contract/types.ts:836](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L836)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/provider-contract/types.ts:843](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L843)

***

### capability

> `readonly` **capability**: [`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

Defined in: [src/provider-contract/types.ts:842](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L842)

What kind of operation is being asked about. See
[PermissionCapability](/docs/api/type-aliases/PermissionCapability) for which values the framework actually sends
and when.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/provider-contract/types.ts:852](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L852)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/provider-contract/types.ts:865](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L865)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/provider-contract/types.ts:875](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L875)

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

Defined in: [src/provider-contract/types.ts:870](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L870)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/provider-contract/types.ts:859](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L859)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:885](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L885)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/provider-contract/types.ts:851](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L851)

What is being asked about, in the vocabulary of the capability:

- `'tool_call'` and every [ToolCapability](/docs/api/type-aliases/ToolCapability) — the TOOL NAME.
- `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
  the same name are two different subjects to a policy that lists ids.
