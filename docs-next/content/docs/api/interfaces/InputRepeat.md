---
title: InputRepeat
---

# Interface: InputRepeat

Defined in: [src/tools/inputRequest.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L100)

The runtime's mark on a RE-ASK: the same ask (same declaration
`id`) raised again in the same turn after the person answered it. Facts
only — never a reason. Stamped by the runtime, never declarable.

## Properties

### count

> `readonly` **count**: `number`

Defined in: [src/tools/inputRequest.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L102)

How many times the person has already answered this ask in this turn.

***

### previousAnswer?

> `readonly` `optional` **previousAnswer?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/tools/inputRequest.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L109)

The person's previous answer (the fields they supplied) as the RECORD
holds it — after the tool-result rules, redaction first among them, ran
on it. Absent when the record no longer holds it in that shape (a rule
replaced the result, placement moved it), never reconstructed.
