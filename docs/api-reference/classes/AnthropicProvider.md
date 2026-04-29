[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AnthropicProvider

# Class: AnthropicProvider

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:165](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L165)

Class form for consumers who prefer `new AnthropicProvider(...)` over
the `anthropic(...)` factory. Identical behavior; trivial wrapper.

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new AnthropicProvider**(`options?`): `AnthropicProvider`

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:169](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L169)

#### Parameters

##### options?

[`AnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/AnthropicProviderOptions.md) = `{}`

#### Returns

`AnthropicProvider`

## Properties

### name

> `readonly` **name**: `"anthropic"` = `'anthropic'`

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:166](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L166)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:173](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L173)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`complete`](/agentfootprint/api/generated/interfaces/LLMProvider.md#complete)

***

### stream()

> **stream**(`req`): `AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:177](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L177)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
