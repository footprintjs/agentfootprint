---
title: PersonWindow
---

# Interface: PersonWindow

Defined in: [src/core/time/rows.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L167)

The person's window a `call-window` row names — its range, who gave it, and its mention.

## Extends

- [`TimeRange`](/docs/api/interfaces/TimeRange)

## Properties

### from

> `readonly` **from**: `string`

Defined in: [src/core/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/range.ts#L60)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`from`](/docs/api/interfaces/TimeRange#from)

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/core/time/rows.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L170)

The `time-reading` row's mention index — absent on a `control` window.

***

### source

> `readonly` **source**: `WindowSource`

Defined in: [src/core/time/rows.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L168)

***

### to

> `readonly` **to**: `string`

Defined in: [src/core/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/range.ts#L61)

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`to`](/docs/api/interfaces/TimeRange#to)
