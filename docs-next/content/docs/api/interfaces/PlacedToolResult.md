---
title: PlacedToolResult
---

# Interface: PlacedToolResult

Defined in: [src/artifacts/placement.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L106)

The substitute the model reads in place of the payload — ONE shape, always
the object (the `TruncatedToolResult` law: a consumer branches on
`.placed` without parsing prose, and the model reads it as JSON on the
`role: 'tool'` message).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/placement.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L119)

The stored payload's true size — the chars the window did NOT pay.

***

### detail?

> `readonly` `optional` **detail?**: [`ArtifactDetailAction`](/docs/api/interfaces/ArtifactDetailAction)

Defined in: [src/artifacts/placement.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L108)

Present only when the opt-in reader was offered and can read this representation. Re-admitted on use.

***

### detailUnavailable?

> `readonly` `optional` **detailUnavailable?**: `"unavailable"`

Defined in: [src/artifacts/placement.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L110)

No usable reader action was available when this ticket was issued.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/placement.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L116)

The minted kind — what a consumer names to want it. The tool's declared
 `Tool.resultKind` when it has one, `tool-result/<toolName>` otherwise.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/placement.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L117)

***

### placed

> `readonly` **placed**: `true`

Defined in: [src/artifacts/placement.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L112)

Always `true`. The field a consumer branches on.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/artifacts/placement.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L121)

What happened and what to do next: route the ref, never retype.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/placement.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L113)
