---
title: Bound
---

# Interface: Bound

Defined in: [src/core/time/periodForm.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/periodForm.ts#L68)

One bound of a two-argument period. A `from` bound is inclusive (its `edge`,
when written, can only say so); a `to` bound MUST say its edge
(ToBound) — TQ18: the library never guesses a tool's edge, only the
sugar defaults (`inclusive`).

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/time/periodForm.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/periodForm.ts#L69)

***

### as

> `readonly` **as**: [`BoundAs`](/docs/api/type-aliases/BoundAs)

Defined in: [src/core/time/periodForm.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/periodForm.ts#L70)

***

### edge?

> `readonly` `optional` **edge?**: `Edge`

Defined in: [src/core/time/periodForm.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/periodForm.ts#L71)
