[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readCoverageResult

# Function: readCoverageResult()

> **readCoverageResult**(`value`): [`CoverageReading`](/agentfootprint/api/generated/interfaces/CoverageReading.md) \| `undefined`

Defined in: [src/core/agent/coverage/read.ts:59](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/coverage/read.ts#L59)

Read one finalized tool result for coverage declarations.

The two shapes compose: `coverage(absent({…}), {…})` is a search that found
nothing AND a boundary around the search, so both are declared and the
delivered status is still `'absent'` — the ledger bounds the answer, it
does not change what the answer was.

## Parameters

### value

`unknown`

## Returns

[`CoverageReading`](/agentfootprint/api/generated/interfaces/CoverageReading.md) \| `undefined`
