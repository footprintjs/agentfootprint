---
title: InputRepeat
---

# Interface: InputRepeat

Defined in: [src/core/inputRequest.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L62)

The runtime's mark on a RE-ASK: the same ask (same declaration
`id`) raised again in the same turn after the person answered it. Facts
only — never a reason. Stamped by the runtime, never declarable.

## Properties

### count

> `readonly` **count**: `number`

Defined in: [src/core/inputRequest.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L64)

How many times the person has already answered this ask in this turn.

***

### previousAnswer?

> `readonly` `optional` **previousAnswer?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L71)

The person's previous answer (the fields they supplied) as the RECORD
holds it — after the tool-result rules, redaction first among them, ran
on it. Absent when the record no longer holds it in that shape (a rule
replaced the result, placement moved it), never reconstructed.
