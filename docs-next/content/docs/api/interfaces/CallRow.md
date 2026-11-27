---
title: CallRow
---

# Interface: CallRow

Defined in: [src/time/rows/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L54)

One dispatched call's wall-clock moment (time design § 4, § 7.4).

## Extends

- `TimeCallIdentity`

## Properties

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/time/rows/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L46)

#### Inherited from

`TimeCallIdentity.callOccurrenceKey`

***

### dispatchedAt

> `readonly` **dispatchedAt**: `string`

Defined in: [src/time/rows/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L59)

The wall clock when the library handed the call to the tool — UTC, millisecond precision.

***

### drift?

> `readonly` `optional` **drift?**: `CallDrift`

Defined in: [src/time/rows/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L72)

The clock at dispatch (§ 7.4, step T5b) — present only when the call sent
a LOOK-BACK and `dispatchedAt − now` (`byMs`, signed) is more than the
tool's step. `redrawn`: the library's own look-back fill was re-sent as
the asked range in absolute form `form`; `shifted`: the look-back ran as
sent (the model's value, or no absolute form), so the tool read a window
shifted by `byMs` — `period-shifted`. `covered`: a confirmed look-back in
a length-only form (`call-window` · `coversAtDispatch`) was lengthened to
still reach the window's start from the dispatch moment; `sent` is what
the source reads with it if its clock agrees with ours. Always present on
such a call, whatever `byMs` (zero and negative included).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L57)

***

### kind

> `readonly` **kind**: `"call"`

Defined in: [src/time/rows/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L55)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L44)

#### Inherited from

`TimeCallIdentity.toolCallId`

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L45)

#### Inherited from

`TimeCallIdentity.toolName`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L56)
