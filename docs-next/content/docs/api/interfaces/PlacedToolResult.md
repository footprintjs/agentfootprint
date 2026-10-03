---
title: PlacedToolResult
---

# Interface: PlacedToolResult

Defined in: [src/artifacts/placement.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L105)

The substitute the model reads in place of the payload — ONE shape, always
the object (the `TruncatedToolResult` law: a consumer branches on
`.placed` without parsing prose, and the model reads it as JSON on the
`role: 'tool'` message).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/placement.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L114)

The stored payload's true size — the chars the window did NOT pay.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/placement.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L111)

The minted kind — what a consumer names to want it. The tool's declared
 `Tool.resultKind` when it has one, `tool-result/<toolName>` otherwise.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/placement.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L112)

***

### placed

> `readonly` **placed**: `true`

Defined in: [src/artifacts/placement.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L107)

Always `true`. The field a consumer branches on.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/artifacts/placement.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L116)

What happened and what to do next: route the ref, never retype.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/placement.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L108)
