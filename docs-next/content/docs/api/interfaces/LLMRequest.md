---
title: LLMRequest
---

# Interface: LLMRequest

Defined in: [src/provider-contract/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L267)

## Properties

### cacheMarkers?

> `readonly` `optional` **cacheMarkers?**: readonly `CacheMarker`[]

Defined in: [src/provider-contract/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L286)

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

Defined in: [src/provider-contract/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L273)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/provider-contract/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L269)

***

### model

> `readonly` **model**: `string`

Defined in: [src/provider-contract/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L271)

***

### outputFormat?

> `readonly` `optional` **outputFormat?**: `object`

Defined in: [src/provider-contract/types.ts:353](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L353)

Constrain the model's TEXT answer to a JSON Schema with the provider's
own structured output — `.outputSchema(parser, { strategy: 'native' })`.
The Anthropic adapters write it as `output_config: { format }`
(https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Same rule as [toolChoice](/docs/api/interfaces/LLMRequest#toolchoice): when `nativeOutputSchemaFor(provider,
model)` answers false the agent refuses at run start, naming both, and an
adapter that cannot put it on its wire refuses with an
`UnsupportedNativeOutputError` before anything is sent — never drops it.
The schema is the wire copy `nativeOutputFormat` built; send it as-is.

#### schema

> `readonly` **schema**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### type

> `readonly` **type**: `"json_schema"`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L275)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/provider-contract/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L274)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/provider-contract/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L268)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/provider-contract/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L272)

***

### thinking?

> `readonly` `optional` **thinking?**: `object`

Defined in: [src/provider-contract/types.ts:314](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L314)

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

Defined in: [src/provider-contract/types.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L337)

v7.26 — force the model to answer through one named tool.

One arm, because one arm is what the library needs and can keep a
promise about: `.outputSchema(parser, { strategy: 'tool-forced' })`
presents the schema as a synthetic tool and forces the choice, so the
shape is constrained at generation instead of requested in prose.
Anthropic spells it `{type:'tool',name}`, OpenAI
`{type:'function',function:{name}}`, Bedrock Converse
`toolConfig.toolChoice.tool.name` — the field is the one word all three
agree on, and each adapter writes its own dialect.

If `forcedToolChoiceFor(provider, model)` answers false, the agent never
sends this field: it refuses at
run start instead, naming the provider and the model. Silently sending it
to a wire that ignores it would turn a guarantee into a suggestion with
nothing in the recording to say so — and a model that rejects it (Claude
Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1) is refused by the Anthropic
adapters before sending, with an `UnsupportedToolChoiceError`.

#### name

> `readonly` **name**: `string`

#### type

> `readonly` **type**: `"tool"`

***

### tools?

> `readonly` `optional` **tools?**: readonly [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)[]

Defined in: [src/provider-contract/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L270)
