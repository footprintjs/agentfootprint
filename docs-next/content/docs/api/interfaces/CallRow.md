---
title: CallRow
---

# Interface: CallRow

Defined in: src/core/time/rows.ts:81

One dispatched call's wall-clock moment (time design § 4, § 7.4).

## Properties

### dispatchedAt

> `readonly` **dispatchedAt**: `string`

Defined in: src/core/time/rows.ts:88

The wall clock when the library handed the call to the tool — UTC, millisecond precision.

***

### drift?

> `readonly` `optional` **drift?**: `CallDrift`

Defined in: src/core/time/rows.ts:97

The clock at dispatch (§ 7.4, step T5b) — present only when the call sent
a LOOK-BACK and `dispatchedAt − now` (`byMs`, signed) is more than the
tool's step. `redrawn`: the library's own look-back fill was re-sent as
the asked range in absolute form `form`; `shifted`: the look-back ran as
sent (the model's value, or no absolute form), so the tool read a window
shifted by `byMs` — `period-shifted`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/time/rows.ts:84

***

### kind

> `readonly` **kind**: `"call"`

Defined in: src/core/time/rows.ts:82

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: src/core/time/rows.ts:85

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/time/rows.ts:86

***

### turn

> `readonly` **turn**: `number`

Defined in: src/core/time/rows.ts:83
