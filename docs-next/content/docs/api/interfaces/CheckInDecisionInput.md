---
title: CheckInDecisionInput
---

# Interface: CheckInDecisionInput

Defined in: [src/core/checkin.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L216)

Options for [checkInApproved](/docs/api/functions/checkInApproved) / [checkInDeclined](/docs/api/functions/checkInDeclined).

## Properties

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L225)

Who decided. Recorded as given — see [CheckInDecision.by](/docs/api/interfaces/CheckInDecision#by).

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L227)

Optional free-text note.

***

### request

> `readonly` **request**: `object`

Defined in: [src/core/checkin.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L223)

The paused request being answered — the one the person was shown:
`outcome.checkIn` or `outcome.ask` (`PendingAsk.checkIn` / `.ask` on a
hosted door). Only its `id` is read; the decision answers that request and
no other.

#### id

> `readonly` **id**: `string`

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L229)

What was chosen, for an ask that wanted a value rather than a yes.
