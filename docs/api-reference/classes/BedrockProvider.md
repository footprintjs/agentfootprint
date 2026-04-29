[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BedrockProvider

# Class: BedrockProvider

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:205](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L205)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new BedrockProvider**(`options?`): `BedrockProvider`

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:209](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L209)

#### Parameters

##### options?

[`BedrockProviderOptions`](/agentfootprint/api/generated/interfaces/BedrockProviderOptions.md) = `{}`

#### Returns

`BedrockProvider`

## Properties

### name

> `readonly` **name**: `"bedrock"` = `'bedrock'`

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:206](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L206)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:213](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L213)

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

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:217](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L217)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
