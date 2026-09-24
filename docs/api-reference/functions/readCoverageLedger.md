[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readCoverageLedger

# Function: readCoverageLedger()

> **readCoverageLedger**(`value`): [`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`

Defined in: [src/core/agent/coverage/ledger.ts:122](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/ledger.ts#L122)

Recognize (or decline to recognize) a value as a covered result. STRICT for
the same reason `readAbsence` is: only a plain object carrying a plain
`af_coverage` object AND a `result` key qualifies.

## Parameters

### value

`unknown`

## Returns

[`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`
