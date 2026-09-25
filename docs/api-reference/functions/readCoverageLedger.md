[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readCoverageLedger

# Function: readCoverageLedger()

> **readCoverageLedger**(`value`): [`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`

Defined in: [src/core/agent/coverage/ledger.ts:122](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/ledger.ts#L122)

Recognize (or decline to recognize) a value as a covered result. STRICT for
the same reason `readAbsence` is: only a plain object carrying a plain
`af_coverage` object AND a `result` key qualifies.

## Parameters

### value

`unknown`

## Returns

[`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`
