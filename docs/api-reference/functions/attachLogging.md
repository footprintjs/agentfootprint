[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / attachLogging

# Function: attachLogging()

> **attachLogging**(`dispatcher`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LoggingRecorder.ts:94](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L94)

Attach a logging subscription to the event dispatcher.
Returns an Unsubscribe — call to detach.

## Parameters

### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

### options?

[`LoggingOptions`](/agentfootprint/api/generated/interfaces/LoggingOptions.md) = `{}`

## Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
