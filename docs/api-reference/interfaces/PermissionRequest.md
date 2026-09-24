[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionRequest

# Interface: PermissionRequest

Defined in: [src/adapters/types.ts:771](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L771)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/adapters/types.ts:778](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L778)

***

### capability

> `readonly` **capability**: [`PermissionCapability`](/agentfootprint/api/generated/type-aliases/PermissionCapability.md)

Defined in: [src/adapters/types.ts:777](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L777)

What kind of operation is being asked about. See
[PermissionCapability](/agentfootprint/api/generated/type-aliases/PermissionCapability.md) for which values the framework actually sends
and when.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:787](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L787)

***

### history?

> `readonly` `optional` **history?**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/adapters/types.ts:800](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L800)

v2.12 — Full conversation history at check time. Lets policies
inspect prior assistant content / tool results without maintaining
parallel state via event subscription.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/adapters/types.ts:810](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L810)

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

Defined in: [src/adapters/types.ts:805](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L805)

v2.12 — Current ReAct iteration (1-based). Lets policies fire
different rules per iteration without external counters.

***

### sequence?

> `readonly` `optional` **sequence?**: readonly [`ToolCallEntry`](/agentfootprint/api/generated/interfaces/ToolCallEntry.md)[]

Defined in: [src/adapters/types.ts:794](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L794)

v2.12 — Sequence of tool calls already dispatched this run, in
call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
policies (forbidden chains, idempotency limits) read this to make
decisions that single-call governance cannot.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:820](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L820)

v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
— when the agent run is cancelled, in-flight checks should abort.

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/adapters/types.ts:786](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L786)

What is being asked about, in the vocabulary of the capability:

- `'tool_call'` and every [ToolCapability](/agentfootprint/api/generated/type-aliases/ToolCapability.md) — the TOOL NAME.
- `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
  the same name are two different subjects to a policy that lists ids.
