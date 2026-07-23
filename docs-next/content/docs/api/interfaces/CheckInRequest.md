---
title: CheckInRequest
---

# Interface: CheckInRequest

Defined in: src/core/checkin.ts:39

The typed pause payload for one check-in. Rides the existing pause
machinery: it becomes the checkpoint's `pauseData` and is surfaced on
../core/pause.ts RunnerPauseOutcome.checkIn. JSON/clone-safe.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/checkin.ts:43

The arguments the model proposed for this call.

***

### evidence

> `readonly` **evidence**: [`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)

Defined in: src/core/checkin.ts:51

The receipts riding the ask.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: src/core/checkin.ts:49

The model's stated reasoning for THIS call, when the assistant turn
carried text alongside the tool call. Omitted when the turn was a bare
tool call with no content.

***

### tool

> `readonly` **tool**: `string`

Defined in: src/core/checkin.ts:41

The tool the agent wants to run (its name).
