---
title: TimeContext
---

# Interface: TimeContext

Defined in: src/core/time/wire.ts:43

What a tool that declares a period is handed about the call's time
(`ctx.time`). `asked` is the half-open range the call asks for — the
person's window when the library filled or bound it, the sent value read
back otherwise — so a tool can declare the `period.queried` its read covered
without parsing its own argument. Absent when no form read the call back.

## Properties

### asked?

> `readonly` `optional` **asked?**: [`TimeRange`](/docs/api/interfaces/TimeRange) & `object`

Defined in: src/core/time/wire.ts:45

#### Type Declaration

##### edge

> `readonly` **edge**: `"exclusive"`

***

### dispatchedAt

> `readonly` **dispatchedAt**: `string`

Defined in: src/core/time/wire.ts:51

The wall clock when the library handed the call to the tool — the `call` row's.

***

### now

> `readonly` **now**: `string`

Defined in: src/core/time/wire.ts:49

The turn's frozen clock (§ 4).

***

### version

> `readonly` **version**: `1`

Defined in: src/core/time/wire.ts:44

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/wire.ts:47

The person's zone for this run (the clock's).
