[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildRunSteps

# ~~Function: buildRunSteps()~~

> **buildRunSteps**(`source`, `options?`): [`RunStep`](/agentfootprint/api/generated/interfaces/RunStep.md)[]

Defined in: [src/recorders/observability/RunStepRecorder.ts:760](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L760)

Compatibility shim for snapshot-from-events use cases (replay,
post-hoc analysis, tests). For LIVE use, prefer attaching a
`RunStepRecorder` directly via `runner.attach(rec)` —
`buildRunSteps(events)` constructs a fresh recorder, replays the
events through its handlers, and returns the resulting entries.

## Parameters

### source

[`BoundaryRecorder`](/agentfootprint/api/generated/classes/BoundaryRecorder.md) \| readonly [`DomainEvent`](/agentfootprint/api/generated/type-aliases/DomainEvent.md)[]

### options?

[`BuildRunStepsOptions`](/agentfootprint/api/generated/interfaces/BuildRunStepsOptions.md) = `{}`

## Returns

[`RunStep`](/agentfootprint/api/generated/interfaces/RunStep.md)[]

## Deprecated

Prefer `runStepRecorder()` + `runner.attach(rec)` for
            live consumers. This shim remains for offline / testing
            scenarios where only a recorded event list is available.
