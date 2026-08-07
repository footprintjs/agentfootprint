[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmittedEvent

# Type Alias: EmittedEvent

> **EmittedEvent** = `AgentfootprintEvent`

Defined in: [src/core/runner.ts:311](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runner.ts#L311)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
