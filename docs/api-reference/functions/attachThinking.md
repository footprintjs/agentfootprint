[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / attachStatus

# Function: attachStatus()

> **attachStatus**(`dispatcher`, `options`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/StatusRecorder.ts:59](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/StatusRecorder.ts#L59)

Attach a thinking-status subscription to the event dispatcher.
Returns an Unsubscribe — call to detach.

## Parameters

### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

### options

[`StatusOptions`](/agentfootprint/api/generated/interfaces/StatusOptions.md)

## Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
