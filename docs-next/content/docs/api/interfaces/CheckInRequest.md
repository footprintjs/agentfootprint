---
title: CheckInRequest
---

# Interface: CheckInRequest

Defined in: [src/core/checkin.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L41)

The typed pause payload for one check-in. Rides the existing pause
machinery: it becomes the checkpoint's `pauseData` and is surfaced on
surfaced on `RunnerPauseOutcome.checkIn` (`core/pause.ts`). JSON/clone-safe.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L50)

The arguments the call will run with: the model's proposal, with any value
the inputs layer filled (a tool's `askOrAssume` `assume` rule) and any
before-tool middleware rewrite applied — what a person approves is what
runs.

***

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/checkin.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L67)

Which REGISTERED screen component collects the decision (9.24.0) — the
tool's own declaration (`defineTool({ checkIn, checkInComponent })`),
carried onto the ask. Absent means what it always meant: the screen
renders the evidence pack as prose. The answer is a `CheckInDecision`
either way — the component changes how the question is asked, never
what the answer is.

***

### evidence

> `readonly` **evidence**: [`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)

Defined in: [src/core/checkin.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L58)

The receipts riding the ask.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L56)

The model's stated reasoning for THIS call, when the assistant turn
carried text alongside the tool call. Omitted when the turn was a bare
tool call with no content.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/checkin.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L43)

The tool the agent wants to run (its name).
