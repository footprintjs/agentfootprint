[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunnerPauseOutcome

# Interface: RunnerPauseOutcome

Defined in: [agentfootprint/src/core/pause.ts:27](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/pause.ts#L27)

Outcome returned by `runner.run()` / `runner.resume()` when execution
has paused mid-flow. The shape mirrors footprintjs's `PausedResult` but
surfaces `pauseData` as a first-class field for consumers who don't
want to reach into the checkpoint.

## Properties

### checkpoint

> `readonly` **checkpoint**: `FlowchartCheckpoint`

Defined in: [agentfootprint/src/core/pause.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/pause.ts#L30)

Serializable checkpoint — store anywhere (Redis, Postgres, localStorage).

***

### paused

> `readonly` **paused**: `true`

Defined in: [agentfootprint/src/core/pause.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/pause.ts#L28)

***

### pauseData

> `readonly` **pauseData**: `unknown`

Defined in: [agentfootprint/src/core/pause.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/pause.ts#L32)

Data passed to `scope.$pause()` / `pauseHere()`. Consumer-typed.
