[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmittedEvent

# Type Alias: EmittedEvent

> **EmittedEvent** = [`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

Defined in: [src/core/runner.ts:200](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/runner.ts#L200)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
