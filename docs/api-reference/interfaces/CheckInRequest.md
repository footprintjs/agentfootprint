[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInRequest

# Interface: CheckInRequest

Defined in: [src/core/checkin.ts:39](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/checkin.ts#L39)

The typed pause payload for one check-in. Rides the existing pause
machinery: it becomes the checkpoint's `pauseData` and is surfaced on
surfaced on `RunnerPauseOutcome.checkIn` (`core/pause.ts`). JSON/clone-safe.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:43](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/checkin.ts#L43)

The arguments the model proposed for this call.

***

### evidence

> `readonly` **evidence**: [`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)

Defined in: [src/core/checkin.ts:51](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/checkin.ts#L51)

The receipts riding the ask.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:49](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/checkin.ts#L49)

The model's stated reasoning for THIS call, when the assistant turn
carried text alongside the tool call. Omitted when the turn was a bare
tool call with no content.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/checkin.ts:41](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/checkin.ts#L41)

The tool the agent wants to run (its name).
