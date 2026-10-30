---
title: ShownScript
---

# Interface: ShownScript

Defined in: [src/lib/scriptRecord.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L100)

One attached script, as `turn_end.scripts.shown` carries it.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/lib/scriptRecord.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L116)

UTF-8 bytes of the whole program.

***

### dispatch

> `readonly` **dispatch**: `number`

Defined in: [src/lib/scriptRecord.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L104)

The library's identity for the call: its dispatch order within the turn.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/lib/scriptRecord.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L111)

Only when the runner supplied one.

***

### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel)

Defined in: [src/lib/scriptRecord.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L109)

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/lib/scriptRecord.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L108)

As declared.

***

### lines

> `readonly` **lines**: `number`

Defined in: [src/lib/scriptRecord.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L117)

***

### resultWithheld?

> `readonly` `optional` **resultWithheld?**: `"over-ceiling"`

Defined in: [src/lib/scriptRecord.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L112)

***

### rewritten?

> `readonly` `optional` **rewritten?**: `true`

Defined in: [src/lib/scriptRecord.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L114)

A before-tool rule changed the program before dispatch.

***

### text

> `readonly` **text**: `string`

Defined in: [src/lib/scriptRecord.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L121)

The program, cut at `maxBytes` — a model-written string.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/lib/scriptRecord.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L106)

The name the model called.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/lib/scriptRecord.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L102)

The provider's id for the call — display only; two calls may share one.

***

### truncated?

> `readonly` `optional` **truncated?**: `object`

Defined in: [src/lib/scriptRecord.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L119)

Present when `text` is a cut: how many bytes of `bytes` it holds.

#### shownBytes

> `readonly` **shownBytes**: `number`
