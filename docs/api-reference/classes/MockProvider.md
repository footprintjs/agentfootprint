[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockProvider

# Class: MockProvider

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:103](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L103)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new MockProvider**(`options?`): `MockProvider`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:114](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L114)

#### Parameters

##### options?

[`MockProviderOptions`](/agentfootprint/api/generated/interfaces/MockProviderOptions.md) = `{}`

#### Returns

`MockProvider`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:104](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L104)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:156](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L156)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`complete`](/agentfootprint/api/generated/interfaces/LLMProvider.md#complete)

***

### realistic()

> `static` **realistic**(`options?`): `MockProvider`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:148](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L148)

Convenience factory for the playground / Lens demo defaults: a
real-feel mock with 3–8 s of "thinking" before the response and
30–80 ms per streamed word. Lets users observe pause/resume,
streaming, and tool dispatch happening live without hitting a
paid API.

#### Parameters

##### options?

[`MockProviderOptions`](/agentfootprint/api/generated/interfaces/MockProviderOptions.md) = `{}`

#### Returns

`MockProvider`

***

### resetReplies()

> **resetReplies**(): `void`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:137](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L137)

Reset the scripted-replies cursor. Useful when reusing one
`MockProvider` instance across multiple test scenarios — each
scenario can `provider.resetReplies()` to start from `replies[0]`
again. No-op when `replies` was not supplied.

#### Returns

`void`

***

### stream()

> **stream**(`req`): `AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:167](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L167)

Streaming mode — emits the response content word-by-word so
consumers (Lens commentary, chat UIs) can render tokens as they
arrive. Tool calls land all at once on the final chunk because
that is how real providers (OpenAI, Anthropic) deliver them too.

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
