---
title: TurnEndScripts
---

# Interface: TurnEndScripts

Defined in: [src/lib/scriptRecord.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L115)

`turn_end.scripts` — present only under `.scriptTravelsWithTheAnswer()`.

## Properties

### omitted

> `readonly` **omitted**: `number`

Defined in: [src/lib/scriptRecord.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L122)

Calls of this turn not attached: past `MAX_ATTACHED_SCRIPTS`, a program
over `MAX_SCRIPT_BYTES` (no text on its row), or a call past
`MAX_SCRIPT_ROWS` (no row).

***

### shown

> `readonly` **shown**: readonly [`ShownScript`](/docs/api/interfaces/ShownScript)[]

Defined in: [src/lib/scriptRecord.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L116)
