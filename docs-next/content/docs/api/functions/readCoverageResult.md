---
title: readCoverageResult
---

# Function: readCoverageResult()

> **readCoverageResult**(`value`, `toolName?`): [`CoverageReading`](/docs/api/interfaces/CoverageReading) \| `undefined`

Defined in: [src/core/agent/coverage/read.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/read.ts#L223)

Read one finalized tool result for coverage declarations — and, since
honesty step 7b, for the period each declaration's read covered and an
absence's source and time. `toolName` names the tool in the one dev
warning a malformed period or provenance gets (it is left off the record,
never repaired); the dispatch door passes it, a post-hoc reader need not.

The two shapes compose: `coverage(absent({…}), {…})` is a search that found
nothing AND a boundary around the search, so both are declared and the
delivered status is still `'absent'` — the ledger bounds the answer, it
does not change what the answer was.

## Parameters

### value

`unknown`

### toolName?

`string`

## Returns

[`CoverageReading`](/docs/api/interfaces/CoverageReading) \| `undefined`
