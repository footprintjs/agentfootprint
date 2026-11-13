---
title: CheckInRequest
---

# Interface: CheckInRequest

Defined in: [src/core/checkin.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L43)

The typed pause payload for one check-in. Rides the existing pause
machinery: it becomes the checkpoint's `pauseData` and is surfaced on
surfaced on `RunnerPauseOutcome.checkIn` (`core/pause.ts`). JSON/clone-safe.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L72)

The arguments of the call, SHOWN THROUGH THE TOOL'S ARGUMENT VIEW: the
model's proposal, with any value the inputs layer filled (a tool's
`askOrAssume` `assume` rule) and any before-tool middleware rewrite
applied, then the tool's view (`flowchartAsTool({ redact })`,
`runbookAsTool({ redact })`). A value the view hides reads `'REDACTED'`
here and its argument is named in [hiddenArgs](/docs/api/interfaces/CheckInRequest#hiddenargs). The call runs with
the REAL values, and the approval is bound to them through [id](/docs/api/interfaces/CheckInRequest#id): a
person who approves a call with hidden values approves the real call
without having seen those values. A tool without a view shows every
value as it will run.

#### Example

```ts
a view hiding `to`
  // args: { to: 'REDACTED', amount: 5000 }, hiddenArgs: ['to']
  // on approval the tool runs with { to: 'acct-9', amount: 5000 }
```

***

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/checkin.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L100)

Which REGISTERED screen component collects the decision (9.24.0) — the
tool's own declaration (`defineTool({ checkIn, checkInComponent })`),
carried onto the ask. Absent means what it always meant: the screen
renders the evidence pack as prose. The answer is a `CheckInDecision`
either way — the component changes how the question is asked, never
what the answer is.

***

### evidence

> `readonly` **evidence**: [`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)

Defined in: [src/core/checkin.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L91)

The receipts riding the ask.

***

### hiddenArgs?

> `readonly` `optional` **hiddenArgs?**: readonly `string`[]

Defined in: [src/core/checkin.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L83)

The names of the arguments the tool's view hides from [args](/docs/api/interfaces/CheckInRequest#args), in
argument order — what a screen tells the person they cannot see. Absent
when nothing is hidden. Computed from the view itself
(`core/toolShownArgs.ts` · `hiddenArgNames`), never from the shown text:
an argument whose real value is the string `'REDACTED'` is not listed, and
a hidden one always is. Names only; no hidden value travels here. The
decision's record carries the same names
(`CheckInDecisionPayload.hiddenArgs`).

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L53)

Names this request: the id a decision quotes
(`checkInApproved({ request: outcome.checkIn, by })`). Minted when the run
paused, unique to this pause, and bound to the exact call that runs on
approval — the tool, [args](/docs/api/interfaces/CheckInRequest#args), the call id and the served party. A
decision for any other request, or for a call that changed after the ask,
is refused (`ResumeDecisionError`). An opaque fingerprint: it carries no
value from the run.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L89)

The model's stated reasoning for THIS call, when the assistant turn
carried text alongside the tool call. Omitted when the turn was a bare
tool call with no content.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/checkin.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L55)

The tool the agent wants to run (its name).
