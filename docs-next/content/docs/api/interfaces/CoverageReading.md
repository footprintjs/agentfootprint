---
title: CoverageReading
---

# Interface: CoverageReading

Defined in: [src/semantics/coverage/read.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/read.ts#L137)

What one recognized result declares. `undefined` from
 [readCoverageResult](/docs/api/functions/readCoverageResult) means "neither shape": untouched path.

## Properties

### declared

> `readonly` **declared**: readonly `CoverageFacts`[]

Defined in: [src/semantics/coverage/read.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/read.ts#L149)

In declaration order: the outer ledger first, then the absence it
 wraps. Usually one entry; two only when an author bounded an absence.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/semantics/coverage/read.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/read.ts#L146)

The status the framework DELIVERS for this call. `'absent'` when an
absence is in play — never `'failure'`, and that is the point: a status
of `'failure'` would route an honest empty answer down the same edge as
a broken collector, which is the exact confusion the primitive removes.
Undefined for a bare ledger — a ledger says nothing about the outcome,
only about its boundary.
