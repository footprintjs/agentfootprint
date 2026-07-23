---
title: RunnerPauseOutcome
---

# Interface: RunnerPauseOutcome

Defined in: [src/core/pause.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L28)

Outcome returned by `runner.run()` / `runner.resume()` when execution
has paused mid-flow. The shape mirrors footprintjs's `PausedResult` but
surfaces `pauseData` as a first-class field for consumers who don't
want to reach into the checkpoint.

## Properties

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInRequest`](/docs/api/interfaces/CheckInRequest)

Defined in: [src/core/pause.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L41)

Present ONLY when this pause is an evidence-carrying check-in (a tool
declared `checkIn`). Carries the typed ask + evidence pack. Absent for
plain `askHuman` / `pauseHere` pauses — that's the clean discriminant
between the two pause kinds. Resume with a `CheckInDecision`
(`checkInApproved` / `checkInDeclined`).

***

### checkpoint

> `readonly` **checkpoint**: `FlowchartCheckpoint`

Defined in: [src/core/pause.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L31)

Serializable checkpoint — store anywhere (Redis, Postgres, localStorage).

***

### paused

> `readonly` **paused**: `true`

Defined in: [src/core/pause.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L29)

***

### pauseData

> `readonly` **pauseData**: `unknown`

Defined in: [src/core/pause.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L33)

Data passed to `scope.$pause()` / `pauseHere()`. Consumer-typed.
