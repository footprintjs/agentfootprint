[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInEvidence

# Interface: CheckInEvidence

Defined in: [src/core/checkin.ts:58](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/checkin.ts#L58)

The evidence pack — the "receipts". The `'minimal'` assembler fills only
[willDo](/agentfootprint/api/generated/interfaces/CheckInEvidence.md#willdo) (zero cost); the `'standard'` assembler fills all four.

## Properties

### drivers?

> `readonly` `optional` **drivers?**: readonly [`CheckInDriver`](/agentfootprint/api/generated/interfaces/CheckInDriver.md)[]

Defined in: [src/core/checkin.ts:69](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/checkin.ts#L69)

Which context drove THIS choice, ranked most-to-least. Produced by the
 configured [CheckInScorer](/agentfootprint/api/generated/type-aliases/CheckInScorer.md) (default: a zero-LLM lexical scorer).
 Absent under the `'minimal'` assembler.

***

### read?

> `readonly` `optional` **read?**: readonly [`CheckInContextFrame`](/agentfootprint/api/generated/interfaces/CheckInContextFrame.md)[]

Defined in: [src/core/checkin.ts:65](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/checkin.ts#L65)

What context this run consumed so far — one frame per context piece
 (system rules, the user task, prior tool results). Absent under the
 `'minimal'` assembler.

***

### trail?

> `readonly` `optional` **trail?**: [`CheckInTrail`](/agentfootprint/api/generated/interfaces/CheckInTrail.md)

Defined in: [src/core/checkin.ts:71](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/checkin.ts#L71)

A compact grouped summary of the run so far. Absent under `'minimal'`.

***

### willDo

> `readonly` **willDo**: `string`

Defined in: [src/core/checkin.ts:61](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/checkin.ts#L61)

Plain-words claim of what will happen: the tool description + the
 rendered arguments. Always present.
