---
title: CheckInDecision
---

# Interface: CheckInDecision

Defined in: [src/core/checkin.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L194)

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: [src/core/checkin.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L202)

True to run the tool, false to decline it.

***

### at

> `readonly` **at**: `number`

Defined in: [src/core/checkin.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L212)

When the decision was made (ms since epoch).

***

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L208)

Who decided (an operator id, an email, a queue name — your call). Recorded
as given: a claim, not proof. Authenticate the person before you build the
decision; the library binds WHICH request and WHAT call, never who.

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L210)

Optional note. On decline it is surfaced to the model so it can adapt.

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/checkin.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L200)

The request this decision answers — the paused request's `id`
(`CheckInRequest.id`, `MiddlewareAsk.id`). A resume refuses a decision for
any other request, and answers each request once (`ResumeDecisionError`).

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L219)

What they chose, when the answer was a value and not just a yes.

Optional everywhere: a decision without one is byte-identical to every
earlier release, and a screen that only approves or declines never sets it.
