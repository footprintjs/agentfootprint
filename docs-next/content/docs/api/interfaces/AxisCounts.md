---
title: AxisCounts
---

# Interface: AxisCounts

Defined in: [src/time/axis.ts:299](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L299)

Every value the view could not place, by reason.

## Properties

### dstAmbiguous

> `readonly` **dstAmbiguous**: `number`

Defined in: [src/time/axis.ts:303](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L303)

A wall time the fall-back doubles, where the rows' order cannot tell which.

***

### dstGap

> `readonly` **dstGap**: `number`

Defined in: [src/time/axis.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L305)

A wall time the spring-forward skips — it names no instant.

***

### missing

> `readonly` **missing**: `number`

Defined in: [src/time/axis.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L309)

The row lacks the column, holds `null`, or is not a record.

***

### naive

> `readonly` **naive**: `number`

Defined in: [src/time/axis.ts:301](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L301)

An ISO value with no offset under an axis with no `zone`.

***

### unreadable

> `readonly` **unreadable**: `number`

Defined in: [src/time/axis.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L307)

Present, but not a value of the declared unit (or outside years 0000–9999).
