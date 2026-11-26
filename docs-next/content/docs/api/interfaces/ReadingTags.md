---
title: ReadingTags
---

# Interface: ReadingTags

Defined in: [src/time/resolveRecord.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L91)

Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them.

## Properties

### abbreviation?

> `readonly` `optional` **abbreviation?**: `"zone"` \| `"literal"`

Defined in: [src/time/resolveRecord.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L99)

An abbreviation in the app's map: read as its zone (`zone`) or as its literal offset (`literal`).

***

### dateOrder?

> `readonly` `optional` **dateOrder?**: `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/time/resolveRecord.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L92)

***

### endMeridiem?

> `readonly` `optional` **endMeridiem?**: `"am"` \| `"pm"`

Defined in: [src/time/resolveRecord.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L96)

The same, for the `to` end of a range.

***

### meridiem?

> `readonly` `optional` **meridiem?**: `"am"` \| `"pm"`

Defined in: [src/time/resolveRecord.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L94)

The meridiem this reading gave a clock time said without one (the `from` end of a range).

***

### year?

> `readonly` `optional` **year?**: `"said"` \| `"current"` \| `"previous"`

Defined in: [src/time/resolveRecord.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L97)
