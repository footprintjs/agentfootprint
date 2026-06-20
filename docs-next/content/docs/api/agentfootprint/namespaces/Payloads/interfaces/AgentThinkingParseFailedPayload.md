---
title: AgentThinkingParseFailedPayload
---

# Interface: AgentThinkingParseFailedPayload

Defined in: [src/events/payloads.ts:862](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L862)

Emitted (v2.14) when a `ThinkingHandler.normalize()` call throws.
The framework catches the throw, drops the thinking blocks (they
don't land on `LLMMessage.thinkingBlocks`), and continues the agent
run. Same graceful-failure pattern as v2.11.6
`tools.discovery_failed`.

Lives in `agent.*` domain (NOT `stream.*`) because parse failure is
a turn-level error concern — recovery happens at the agent loop
level, not at the SDK call level.

**Anti-pattern (provider authors):** sanitize error messages before
throwing. NEVER include raw unparsed thinking content in the error
— the message ends up in audit logs and can leak reasoning content
the consumer expected to be redacted. Same guidance as
`tools.discovery_failed.error`.

## Properties

### error

> `readonly` **error**: `string`

Defined in: [src/events/payloads.ts:865](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L865)

***

### errorName

> `readonly` **errorName**: `string`

Defined in: [src/events/payloads.ts:866](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L866)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:867](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L867)

***

### providerName

> `readonly` **providerName**: `string`

Defined in: [src/events/payloads.ts:863](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L863)

***

### subflowId

> `readonly` **subflowId**: `string`

Defined in: [src/events/payloads.ts:864](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L864)
