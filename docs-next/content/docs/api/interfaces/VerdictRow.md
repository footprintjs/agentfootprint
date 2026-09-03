---
title: VerdictRow
---

# Interface: VerdictRow

Defined in: [src/core/runbook/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L289)

One verdict row, as the chart wrote it. The bridge reads rows from the
 final state's `verdicts` key and requires only `verdict`; every other
 column is the app's own vocabulary.

## Indexable

> \[`column`: `string`\]: `unknown`

## Properties

### verdict

> `readonly` **verdict**: `string`

Defined in: [src/core/runbook/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L290)
