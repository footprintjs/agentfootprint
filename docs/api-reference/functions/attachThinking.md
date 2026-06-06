[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / attachThinking

# Function: attachThinking()

> **attachThinking**(`dispatcher`, `options`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/ThinkingRecorder.ts:59](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/ThinkingRecorder.ts#L59)

Attach a thinking-status subscription to the event dispatcher.
Returns an Unsubscribe — call to detach.

## Parameters

### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

### options

[`ThinkingOptions`](/agentfootprint/api/generated/interfaces/ThinkingOptions.md)

## Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
