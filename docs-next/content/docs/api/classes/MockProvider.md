---
title: MockProvider
---

# Class: MockProvider

Defined in: [src/adapters/llm/MockProvider.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L103)

## Implements

- [`LLMProvider`](/docs/api/interfaces/LLMProvider)

## Constructors

### Constructor

> **new MockProvider**(`options?`): `MockProvider`

Defined in: [src/adapters/llm/MockProvider.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L114)

#### Parameters

##### options?

[`MockProviderOptions`](/docs/api/interfaces/MockProviderOptions) = `{}`

#### Returns

`MockProvider`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/llm/MockProvider.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L104)

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`name`](/docs/api/interfaces/LLMProvider#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/llm/MockProvider.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L156)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`complete`](/docs/api/interfaces/LLMProvider#complete)

***

### realistic()

> `static` **realistic**(`options?`): `MockProvider`

Defined in: [src/adapters/llm/MockProvider.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L148)

Convenience factory for the playground / Lens demo defaults: a
real-feel mock with 3–8 s of "thinking" before the response and
30–80 ms per streamed word. Lets users observe pause/resume,
streaming, and tool dispatch happening live without hitting a
paid API.

#### Parameters

##### options?

[`MockProviderOptions`](/docs/api/interfaces/MockProviderOptions) = `{}`

#### Returns

`MockProvider`

***

### resetReplies()

> **resetReplies**(): `void`

Defined in: [src/adapters/llm/MockProvider.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L137)

Reset the scripted-replies cursor. Useful when reusing one
`MockProvider` instance across multiple test scenarios — each
scenario can `provider.resetReplies()` to start from `replies[0]`
again. No-op when `replies` was not supplied.

#### Returns

`void`

***

### stream()

> **stream**(`req`): `AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

Defined in: [src/adapters/llm/MockProvider.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L167)

Streaming mode — emits the response content word-by-word so
consumers (Lens commentary, chat UIs) can render tokens as they
arrive. Tool calls land all at once on the final chunk because
that is how real providers (OpenAI, Anthropic) deliver them too.

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`stream`](/docs/api/interfaces/LLMProvider#stream)
