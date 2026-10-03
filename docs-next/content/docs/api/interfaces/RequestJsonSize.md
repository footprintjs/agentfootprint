---
title: RequestJsonSize
---

# Interface: RequestJsonSize

Defined in: src/lib/time-travel/requestMeasurement.ts:3

Counts only: the initial prepared request at the library's provider port.
No token estimate, payload retention, retry total or vendor wire claim.

## Properties

### jsonBytes

> `readonly` **jsonBytes**: `number`

Defined in: src/lib/time-travel/requestMeasurement.ts:7

UTF-8 bytes in that same JSON representation.

***

### jsonChars

> `readonly` **jsonChars**: `number`

Defined in: src/lib/time-travel/requestMeasurement.ts:5

UTF-16 code units in the JSON representation, including JSON punctuation.
