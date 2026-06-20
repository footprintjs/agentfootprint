---
title: SkillRouteOptions
---

# Interface: SkillRouteOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:114](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L114)

Deterministic routing into a skill, keyed on the last tool result.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:122](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L122)

Caption rendered on the edge. Defaults to a derived label.

***

### onToolReturn?

> `readonly` `optional` **onToolReturn?**: `string` \| `RegExp`

Defined in: [src/lib/injection-engine/skillGraph.ts:120](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L120)

Sugar for "activate whenever this tool returns (any result)". String is an
 exact match; RegExp is tested against the tool name.

***

### when?

> `readonly` `optional` **when?**: (`result`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:117](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L117)

Predicate on the previous iteration's tool result → activate the target
 on the next iteration. The common, controllable edge.

#### Parameters

##### result

###### result

`string`

###### toolName

`string`

#### Returns

`boolean`
