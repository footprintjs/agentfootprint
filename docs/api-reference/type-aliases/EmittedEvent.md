[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmittedEvent

# Type Alias: EmittedEvent

> **EmittedEvent** = `AgentfootprintEvent`

Defined in: [src/core/runner.ts:317](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/runner.ts#L317)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
