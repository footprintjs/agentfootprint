[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readCoverageResult

# Function: readCoverageResult()

> **readCoverageResult**(`value`): [`CoverageReading`](/agentfootprint/api/generated/interfaces/CoverageReading.md) \| `undefined`

Defined in: [src/core/agent/coverage/read.ts:60](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/read.ts#L60)

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
