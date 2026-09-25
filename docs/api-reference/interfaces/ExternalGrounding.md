[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ExternalGrounding

# Interface: ExternalGrounding

Defined in: [src/integrity/unsupported-argument/check.ts:102](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L102)

One argument value an external ground excused — the audit trail of an app
assertion. Filed alongside the findings so the record can say WHICH source
grounded a value, not merely that no finding was raised.

## Properties

### path

> `readonly` **path**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:106](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L106)

Dot-path of the argument leaf the ground excused.

***

### source

> `readonly` **source**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:109](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L109)

The app's label from the [ExternalGround](/agentfootprint/api/generated/interfaces/ExternalGround.md) entry that matched.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:104](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L104)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:103](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L103)

***

### value

> `readonly` **value**: `string`

Defined in: [src/integrity/unsupported-argument/check.ts:107](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/integrity/unsupported-argument/check.ts#L107)
