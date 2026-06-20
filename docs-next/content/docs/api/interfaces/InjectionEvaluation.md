---
title: InjectionEvaluation
---

# Interface: InjectionEvaluation

Defined in: [src/lib/injection-engine/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L185)

Returned by `evaluateInjections()`. Slot subflows consume `active`;
`skipped` is observability metadata (predicate errors).

## Properties

### active

> `readonly` **active**: readonly [`Injection`](/docs/api/interfaces/Injection)[]

Defined in: [src/lib/injection-engine/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L186)

***

### skipped

> `readonly` **skipped**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L187)
