---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L136)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L153)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L154)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L159)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L137)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L151)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L147)

The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`).

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L150)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L149)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L148)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L139)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L145)

From the identified result (`offer.ts · knownResults`: the served
history's tool messages plus the previous batch); absent when the id
named none (`unknownId`), or when the served message carried no name.

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L166)

Set when `toolCallId` named no result the run could identify — neither a
served `role: 'tool'` message nor an entry of the previous batch
(`offer.ts · knownResults`). An ordinal, a tool name, a typo: recorded
as written, never resolved.
