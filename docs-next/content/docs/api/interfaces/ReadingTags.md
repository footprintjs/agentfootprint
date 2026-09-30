---
title: ReadingTags
---

# Interface: ReadingTags

Defined in: [src/core/time/resolve.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L116)

Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them.

## Properties

### dateOrder?

> `readonly` `optional` **dateOrder?**: `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/core/time/resolve.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L117)

***

### endMeridiem?

> `readonly` `optional` **endMeridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolve.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L121)

The same, for the `to` end of a range.

***

### meridiem?

> `readonly` `optional` **meridiem?**: `"am"` \| `"pm"`

Defined in: [src/core/time/resolve.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L119)

The meridiem this reading gave a clock time said without one (the `from` end of a range).

***

### year?

> `readonly` `optional` **year?**: `"said"` \| `"current"` \| `"previous"`

Defined in: [src/core/time/resolve.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L122)
