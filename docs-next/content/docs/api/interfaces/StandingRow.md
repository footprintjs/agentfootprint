---
title: StandingRow
---

# Interface: StandingRow

Defined in: [src/core/agent/findings/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L110)

The model's standing on ONE previous result. The LAST row per `toolCallId` is current.

## Properties

### assertions

> `readonly` **assertions**: readonly `Assertion`[]

Defined in: [src/core/agent/findings/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L123)

Mapped by the stratum rule; always present, `[]` for `noise`.

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L124)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L129)

The DECLARING iteration. The result's own tool-calls stage is derivable
from the commit log by `toolCallId` and is never guessed here.

***

### kind

> `readonly` **kind**: `"standing"`

Defined in: [src/core/agent/findings/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L111)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [src/core/agent/findings/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L121)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/agent/findings/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L117)

The placement ticket's `art_` ref when the result was placed (`isPlacedToolResult`).

***

### settles?

> `readonly` `optional` **settles?**: `string`

Defined in: [src/core/agent/findings/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L120)

***

### sought?

> `readonly` `optional` **sought?**: `boolean`

Defined in: [src/core/agent/findings/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L119)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L118)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L113)

The PREVIOUS result's id — the result being judged, not the judging call.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/findings/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L115)

From the batch; absent when the id named no result in it (`unknownId`).

***

### unknownId?

> `readonly` `optional` **unknownId?**: `true`

Defined in: [src/core/agent/findings/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L131)

Set when `toolCallId` named no result in the previous batch.
