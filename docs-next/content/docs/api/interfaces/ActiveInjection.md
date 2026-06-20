---
title: ActiveInjection
---

# Interface: ActiveInjection

Defined in: [src/lib/injection-engine/types.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L203)

POJO projection of an active Injection — flows through footprintjs
scope (which cannot serialize functions) so that slot subflows can
read it across the subflow boundary.

Drops the `trigger` (already evaluated) and projects `inject.tools`
to schemas only (the Tool's `execute` function lives on the Agent's
closure-held registry, looked up by injection id at exec time).

## Properties

### autoActivate?

> `readonly` `optional` **autoActivate?**: `"currentSkill"`

Defined in: [src/lib/injection-engine/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L224)

Per-skill tool gating intent (Skill flavor only). Reserved for
Block C+ runtime auto-wiring of `skillScopedTools`. Today
consumers wire this manually via `agentfootprint/tool-providers`.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/injection-engine/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L206)

***

### flavor

> `readonly` **flavor**: [`ContextSource`](/docs/api/type-aliases/ContextSource)

Defined in: [src/lib/injection-engine/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L205)

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L204)

***

### inject

> `readonly` **inject**: `object`

Defined in: [src/lib/injection-engine/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L225)

#### messages?

> `readonly` `optional` **messages?**: readonly `object`[]

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

#### tools?

> `readonly` `optional` **tools?**: readonly `object`[]

Tool schemas only — `execute` lives on Agent's closure registry.

***

### surfaceMode?

> `readonly` `optional` **surfaceMode?**: `"system-prompt"` \| `"auto"` \| `"tool-only"` \| `"both"`

Defined in: [src/lib/injection-engine/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L218)

Resolved surfaceMode (Skill flavor only). Drives Block C runtime
dispatch — slot subflows skip system-slot injection when this is
`'tool-only'`; the read_skill tool delivers the body in its
result for `'tool-only'` and `'both'`.

`'auto'` and absent both mean "keep v2.4 behavior" (body in
system slot, tool result is confirmation only). The Block A4
cascade resolves 'auto' against provider/model context at a
later layer; this projection stays declarative.
