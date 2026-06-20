---
title: EmitBridgeOptions
---

# Interface: EmitBridgeOptions

Defined in: [src/recorders/core/EmitBridge.ts:18](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/EmitBridge.ts#L18)

## Properties

### dispatcher

> `readonly` **dispatcher**: [`EventDispatcher`](/docs/api/classes/EventDispatcher)

Defined in: [src/recorders/core/EmitBridge.ts:19](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/EmitBridge.ts#L19)

***

### getRunContext

> `readonly` **getRunContext**: () => [`RunContext`](/docs/api/interfaces/RunContext)

Defined in: [src/recorders/core/EmitBridge.ts:24](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/EmitBridge.ts#L24)

#### Returns

[`RunContext`](/docs/api/interfaces/RunContext)

***

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/core/EmitBridge.ts:21](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/EmitBridge.ts#L21)

Recorder id — must be unique among attached recorders.

***

### prefix

> `readonly` **prefix**: `string`

Defined in: [src/recorders/core/EmitBridge.ts:23](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/EmitBridge.ts#L23)

Event-name prefix this bridge forwards (e.g. 'agentfootprint.stream.').
