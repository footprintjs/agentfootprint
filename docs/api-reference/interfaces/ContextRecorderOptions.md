[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextRecorderOptions

# Interface: ContextRecorderOptions

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L35)

Supplies the recorder with run-level context. Passed at construction
time (static fields) OR updated via `updateRunContext` between runs
when reusing one recorder across multiple executor runs.

## Properties

### dispatcher

> `readonly` **dispatcher**: [`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L36)

***

### getRunContext

> `readonly` **getRunContext**: () => [`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:38](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L38)

#### Returns

[`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L37)
