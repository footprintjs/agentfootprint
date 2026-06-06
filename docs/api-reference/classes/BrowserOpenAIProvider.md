[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserOpenAIProvider

# Class: BrowserOpenAIProvider

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:219](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L219)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new BrowserOpenAIProvider**(`options`): `BrowserOpenAIProvider`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:223](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L223)

#### Parameters

##### options

[`BrowserOpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserOpenAIProviderOptions.md)

#### Returns

`BrowserOpenAIProvider`

## Properties

### name

> `readonly` **name**: `"browser-openai"` = `'browser-openai'`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:220](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L220)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:227](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L227)

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

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:231](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L231)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
