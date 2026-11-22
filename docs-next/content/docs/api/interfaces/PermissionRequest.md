---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/provider-contract/types.ts:798](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L798)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/provider-contract/types.ts:805](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L805)

***

### capability

> `readonly` **capability**: [`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

Defined in: [src/provider-contract/types.ts:804](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L804)

What kind of operation is being asked about. See
[PermissionCapability](/docs/api/type-aliases/PermissionCapability) for which values the framework actually sends
and when.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/provider-contract/types.ts:814](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L814)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/provider-contract/types.ts:827](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L827)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/provider-contract/types.ts:837](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L837)

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

Defined in: [src/provider-contract/types.ts:832](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L832)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/provider-contract/types.ts:821](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L821)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:847](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L847)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/provider-contract/types.ts:813](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L813)

What is being asked about, in the vocabulary of the capability:

- `'tool_call'` and every [ToolCapability](/docs/api/type-aliases/ToolCapability) — the TOOL NAME.
- `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
  the same name are two different subjects to a policy that lists ids.
