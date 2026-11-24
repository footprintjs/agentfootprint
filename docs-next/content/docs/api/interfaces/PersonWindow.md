---
title: PersonWindow
---

# Interface: PersonWindow

Defined in: [src/time/rows/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L145)

The person's window a `call-window` row names — its range, who gave it, and its mention.

## Extends

- `RecordedWindow`

## Properties

### endpoint?

> `readonly` `optional` **endpoint?**: `WindowEndpoint`

Defined in: [src/time/windowEndpoint.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/time/windowEndpoint.ts#L14)

#### Inherited from

`RecordedWindow.endpoint`

***

### from

> `readonly` **from**: `string`

Defined in: [src/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L60)

#### Inherited from

`RecordedWindow.from`

***

### frozenLookback?

> `readonly` `optional` **frozenLookback?**: `true`

Defined in: [src/time/rows/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L150)

This call admitted an absolute encoding of this look-back.

***

### mention?

> `readonly` `optional` **mention?**: `number`

Defined in: [src/time/rows/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L148)

The `time-reading` row's mention index — absent on a `control` window.

***

### source

> `readonly` **source**: `WindowSource`

Defined in: [src/time/rows/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L146)

***

### to

> `readonly` **to**: `string`

Defined in: [src/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/range.ts#L61)

#### Inherited from

`RecordedWindow.to`
