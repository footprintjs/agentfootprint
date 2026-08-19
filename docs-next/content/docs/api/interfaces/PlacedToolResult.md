---
title: PlacedToolResult
---

# Interface: PlacedToolResult

Defined in: [src/artifacts/placement.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L91)

The substitute the model reads in place of the payload — ONE shape, always
the object (the `TruncatedToolResult` law: a consumer branches on
`.placed` without parsing prose, and the model reads it as JSON on the
`role: 'tool'` message).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/placement.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L99)

The stored payload's true size — the chars the window did NOT pay.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/placement.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L96)

`tool-result/<toolName>` — what a consumer names to want it.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/placement.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L97)

***

### placed

> `readonly` **placed**: `true`

Defined in: [src/artifacts/placement.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L93)

Always `true`. The field a consumer branches on.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/artifacts/placement.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L101)

What happened and what to do next: route the ref, never retype.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/placement.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L94)
