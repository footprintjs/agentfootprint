[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CoverageReading

# Interface: CoverageReading

Defined in: [src/core/agent/coverage/read.ts:35](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/read.ts#L35)

What one recognized result declares. `undefined` from
 [readCoverageResult](/agentfootprint/api/generated/functions/readCoverageResult.md) means "neither shape": untouched path.

## Properties

### declared

> `readonly` **declared**: readonly `CoverageFacts`[]

Defined in: [src/core/agent/coverage/read.ts:47](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/read.ts#L47)

In declaration order: the outer ledger first, then the absence it
 wraps. Usually one entry; two only when an author bounded an absence.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/agentfootprint/api/generated/type-aliases/ToolResultStatus.md)

Defined in: [src/core/agent/coverage/read.ts:44](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/read.ts#L44)

The status the framework DELIVERS for this call. `'absent'` when an
absence is in play — never `'failure'`, and that is the point: a status
of `'failure'` would route an honest empty answer down the same edge as
a broken collector, which is the exact confusion the primitive removes.
Undefined for a bare ledger — a ledger says nothing about the outcome,
only about its boundary.
