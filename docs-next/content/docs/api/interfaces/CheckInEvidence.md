---
title: CheckInEvidence
---

# Interface: CheckInEvidence

Defined in: [src/core/checkin.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L101)

The evidence pack — the "receipts". The `'minimal'` assembler fills only
[willDo](/docs/api/interfaces/CheckInEvidence#willdo) (zero cost); the `'standard'` assembler fills all four.

## Properties

### drivers?

> `readonly` `optional` **drivers?**: readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[]

Defined in: [src/core/checkin.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L122)

Which context drove THIS choice, ranked most-to-least. Produced by the
 configured [CheckInScorer](/docs/api/type-aliases/CheckInScorer) (default: a zero-LLM lexical scorer).
 Absent under the `'minimal'` assembler.

***

### read?

> `readonly` `optional` **read?**: readonly [`CheckInContextFrame`](/docs/api/interfaces/CheckInContextFrame)[]

Defined in: [src/core/checkin.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L118)

What context this run consumed so far — one frame per context piece
 (system rules, the user task, prior tool results). Absent under the
 `'minimal'` assembler.

***

### trail?

> `readonly` `optional` **trail?**: [`CheckInTrail`](/docs/api/interfaces/CheckInTrail)

Defined in: [src/core/checkin.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L124)

A compact grouped summary of the run so far. Absent under `'minimal'`.

***

### willDo

> `readonly` **willDo**: `string`

Defined in: [src/core/checkin.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L114)

Plain-words claim of what will happen: the tool description + the
arguments as [CheckInRequest.args](/docs/api/interfaces/CheckInRequest#args) shows them. When the view hides
values, the built-in assemblers end it with one fixed sentence naming them
(quoted) — the call still runs with the real values, to which the approval
is bound. A custom assembler is handed the same names
(`CheckInAssemblerInput.hiddenArgs`) and writes its own. Always present.

#### Example

```ts
a view hiding `to`
  'Wire money. — with to=REDACTED, amount=5000. Values hidden from this
  view: `to`. The call runs with the real values.'
```
