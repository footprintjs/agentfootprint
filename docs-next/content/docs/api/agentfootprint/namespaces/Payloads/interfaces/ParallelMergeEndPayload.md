---
title: ParallelMergeEndPayload
---

# Interface: ParallelMergeEndPayload

Defined in: [src/events/payloads.ts:57](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L57)

## Properties

### mergedBranchCount

> `readonly` **mergedBranchCount**: `number`

Defined in: [src/events/payloads.ts:72](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L72)

Number of branches whose result FED the merge — i.e., succeeded
 (or, in tolerant mode, those the merge fn actually consumed as
 `{ok: true}`). Failing branches are counted in `totalBranchCount
 - mergedBranchCount`.

***

### parentId

> `readonly` **parentId**: `string`

Defined in: [src/events/payloads.ts:58](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L58)

***

### resultSummary

> `readonly` **resultSummary**: `string`

Defined in: [src/events/payloads.ts:67](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L67)

***

### strategy

> `readonly` **strategy**: `"llm"` \| `"fn"` \| `"outcomes-fn"`

Defined in: [src/events/payloads.ts:66](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L66)

Which merge strategy ran. `'fn'` = `mergeWithFn` (strict, plain
results map). `'llm'` = `mergeWithLLM` (strict, LLM synthesis).
`'outcomes-fn'` = `mergeOutcomesWithFn` (tolerant, full
`BranchOutcome` map). Distinct values so consumers can render
tolerant vs strict merges differently in dashboards.

***

### totalBranchCount

> `readonly` **totalBranchCount**: `number`

Defined in: [src/events/payloads.ts:75](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L75)

Total number of branches declared on the Parallel — equals
 `mergedBranchCount` on all-success runs, larger on partial.
