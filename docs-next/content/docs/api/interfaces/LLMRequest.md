---
title: LLMRequest
---

# Interface: LLMRequest

Defined in: [src/adapters/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L246)

## Properties

### cacheMarkers?

> `readonly` `optional` **cacheMarkers?**: readonly `CacheMarker`[]

Defined in: [src/adapters/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L265)

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

Defined in: [src/adapters/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L252)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/adapters/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L248)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L250)

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/adapters/types.ts:254](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L254)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/adapters/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L253)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/adapters/types.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L247)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/adapters/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L251)

***

### thinking?

> `readonly` `optional` **thinking?**: `object`

Defined in: [src/adapters/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L293)

v2.14 — request the LLM emit reasoning/thinking content on this call.

Activation: presence of this field tells the provider to ASK for
thinking. It is the INTENT, never a wire shape: each adapter maps it to
what the model takes. The Anthropic adapters ask their declared
`thinkingMode(model)` — a `'budget'` model gets `thinking: { type:
'enabled', budget_tokens: budget }`, an `'adaptive'` model (Claude 4.7
and later) gets `thinking: { type: 'adaptive', display: 'summarized' }`
with no budget, and a `'none'` model is refused with an
`UnsupportedThinkingError` before anything is sent. OpenAI ignores it
(o1/o3 thinking is selected at the model id level, not per-request).

`budget` is the maximum reasoning tokens the model may spend where the
model takes a budget (Anthropic: a whole number of at least 1024). On
an adaptive model it is not sent; it only raises `max_tokens` to at
least `budget + 1024`, so a long think has room to finish.

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

Defined in: [src/adapters/types.ts:314](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L314)

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

Defined in: [src/adapters/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L249)
