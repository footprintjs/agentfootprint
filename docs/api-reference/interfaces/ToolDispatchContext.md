[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolDispatchContext

# Interface: ToolDispatchContext

Defined in: [src/tool-providers/types.ts:60](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L60)

Read-only context the provider receives each iteration. Pure data
— providers MUST NOT mutate. Used by gating predicates to inspect
the current activation state.

## Properties

### activeSkillId?

> `readonly` `optional` **activeSkillId?**: `string`

Defined in: [src/tool-providers/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L68)

The id of the currently-activated Skill, if any.
Set by `read_skill(id)` activation; cleared between turns.
Used by `autoActivate`-driven per-skill tool gating.

***

### identity?

> `readonly` `optional` **identity?**: `object`

Defined in: [src/tool-providers/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L74)

Caller identity tuple — passed through from `agent.run({ identity })`.
Permission predicates can role-check based on `identity.principal`
or `identity.tenant`.

#### conversationId

> `readonly` **conversationId**: `string`

#### principal?

> `readonly` `optional` **principal?**: `string`

#### tenant?

> `readonly` `optional` **tenant?**: `string`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/tool-providers/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L62)

Current ReAct iteration (1-based).

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/tool-providers/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/tool-providers/types.ts#L87)

Optional abort signal propagated from the agent's `run({ env })` /
AbortController. Async providers (network discovery, MCP catalog
fetch, registry pull) MUST honor this — abandon the in-flight
request when the agent is cancelled mid-discovery, otherwise the
provider holds the run open past abort. Sync providers can ignore
it.
