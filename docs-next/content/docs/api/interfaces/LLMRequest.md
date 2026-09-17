---
title: LLMRequest
---

# Interface: LLMRequest

Defined in: [src/adapters/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L148)

## Properties

### cacheMarkers?

> `readonly` `optional` **cacheMarkers?**: readonly `CacheMarker`[]

Defined in: [src/adapters/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L167)

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

Defined in: [src/adapters/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L154)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L150)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L152)

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L156)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/adapters/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L155)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/adapters/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L149)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/adapters/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L153)

***

### thinking?

> `readonly` `optional` **thinking?**: `object`

Defined in: [src/adapters/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L191)

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

### toolChoice?

> `readonly` `optional` **toolChoice?**: `object`

Defined in: [src/adapters/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L212)

v7.26 — force the model to answer through one named tool.

One arm, because one arm is what the library needs and can keep a
promise about: `.outputSchema(parser, { strategy: 'tool-forced' })`
presents the schema as a synthetic tool and forces the choice, so the
shape is constrained at generation instead of requested in prose.
Anthropic spells it `{type:'tool',name}`, OpenAI
`{type:'function',function:{name}}`, Bedrock Converse
`toolConfig.toolChoice.tool.name` — the field is the one word all three
agree on, and each adapter writes its own dialect.

A provider that does not declare [LLMProvider.carriesForcedToolChoice](/docs/api/interfaces/LLMProvider#carriesforcedtoolchoice)
never receives this field: the agent refuses at run start instead,
naming the provider. Silently sending it to a wire that ignores it would
turn a guarantee into a suggestion with nothing in the recording to say
so.

#### name

> `readonly` **name**: `string`

#### type

> `readonly` **type**: `"tool"`

***

### tools?

> `readonly` `optional` **tools?**: readonly [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)[]

Defined in: [src/adapters/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L151)
