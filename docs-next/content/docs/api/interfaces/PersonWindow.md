---
title: PersonWindow
---

# Interface: PersonWindow

Defined in: [src/time/rows/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L141)

The person's window a `call-window` row names — its range, who gave it, and its mention.

## Extends

- [`TimeRange`](/docs/api/interfaces/TimeRange)

## Properties

### from

> `readonly` **from**: `string`

Defined in: [src/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L60)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`from`](/docs/api/interfaces/TimeRange#from)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L144)

The `time-reading` row's mention index — absent on a `control` window.

***

### source

> `readonly` **source**: `WindowSource`

Defined in: [src/time/rows/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L142)

***

### to

> `readonly` **to**: `string`

Defined in: [src/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L61)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`to`](/docs/api/interfaces/TimeRange#to)
