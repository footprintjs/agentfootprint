---
title: ActiveInjection
---

# Interface: ActiveInjection

Defined in: [src/lib/injection-engine/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L208)

POJO projection of an active Injection — flows through footprintjs
scope (which cannot serialize functions) so that slot subflows can
read it across the subflow boundary.

Drops the `trigger` (already evaluated) and projects `inject.tools`
to schemas only (the Tool's `execute` function lives on the Agent's
closure-held registry, looked up by injection id at exec time).

## Properties

### autoActivate?

> `readonly` `optional` **autoActivate?**: `"currentSkill"`

Defined in: [src/lib/injection-engine/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L229)

Per-skill tool gating intent (Skill flavor only). Reserved for
Block C+ runtime auto-wiring of `skillScopedTools`. Today
consumers wire this manually via `agentfootprint/tool-providers`.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/injection-engine/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L211)

***

### flavor

> `readonly` **flavor**: [`ContextSource`](/docs/api/type-aliases/ContextSource)

Defined in: [src/lib/injection-engine/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L210)

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L209)

***

### inject

> `readonly` **inject**: `object`

Defined in: [src/lib/injection-engine/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L230)

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

Defined in: [src/lib/injection-engine/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L223)

Resolved surfaceMode (Skill flavor only). Drives Block C runtime
dispatch — slot subflows skip system-slot injection when this is
`'tool-only'`; the read_skill tool delivers the body in its
result for `'tool-only'` and `'both'`.

`'auto'` and absent both mean "keep v2.4 behavior" (body in
system slot, tool result is confirmation only). The Block A4
cascade resolves 'auto' against provider/model context at a
later layer; this projection stays declarative.
