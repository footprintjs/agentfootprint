[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextRecorderOptions

# Interface: ContextRecorderOptions

Defined in: [src/recorders/core/ContextRecorder.ts:35](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L35)

Supplies the recorder with run-level context. Passed at construction
time (static fields) OR updated via `updateRunContext` between runs
when reusing one recorder across multiple executor runs.

## Properties

### dispatcher

> `readonly` **dispatcher**: [`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

Defined in: [src/recorders/core/ContextRecorder.ts:36](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L36)

***

### getRunContext

> `readonly` **getRunContext**: () => [`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

Defined in: [src/recorders/core/ContextRecorder.ts:38](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L38)

#### Returns

[`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/recorders/core/ContextRecorder.ts:37](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L37)
