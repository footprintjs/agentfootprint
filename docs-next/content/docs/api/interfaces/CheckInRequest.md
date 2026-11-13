---
title: CheckInRequest
---

# Interface: CheckInRequest

Defined in: [src/core/checkin.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L43)

The typed pause payload for one check-in. Rides the existing pause
machinery: it becomes the checkpoint's `pauseData` and is surfaced on
`RunnerPauseOutcome.checkIn` (`core/pause.ts`). JSON/clone-safe.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L68)

The arguments of the call, SHOWN THROUGH THE TOOL'S ARGUMENT VIEW: the
model's proposal, with any value the inputs layer filled (a tool's
`askOrAssume` `assume` rule) and any before-tool middleware rewrite
applied, then the tool's view. With `flowchartAsTool({ redact })` /
`runbookAsTool({ redact })` a hidden value reads `'REDACTED'`; a view set
by hand may show another form or leave the key out. Either way the
argument is named in [hiddenArgs](/docs/api/interfaces/CheckInRequest#hiddenargs). The call runs with the REAL
values, to which the approval is bound through [id](/docs/api/interfaces/CheckInRequest#id). A tool without
a view shows every value as it will run. Example, a view hiding `to`:
`{ to: 'REDACTED', amount: 5000 }`; on approval the tool gets `to: 'acct-9'`.

***

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/checkin.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L94)

Which REGISTERED screen component collects the decision (9.24.0) — the
tool's own declaration (`defineTool({ checkIn, checkInComponent })`),
carried onto the ask. Absent means what it always meant: the screen
renders the evidence pack as prose. The answer is a `CheckInDecision`
either way — the component changes how the question is asked, never
what the answer is.

***

### evidence

> `readonly` **evidence**: [`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)

Defined in: [src/core/checkin.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L85)

The receipts riding the ask.

***

### hiddenArgs?

> `readonly` `optional` **hiddenArgs?**: readonly `string`[]

Defined in: [src/core/checkin.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L77)

The arguments the tool's view hides from [args](/docs/api/interfaces/CheckInRequest#args), by name, in argument
order — what a screen tells the person they cannot see; absent when none.
The library's reading of the view (`toolShownArgs.ts` · `hiddenArgNames`,
which says what it cannot see), never of the shown text.
Bound into [id](/docs/api/interfaces/CheckInRequest#id) and kept with the pause; the decision's record
carries this same list (`CheckInDecisionPayload.hiddenArgs`).

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L53)

Names this request: the id a decision quotes
(`checkInApproved({ request: outcome.checkIn, by })`). Minted when the run
paused, unique to this pause, and bound to the exact call that runs on
approval — the tool, [args](/docs/api/interfaces/CheckInRequest#args), the call id, the served party and
[hiddenArgs](/docs/api/interfaces/CheckInRequest#hiddenargs). A decision for any other request, or for a call that
changed after the ask, is refused (`ResumeDecisionError`). An opaque
fingerprint: it carries no value from the run.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L83)

The model's stated reasoning for THIS call, when the assistant turn
carried text alongside the tool call. Omitted when the turn was a bare
tool call with no content.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/checkin.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L55)

The tool the agent wants to run (its name).
