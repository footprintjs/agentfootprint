[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CoverageReading

# Interface: CoverageReading

Defined in: [src/core/agent/coverage/read.ts:64](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/read.ts#L64)

What one recognized result declares. `undefined` from
 [readCoverageResult](/agentfootprint/api/generated/functions/readCoverageResult.md) means "neither shape": untouched path.

## Properties

### declared

> `readonly` **declared**: readonly `CoverageFacts`[]

Defined in: [src/core/agent/coverage/read.ts:76](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/read.ts#L76)

In declaration order: the outer ledger first, then the absence it
 wraps. Usually one entry; two only when an author bounded an absence.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/agentfootprint/api/generated/type-aliases/ToolResultStatus.md)

Defined in: [src/core/agent/coverage/read.ts:73](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/read.ts#L73)

The status the framework DELIVERS for this call. `'absent'` when an
absence is in play — never `'failure'`, and that is the point: a status
of `'failure'` would route an honest empty answer down the same edge as
a broken collector, which is the exact confusion the primitive removes.
Undefined for a bare ledger — a ledger says nothing about the outcome,
only about its boundary.
