---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L181)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L199)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/core/agent/findings/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L185)

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L200)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L205)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L182)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L197)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:193](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L193)

The placement ticket's `art_` ref when the placement is backed by the library receipt.

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L196)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L195)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L194)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L184)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L191)

From the identified result (`offer.ts · knownResults`: the served
history's tool messages plus the previous batch); absent when the id
named none (`unknownId`), or when the served message carried no name.

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L219)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L212)

Set when `toolCallId` named no result the run could identify — neither a
served `role: 'tool'` message nor an entry of the previous batch
(`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
as written, never resolved.
