---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L145)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L162)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L163)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L168)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L146)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L160)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L156)

The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`).

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L159)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L158)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L157)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L148)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L154)

From the identified result (`offer.ts · knownResults`: the served
history's tool messages plus the previous batch); absent when the id
named none (`unknownId`), or when the served message carried no name.

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L182)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L175)

Set when `toolCallId` named no result the run could identify — neither a
served `role: 'tool'` message nor an entry of the previous batch
(`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
as written, never resolved.
