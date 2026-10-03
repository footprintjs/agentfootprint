---
title: CheckInDecisionInput
---

# Interface: CheckInDecisionInput

Defined in: src/core/checkin.ts:196

Options for [checkInApproved](/docs/api/functions/checkInApproved) / [checkInDeclined](/docs/api/functions/checkInDeclined).

## Properties

### by

> `readonly` **by**: `string`

Defined in: src/core/checkin.ts:198

Who decided.

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: src/core/checkin.ts:200

Optional free-text note.

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: src/core/checkin.ts:202

What was chosen, for an ask that wanted a value rather than a yes.
