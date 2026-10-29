---
title: TurnEndScripts
---

# Interface: TurnEndScripts

Defined in: [src/lib/scriptRecord.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L125)

`turn_end.scripts` — present only under `.scriptTravelsWithTheAnswer()`.

## Properties

### closedFence?

> `readonly` `optional` **closedFence?**: `object`

Defined in: [src/lib/scriptRecord.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L140)

The fence the library CLOSED before the attachment: the text before it
(the model's answer, and any library block above) ended inside a fence a
renderer would still be in, so the library wrote the closing fence first
and nothing the model left open could take the programs in. Present only
when it closed one.

#### char

> `readonly` **char**: `"backtick"` \| `"tilde"`

#### length

> `readonly` **length**: `number`

***

### omitted

> `readonly` **omitted**: `number`

Defined in: [src/lib/scriptRecord.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L132)

Calls of this turn not attached: past `MAX_ATTACHED_SCRIPTS`, a program
over `MAX_SCRIPT_BYTES` (no text on its row), or a call past
`MAX_SCRIPT_ROWS` (no row).

***

### shown

> `readonly` **shown**: readonly [`ShownScript`](/docs/api/interfaces/ShownScript)[]

Defined in: [src/lib/scriptRecord.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L126)

***

### withheldFromText?

> `readonly` `optional` **withheldFromText?**: `true`

Defined in: [src/lib/scriptRecord.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L148)

`true`: the programs are NOT in the answer's text, only here. The text
before the attachment holds a line after which a renderer could pair
fences another way (an indented fence, raw HTML, display math), so the
library cannot tell what a program would render inside. The labels are
in the text; the programs ride `shown[].text`. Absent otherwise.
