---
title: SkillRouteOptions
---

# Interface: SkillRouteOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L104)

Deterministic routing into a skill, keyed on the last tool result.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L112)

Caption rendered on the edge. Defaults to a derived label.

***

### onToolReturn?

> `readonly` `optional` **onToolReturn?**: `string` \| `RegExp`

Defined in: [src/lib/injection-engine/skillGraph.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L110)

Sugar for "activate whenever this tool returns (any result)". String is an
 exact match; RegExp is tested against the tool name.

***

### when?

> `readonly` `optional` **when?**: (`result`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L107)

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
