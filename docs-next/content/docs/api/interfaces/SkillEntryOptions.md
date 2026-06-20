---
title: SkillEntryOptions
---

# Interface: SkillEntryOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:126](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L126)

Where a turn starts. `when` (optional) makes entry intent-conditional.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:130](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L130)

***

### when?

> `readonly` `optional` **when?**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:129](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L129)

Predicate on the iteration context (e.g. `ctx.userMessage`). Omit → the
 skill is always active (a persistent base procedure).

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`
