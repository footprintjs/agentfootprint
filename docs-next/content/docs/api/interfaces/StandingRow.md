---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L147)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L164)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L165)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L170)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L148)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L162)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L158)

The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`).

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L161)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L160)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L159)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L150)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L156)

From the identified result (`offer.ts · knownResults`: the served
history's tool messages plus the previous batch); absent when the id
named none (`unknownId`), or when the served message carried no name.

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L184)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L177)

Set when `toolCallId` named no result the run could identify — neither a
served `role: 'tool'` message nor an entry of the previous batch
(`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
as written, never resolved.
