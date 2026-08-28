---
title: ExternalGrounding
---

# Interface: ExternalGrounding

Defined in: [src/integrity/unsupported-argument/check.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L101)

One argument value an external ground excused — the audit trail of an app
assertion. Filed alongside the findings so the record can say WHICH source
grounded a value, not merely that no finding was raised.

## Properties

### path

> `readonly` **path**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L105)

Dot-path of the argument leaf the ground excused.

***

### source

> `readonly` **source**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L108)

The app's label from the [ExternalGround](/docs/api/interfaces/ExternalGround) entry that matched.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L103)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L102)

***

### value

> `readonly` **value**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/unsupported-argument/check.ts#L106)
