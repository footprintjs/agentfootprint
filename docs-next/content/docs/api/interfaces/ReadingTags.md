---
title: ReadingTags
---

# Interface: ReadingTags

Defined in: [src/core/time/resolveRecord.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L88)

Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them.

## Properties

### abbreviation?

> `readonly` `optional` **abbreviation?**: `"zone"` \| `"literal"`

Defined in: [src/core/time/resolveRecord.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L96)

An abbreviation in the app's map: read as its zone (`zone`) or as its literal offset (`literal`).

***

### dateOrder?

> `readonly` `optional` **dateOrder?**: `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/core/time/resolveRecord.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L89)

***

### endMeridiem?

> `readonly` `optional` **endMeridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolveRecord.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L93)

The same, for the `to` end of a range.

***

### meridiem?

> `readonly` `optional` **meridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolveRecord.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L91)

The meridiem this reading gave a clock time said without one (the `from` end of a range).

***

### year?

> `readonly` `optional` **year?**: `"said"` \| `"current"` \| `"previous"`

Defined in: [src/core/time/resolveRecord.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L94)
