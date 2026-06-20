---
title: BrowserAzureOpenAIProvider
---

# Class: BrowserAzureOpenAIProvider

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:344](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L344)

## Implements

- [`LLMProvider`](/docs/api/interfaces/LLMProvider)

## Constructors

### Constructor

> **new BrowserAzureOpenAIProvider**(`options`): `BrowserAzureOpenAIProvider`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:348](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L348)

#### Parameters

##### options

[`BrowserAzureOpenAIProviderOptions`](/docs/api/interfaces/BrowserAzureOpenAIProviderOptions)

#### Returns

`BrowserAzureOpenAIProvider`

## Properties

### name

> `readonly` **name**: `"browser-azure-openai"` = `'browser-azure-openai'`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:345](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L345)

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`name`](/docs/api/interfaces/LLMProvider#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:352](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L352)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`complete`](/docs/api/interfaces/LLMProvider#complete)

***

### stream()

> **stream**(`req`): `AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L356)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`stream`](/docs/api/interfaces/LLMProvider#stream)
