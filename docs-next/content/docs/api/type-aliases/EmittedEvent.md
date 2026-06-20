---
title: EmittedEvent
---

# Type Alias: EmittedEvent

> **EmittedEvent** = [`AgentfootprintEvent`](/docs/api/type-aliases/AgentfootprintEvent)

Defined in: [src/core/runner.ts:237](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/runner.ts#L237)

Union used in emit() for the `AgentfootprintEvent` type constraint. A
consumer emitting a custom event passes a plain object payload; the
dispatcher wraps it as AgentfootprintEvent only when the name is a
registered type. Otherwise it flows through as an opaque custom event.
