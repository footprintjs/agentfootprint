[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / VerdictRow

# Interface: VerdictRow

Defined in: [src/core/runbook/types.ts:302](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/types.ts#L302)

One verdict row, as the chart wrote it. The bridge reads rows from the
 final state's `verdicts` key and requires only `verdict`; every other
 column is the app's own vocabulary.

## Indexable

> \[`column`: `string`\]: `unknown`

## Properties

### verdict

> `readonly` **verdict**: `string`

Defined in: [src/core/runbook/types.ts:303](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/types.ts#L303)
