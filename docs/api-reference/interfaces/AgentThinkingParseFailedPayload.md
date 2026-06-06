[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentThinkingParseFailedPayload

# Interface: AgentThinkingParseFailedPayload

Defined in: [src/events/payloads.ts:758](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L758)

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

Defined in: [src/events/payloads.ts:761](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L761)

***

### errorName

> `readonly` **errorName**: `string`

Defined in: [src/events/payloads.ts:762](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L762)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:763](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L763)

***

### providerName

> `readonly` **providerName**: `string`

Defined in: [src/events/payloads.ts:759](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L759)

***

### subflowId

> `readonly` **subflowId**: `string`

Defined in: [src/events/payloads.ts:760](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L760)
