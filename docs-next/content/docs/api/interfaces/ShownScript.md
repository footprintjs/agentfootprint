---
title: ShownScript
---

# Interface: ShownScript

Defined in: [src/lib/scriptRecord.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L93)

One attached script, as `turn_end.scripts.shown` carries it.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/lib/scriptRecord.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L106)

UTF-8 bytes of the whole program.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/lib/scriptRecord.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L101)

Only when the runner supplied one.

***

### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel)

Defined in: [src/lib/scriptRecord.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L99)

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/lib/scriptRecord.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L98)

As declared.

***

### lines

> `readonly` **lines**: `number`

Defined in: [src/lib/scriptRecord.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L107)

***

### resultWithheld?

> `readonly` `optional` **resultWithheld?**: `"over-ceiling"`

Defined in: [src/lib/scriptRecord.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L102)

***

### rewritten?

> `readonly` `optional` **rewritten?**: `true`

Defined in: [src/lib/scriptRecord.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L104)

A before-tool rule changed the program before dispatch.

***

### text

> `readonly` **text**: `string`

Defined in: [src/lib/scriptRecord.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L111)

The program, cut at `maxBytes` — a model-written string.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/lib/scriptRecord.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L96)

The name the model called.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/lib/scriptRecord.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L94)

***

### truncated?

> `readonly` `optional` **truncated?**: `object`

Defined in: [src/lib/scriptRecord.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L109)

Present when `text` is a cut: how many bytes of `bytes` it holds.

#### shownBytes

> `readonly` **shownBytes**: `number`
