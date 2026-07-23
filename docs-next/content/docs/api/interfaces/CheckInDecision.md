---
title: CheckInDecision
---

# Interface: CheckInDecision

Defined in: src/core/checkin.ts:112

The human's answer to a check-in — the record that lands. Produced by
[checkInApproved](/docs/api/functions/checkInApproved) / [checkInDeclined](/docs/api/functions/checkInDeclined) and passed to
`agent.resume(checkpoint, decision)`. JSON/clone-safe.

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: src/core/checkin.ts:114

True to run the tool, false to decline it.

***

### at

> `readonly` **at**: `number`

Defined in: src/core/checkin.ts:120

When the decision was made (ms since epoch).

***

### by

> `readonly` **by**: `string`

Defined in: src/core/checkin.ts:116

Who decided (an operator id, an email, a queue name — your call).

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: src/core/checkin.ts:118

Optional note. On decline it is surfaced to the model so it can adapt.
