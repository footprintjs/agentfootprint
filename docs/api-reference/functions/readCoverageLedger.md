[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readCoverageLedger

# Function: readCoverageLedger()

> **readCoverageLedger**(`value`): [`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`

Defined in: [src/core/agent/coverage/ledger.ts:116](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/ledger.ts#L116)

Recognize (or decline to recognize) a value as a covered result. STRICT for
the same reason `readAbsence` is: only a plain object carrying a plain
`af_coverage` object AND a `result` key qualifies.

## Parameters

### value

`unknown`

## Returns

[`CoveredResult`](/agentfootprint/api/generated/interfaces/CoveredResult.md)\<`unknown`\> \| `undefined`
