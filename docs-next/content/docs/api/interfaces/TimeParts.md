---
title: TimeParts
---

# Interface: TimeParts

Defined in: [src/core/time/reader.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L128)

Zone-less parts, in the order the text wrote them. Every field present was said.

## Properties

### anchor?

> `readonly` `optional` **anchor?**: `"previous"`

Defined in: [src/core/time/reader.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L137)

`'the hour before that'` — resolved from the recorded previous window only.

***

### date?

> `readonly` `optional` **date?**: [`TimeDate`](/docs/api/type-aliases/TimeDate)

Defined in: [src/core/time/reader.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L129)

***

### partOfDay?

> `readonly` `optional` **partOfDay?**: `string`

Defined in: [src/core/time/reader.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L135)

`'morning'` — a KEY into a table, never hours.

***

### rangeOf?

> `readonly` `optional` **rangeOf?**: readonly \[`TimeParts`, `TimeParts`\]

Defined in: [src/core/time/reader.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L139)

`'8 AM to 8:40 AM'`.

***

### relative?

> `readonly` `optional` **relative?**: [`TimeRelative`](/docs/api/type-aliases/TimeRelative)

Defined in: [src/core/time/reader.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L133)

***

### wall?

> `readonly` `optional` **wall?**: [`TimeWall`](/docs/api/interfaces/TimeWall)

Defined in: [src/core/time/reader.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L130)

***

### zoneToken?

> `readonly` `optional` **zoneToken?**: `string`

Defined in: [src/core/time/reader.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L132)

As written: `'PST'`, `'-07:00'`, `'America/Los_Angeles'` — `resolve.ts` maps it.
