---
title: CheckInDecisionInput
---

# Interface: CheckInDecisionInput

Defined in: [src/core/checkin.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L219)

Options for [checkInApproved](/docs/api/functions/checkInApproved) / [checkInDeclined](/docs/api/functions/checkInDeclined).

## Properties

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L228)

Who decided. Recorded as given — see [CheckInDecision.by](/docs/api/interfaces/CheckInDecision#by).

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L230)

Optional free-text note.

***

### request

> `readonly` **request**: `object`

Defined in: [src/core/checkin.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L226)

The paused request being answered — the one the person was shown:
`outcome.checkIn` or `outcome.ask` (`PendingAsk.checkIn` / `.ask` on a
hosted door). Only its `id` is read; the decision answers that request and
no other.

#### id

> `readonly` **id**: `string`

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L232)

What was chosen, for an ask that wanted a value rather than a yes.
