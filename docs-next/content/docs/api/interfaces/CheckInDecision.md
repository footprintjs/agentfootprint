---
title: CheckInDecision
---

# Interface: CheckInDecision

Defined in: [src/core/checkin.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L214)

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: [src/core/checkin.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L222)

True to run the tool, false to decline it.

***

### at

> `readonly` **at**: `number`

Defined in: [src/core/checkin.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L232)

When the decision was made (ms since epoch).

***

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L228)

Who decided (an operator id, an email, a queue name — your call). Recorded
as given: a claim, not proof. Authenticate the person before you build the
decision; the library binds WHICH request and WHAT call, never who.

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L230)

Optional note. On decline it is surfaced to the model so it can adapt.

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/checkin.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L220)

The request this decision answers — the paused request's `id`
(`CheckInRequest.id`, `MiddlewareAsk.id`). A resume refuses a decision for
any other request, and answers each request once (`ResumeDecisionError`).

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L239)

What they chose, when the answer was a value and not just a yes.

Optional everywhere: a decision without one is byte-identical to every
earlier release, and a screen that only approves or declines never sets it.
