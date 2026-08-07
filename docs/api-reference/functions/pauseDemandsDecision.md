[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / pauseDemandsDecision

# Function: pauseDemandsDecision()

> **pauseDemandsDecision**(`pauseData`): [`ConsentGate`](/agentfootprint/api/generated/interfaces/ConsentGate.md) \| `undefined`

Defined in: [src/core/pause.ts:154](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/pause.ts#L154)

Read a pause payload and say whether answering it requires a
`CheckInDecision` — and if so, which gate is outstanding.

THE ONE reader of that shape. `RunnerBase.detectPause` builds
`outcome.checkIn` / `outcome.ask` from this, and `Agent.resume` refuses a
mis-shaped answer from this, so the surface a consumer is told about and the
surface the library enforces cannot drift apart.

Keyed on the PAUSE, never on the input: a plain `askHuman` answer is a string
and must stay one, so "is this the right answer?" can only be decided by
knowing what was asked.

## Parameters

### pauseData

`unknown`

## Returns

[`ConsentGate`](/agentfootprint/api/generated/interfaces/ConsentGate.md) \| `undefined`

the gate, or `undefined` when this pause takes any value.
