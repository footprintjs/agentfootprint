[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmitBridgeOptions

# Interface: EmitBridgeOptions

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:18](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L18)

## Properties

### dispatcher

> `readonly` **dispatcher**: [`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:19](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L19)

***

### getRunContext

> `readonly` **getRunContext**: () => [`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:24](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L24)

#### Returns

[`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:21](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L21)

Recorder id — must be unique among attached recorders.

***

### prefix

> `readonly` **prefix**: `string`

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:23](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L23)

Event-name prefix this bridge forwards (e.g. 'agentfootprint.stream.').
