---
title: CheckInDecision
---

# Interface: CheckInDecision

Defined in: [src/core/checkin.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L189)

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: [src/core/checkin.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L197)

True to run the tool, false to decline it.

***

### at

> `readonly` **at**: `number`

Defined in: [src/core/checkin.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L207)

When the decision was made (ms since epoch).

***

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L203)

Who decided (an operator id, an email, a queue name — your call). Recorded
as given: a claim, not proof. Authenticate the person before you build the
decision; the library binds WHICH request and WHAT call, never who.

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L205)

Optional note. On decline it is surfaced to the model so it can adapt.

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/checkin.ts:195](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L195)

The request this decision answers — the paused request's `id`
(`CheckInRequest.id`, `MiddlewareAsk.id`). A resume refuses a decision for
any other request, and answers each request once (`ResumeDecisionError`).

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L214)

What they chose, when the answer was a value and not just a yes.

Optional everywhere: a decision without one is byte-identical to every
earlier release, and a screen that only approves or declines never sets it.
