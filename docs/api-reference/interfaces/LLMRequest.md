[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMRequest

# Interface: LLMRequest

Defined in: [src/adapters/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L93)

## Properties

### cacheMarkers?

> `readonly` `optional` **cacheMarkers?**: readonly `CacheMarker`[]

Defined in: [src/adapters/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L112)

Cache markers (v2.6+) — provider-agnostic prefix-cache hints
populated by `CacheStrategy.prepareRequest` after the agent's
CacheGate decider routes to `apply-markers`. Each marker
identifies a cacheable prefix in `system` / `tools` / `messages`.

Providers that support caching (Anthropic, Bedrock-Claude) read
this field and translate to their wire format. Providers without
cache support (OpenAI auto-cache, Mock, NoOp) ignore it.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/adapters/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L99)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/adapters/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L95)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L97)

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L101)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/adapters/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L100)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/adapters/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L94)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/adapters/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L98)

***

### thinking?

> `readonly` `optional` **thinking?**: `object`

Defined in: [src/adapters/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L136)

v2.14 — request the LLM emit reasoning/thinking content on this call.

Activation: presence of this field tells the provider to ASK for
thinking. Anthropic translates to `thinking: { type: 'enabled',
budget_tokens: budget }` on the wire. OpenAI ignores (o1/o3
thinking is selected at the model id level, not per-request).

`budget` is the maximum reasoning tokens the model may spend.
Anthropic requires it; recommended range 1024-32000 for
claude-sonnet-4-5 / opus-4-5. Models that don't support extended
thinking will reject the request with HTTP 400 — pick a supported
model when setting this field.

Independent from `LLMMessage.thinkingBlocks` (the response side):
  - `request.thinking` = activation (consumer ASKS for thinking)
  - `message.thinkingBlocks` = round-trip (consumer ECHOES prior
    assistant turn's signed blocks back to the model)

Set via `AgentBuilder.thinking({ budget })` — applied to every
LLM call the agent makes. Leave undefined to call without thinking
(the v2.13 default).

#### budget

> `readonly` **budget**: `number`

***

### tools?

> `readonly` `optional` **tools?**: readonly [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)[]

Defined in: [src/adapters/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L96)
