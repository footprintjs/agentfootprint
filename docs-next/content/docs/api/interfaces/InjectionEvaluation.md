---
title: InjectionEvaluation
---

# Interface: InjectionEvaluation

Defined in: [src/lib/injection-engine/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L190)

Returned by `evaluateInjections()`. Slot subflows consume `active`;
`skipped` is observability metadata (predicate errors).

## Properties

### active

> `readonly` **active**: readonly [`Injection`](/docs/api/interfaces/Injection)[]

Defined in: [src/lib/injection-engine/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L191)

***

### skipped

> `readonly` **skipped**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L192)
