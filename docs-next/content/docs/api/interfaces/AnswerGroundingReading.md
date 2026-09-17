---
title: AnswerGroundingReading
---

# Interface: AnswerGroundingReading

Defined in: [src/integrity/prior-turn-evidence/check.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L109)

What the library could read about one judged answer's grounding.

Produced by the evidence gate (`checkAnswer`), which is the only component
that knows both which tokens in the answer are DATA and which of them the
index could ground. Passed IN rather than re-derived here, for the reason
`readLookupResult` takes `declaredAbsence` as a parameter: the extractor has
exactly one owner, and a second reading of "what counts as a value" would
eventually disagree with the first.

## Properties

### currentTurn

> `readonly` **currentTurn**: `number`

Defined in: [src/integrity/prior-turn-evidence/check.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L129)

The turn in progress, on the same window-relative scale. `0` = the
history carries no user turn at all, and then there is no boundary to
measure against.

***

### fromPriorTurns

> `readonly` **fromPriorTurns**: `number`

Defined in: [src/integrity/prior-turn-evidence/check.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L113)

Grounded values whose newest source is older than the turn in progress.

***

### fromThisTurn

> `readonly` **fromThisTurn**: `number`

Defined in: [src/integrity/prior-turn-evidence/check.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L111)

Grounded values whose newest source is a result THIS turn served.

***

### indexTruncated

> `readonly` **indexTruncated**: `boolean`

Defined in: [src/integrity/prior-turn-evidence/check.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L137)

The evidence index hit its ceiling and is INCOMPLETE. A partial index can
miss the very occurrence that would have stamped a value with this turn,
so provenance from one is not something to file on.

***

### latestPriorTurn?

> `readonly` `optional` **latestPriorTurn?**: `number`

Defined in: [src/integrity/prior-turn-evidence/check.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L123)

The newest turn any of those older values came from. Absent when
`fromPriorTurns` is 0. This is the number a reader wants first: "turn 2,
and we are on turn 4".

Counted over the user turns still in the run's window, so under a window
strategy it is not the conversation's own ordinal and the distance from
`currentTurn` is a FLOOR.

***

### toolResultsThisTurn

> `readonly` **toolResultsThisTurn**: `number`

Defined in: [src/integrity/prior-turn-evidence/check.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/prior-turn-evidence/check.ts#L131)

How many `role: 'tool'` results this turn served. `0` is the sharp case.
