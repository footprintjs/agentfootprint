[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / attachLogging

# Function: attachLogging()

> **attachLogging**(`dispatcher`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LoggingRecorder.ts:97](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L97)

Attach a logging subscription to the event dispatcher.
Returns an Unsubscribe — call to detach.

## Parameters

### dispatcher

[`EventDispatcher`](/agentfootprint/api/generated/classes/EventDispatcher.md)

### options?

[`LoggingOptions`](/agentfootprint/api/generated/interfaces/LoggingOptions.md) = `{}`

## Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
