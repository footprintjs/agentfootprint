[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / attachThinking

# Function: attachThinking()

> **attachThinking**(`dispatcher`, `options`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/ThinkingRecorder.ts:57](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/ThinkingRecorder.ts#L57)

Attach a thinking-status subscription to the event dispatcher.
Returns an Unsubscribe — call to detach.

## Parameters

### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

### options

[`ThinkingOptions`](/agentfootprint/api/generated/interfaces/ThinkingOptions.md)

## Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
