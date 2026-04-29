[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserOpenAIProvider

# Class: BrowserOpenAIProvider

Defined in: [agentfootprint/src/adapters/llm/BrowserOpenAIProvider.ts:219](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserOpenAIProvider.ts#L219)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new BrowserOpenAIProvider**(`options`): `BrowserOpenAIProvider`

Defined in: [agentfootprint/src/adapters/llm/BrowserOpenAIProvider.ts:223](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserOpenAIProvider.ts#L223)

#### Parameters

##### options

[`BrowserOpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserOpenAIProviderOptions.md)

#### Returns

`BrowserOpenAIProvider`

## Properties

### name

> `readonly` **name**: `"browser-openai"` = `'browser-openai'`

Defined in: [agentfootprint/src/adapters/llm/BrowserOpenAIProvider.ts:220](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserOpenAIProvider.ts#L220)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/BrowserOpenAIProvider.ts:227](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserOpenAIProvider.ts#L227)

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

Defined in: [agentfootprint/src/adapters/llm/BrowserOpenAIProvider.ts:231](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserOpenAIProvider.ts#L231)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
