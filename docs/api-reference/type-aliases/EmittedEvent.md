[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmittedEvent

# Type Alias: EmittedEvent

> **EmittedEvent** = `AgentfootprintEvent`

Defined in: [src/core/runner.ts:295](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/runner.ts#L295)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
