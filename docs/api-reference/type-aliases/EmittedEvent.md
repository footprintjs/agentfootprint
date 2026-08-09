[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmittedEvent

# Type Alias: EmittedEvent

> **EmittedEvent** = `AgentfootprintEvent`

Defined in: [src/core/runner.ts:317](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/runner.ts#L317)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
