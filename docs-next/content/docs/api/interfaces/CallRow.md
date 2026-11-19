---
title: CallRow
---

# Interface: CallRow

Defined in: [src/time/rows/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L48)

One dispatched call's wall-clock moment (time design § 4, § 7.4).

## Extends

- `TimeCallIdentity`

## Properties

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/time/rows/types.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L44)

#### Inherited from

`TimeCallIdentity.callOccurrenceKey`

***

### dispatchedAt

> `readonly` **dispatchedAt**: `string`

Defined in: [src/time/rows/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L53)

The wall clock when the library handed the call to the tool — UTC, millisecond precision.

***

### drift?

> `readonly` `optional` **drift?**: `CallDrift`

Defined in: [src/time/rows/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L62)

The clock at dispatch (§ 7.4, step T5b) — present only when the call sent
a LOOK-BACK and `dispatchedAt − now` (`byMs`, signed) is more than the
tool's step. `redrawn`: the library's own look-back fill was re-sent as
the asked range in absolute form `form`; `shifted`: the look-back ran as
sent (the model's value, or no absolute form), so the tool read a window
shifted by `byMs` — `period-shifted`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L51)

***

### kind

> `readonly` **kind**: `"call"`

Defined in: [src/time/rows/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L49)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L42)

#### Inherited from

`TimeCallIdentity.toolCallId`

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L43)

#### Inherited from

`TimeCallIdentity.toolName`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L50)
