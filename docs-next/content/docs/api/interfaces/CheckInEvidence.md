---
title: CheckInEvidence
---

# Interface: CheckInEvidence

Defined in: [src/core/checkin.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L86)

The evidence pack — the "receipts". The `'minimal'` assembler fills only
[willDo](/docs/api/interfaces/CheckInEvidence#willdo) (zero cost); the `'standard'` assembler fills all four.

## Properties

### drivers?

> `readonly` `optional` **drivers?**: readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[]

Defined in: [src/core/checkin.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L97)

Which context drove THIS choice, ranked most-to-least. Produced by the
 configured [CheckInScorer](/docs/api/type-aliases/CheckInScorer) (default: a zero-LLM lexical scorer).
 Absent under the `'minimal'` assembler.

***

### read?

> `readonly` `optional` **read?**: readonly [`CheckInContextFrame`](/docs/api/interfaces/CheckInContextFrame)[]

Defined in: [src/core/checkin.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L93)

What context this run consumed so far — one frame per context piece
 (system rules, the user task, prior tool results). Absent under the
 `'minimal'` assembler.

***

### trail?

> `readonly` `optional` **trail?**: [`CheckInTrail`](/docs/api/interfaces/CheckInTrail)

Defined in: [src/core/checkin.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L99)

A compact grouped summary of the run so far. Absent under `'minimal'`.

***

### willDo

> `readonly` **willDo**: `string`

Defined in: [src/core/checkin.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L89)

Plain-words claim of what will happen: the tool description + the
 rendered arguments. Always present.
