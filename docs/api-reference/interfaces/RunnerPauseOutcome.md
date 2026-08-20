[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunnerPauseOutcome

# Interface: RunnerPauseOutcome

Defined in: [src/core/pause.ts:30](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L30)

Outcome returned by `runner.run()` / `runner.resume()` when execution
has paused mid-flow. The shape mirrors footprintjs's `PausedResult` but
surfaces `pauseData` as a first-class field for consumers who don't
want to reach into the checkpoint.

## Properties

### ask?

> `readonly` `optional` **ask?**: [`MiddlewareAsk`](/agentfootprint/api/generated/interfaces/MiddlewareAsk.md)

Defined in: [src/core/pause.ts:59](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L59)

Present ONLY when a `toolMiddleware` answered `ask` — the question it put
to a person, plus the middleware that asked. Absent for every other pause,
which is the discriminant.

Resume with a `CheckInDecision` (`checkInApproved` / `checkInDeclined`).
That is deliberate rather than a second decision type: a person approving
is a person approving, whether the gate was a tool's `checkIn` or a
middleware's `ask`, and one word for one thing beats a synonym.

The answer is a DECISION, not a result. Approve and the chain resumes from
the next middleware and the REAL tool runs; decline and the model receives
a denial it can adapt to. Nobody — not the middleware, not the person —
gets to write the tool's answer.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInRequest`](/agentfootprint/api/generated/interfaces/CheckInRequest.md)

Defined in: [src/core/pause.ts:43](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L43)

Present ONLY when this pause is an evidence-carrying check-in (a tool
declared `checkIn`). Carries the typed ask + evidence pack. Absent for
plain `askHuman` / `pauseHere` pauses — that's the clean discriminant
between the two pause kinds. Resume with a `CheckInDecision`
(`checkInApproved` / `checkInDeclined`).

***

### checkpoint

> `readonly` **checkpoint**: `FlowchartCheckpoint`

Defined in: [src/core/pause.ts:33](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L33)

Serializable checkpoint — store anywhere (Redis, Postgres, localStorage).

***

### paused

> `readonly` **paused**: `true`

Defined in: [src/core/pause.ts:31](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L31)

***

### pauseData

> `readonly` **pauseData**: `unknown`

Defined in: [src/core/pause.ts:35](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L35)

Data passed to `scope.$pause()` / `pauseHere()`. Consumer-typed.
