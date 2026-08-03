---
title: LLMRequest
---

# Interface: LLMRequest

Defined in: [src/adapters/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L141)

## Properties

### cacheMarkers?

> `readonly` `optional` **cacheMarkers?**: readonly `CacheMarker`[]

Defined in: [src/adapters/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L160)

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

Defined in: [src/adapters/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L147)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L143)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L145)

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L149)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/adapters/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L148)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/adapters/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L142)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/adapters/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L146)

***

### thinking?

> `readonly` `optional` **thinking?**: `object`

Defined in: [src/adapters/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L184)

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

> `readonly` `optional` **tools?**: readonly [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)[]

Defined in: [src/adapters/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L144)
