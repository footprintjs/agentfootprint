---
title: SkillEntryOptions
---

# Interface: SkillEntryOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L116)

Where a turn starts. `when` (optional) makes entry intent-conditional.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L120)

***

### when?

> `readonly` `optional` **when?**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L119)

Predicate on the iteration context (e.g. `ctx.userMessage`). Omit → the
 skill is always active (a persistent base procedure).

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`
