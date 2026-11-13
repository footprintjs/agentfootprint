---
title: PermissionRequest
---

# Interface: PermissionRequest

Defined in: [src/provider-contract/types.ts:861](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L861)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/provider-contract/types.ts:868](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L868)

***

### capability

> `readonly` **capability**: [`PermissionCapability`](/docs/api/type-aliases/PermissionCapability)

Defined in: [src/provider-contract/types.ts:867](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L867)

What kind of operation is being asked about. See
[PermissionCapability](/docs/api/type-aliases/PermissionCapability) for which values the framework actually sends
and when.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/provider-contract/types.ts:877](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L877)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/provider-contract/types.ts:890](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L890)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/provider-contract/types.ts:900](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L900)

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

Defined in: [src/provider-contract/types.ts:895](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L895)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/provider-contract/types.ts:884](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L884)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:910](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L910)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/provider-contract/types.ts:876](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L876)

What is being asked about, in the vocabulary of the capability:

- `'tool_call'` and every [ToolCapability](/docs/api/type-aliases/ToolCapability) — the TOOL NAME.
- `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
  the same name are two different subjects to a policy that lists ids.
