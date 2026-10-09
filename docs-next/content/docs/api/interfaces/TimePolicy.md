---
title: TimePolicy
---

# Interface: TimePolicy

Defined in: src/core/time/resolveRecord.ts:138

The v1 policy (§ 11): the switches with careful answers.

## Properties

### abbreviations?

> `readonly` `optional` **abbreviations?**: `Readonly`\<`Record`\<`string`, [`ZoneAbbreviation`](/docs/api/interfaces/ZoneAbbreviation)\>\>

Defined in: src/core/time/resolveRecord.ts:150

Absent (the default): no abbreviation maps to a zone — `PST` is ASKED as
a zone. Present: the abbreviations this app's people write, each read as
its zone AND as its literal offset when the two disagree at the instant
(both offered in the one confirmation, noted `zone-read`). An
abbreviation missing from the map is still asked. No map ships.

***

### dateOrder

> `readonly` **dateOrder**: `"ask"` \| `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: src/core/time/resolveRecord.ts:140

`'ask'`: a numeric date's readings become choices. Or the one order this app's people write.

***

### year

> `readonly` **year**: `"ask"` \| `"current"`

Defined in: src/core/time/resolveRecord.ts:142

`'ask'`: a date said without a year is asked. `'current'`: the clock's year, recorded as assumed.
