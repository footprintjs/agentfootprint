---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L154)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L171)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L172)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L177)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L155)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L169)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L165)

The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`).

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L168)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L167)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L166)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L157)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L163)

From the identified result (`offer.ts · knownResults`: the served
history's tool messages plus the previous batch); absent when the id
named none (`unknownId`), or when the served message carried no name.

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L191)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L184)

Set when `toolCallId` named no result the run could identify — neither a
served `role: 'tool'` message nor an entry of the previous batch
(`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
as written, never resolved.
