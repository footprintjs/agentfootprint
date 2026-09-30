---
title: ReadingTags
---

# Interface: ReadingTags

Defined in: [src/core/time/resolveRecord.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L68)

Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them.

## Properties

### dateOrder?

> `readonly` `optional` **dateOrder?**: `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/core/time/resolveRecord.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L69)

***

### endMeridiem?

> `readonly` `optional` **endMeridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolveRecord.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L73)

The same, for the `to` end of a range.

***

### meridiem?

> `readonly` `optional` **meridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolveRecord.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L71)

The meridiem this reading gave a clock time said without one (the `from` end of a range).

***

### year?

> `readonly` `optional` **year?**: `"said"` \| `"current"` \| `"previous"`

Defined in: [src/core/time/resolveRecord.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L74)
