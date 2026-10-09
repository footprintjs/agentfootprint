---
title: AxisCounts
---

# Interface: AxisCounts

Defined in: src/core/time/axis.ts:349

Every value the view could not place, by reason.

## Properties

### dstAmbiguous

> `readonly` **dstAmbiguous**: `number`

Defined in: src/core/time/axis.ts:353

A wall time the fall-back doubles, where the rows' order cannot tell which.

***

### dstGap

> `readonly` **dstGap**: `number`

Defined in: src/core/time/axis.ts:355

A wall time the spring-forward skips — it names no instant.

***

### missing

> `readonly` **missing**: `number`

Defined in: src/core/time/axis.ts:359

The row lacks the column, holds `null`, or is not a record.

***

### naive

> `readonly` **naive**: `number`

Defined in: src/core/time/axis.ts:351

An ISO value with no offset under an axis with no `zone`.

***

### unreadable

> `readonly` **unreadable**: `number`

Defined in: src/core/time/axis.ts:357

Present, but not a value of the declared unit (or outside years 0000–9999).
