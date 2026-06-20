---
title: BrowserOpenAIProvider
---

# Class: BrowserOpenAIProvider

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:238](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L238)

## Implements

- [`LLMProvider`](/docs/api/interfaces/LLMProvider)

## Constructors

### Constructor

> **new BrowserOpenAIProvider**(`options`): `BrowserOpenAIProvider`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:242](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L242)

#### Parameters

##### options

[`BrowserOpenAIProviderOptions`](/docs/api/interfaces/BrowserOpenAIProviderOptions)

#### Returns

`BrowserOpenAIProvider`

## Properties

### name

> `readonly` **name**: `"browser-openai"` = `'browser-openai'`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:239](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L239)

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`name`](/docs/api/interfaces/LLMProvider#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:246](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L246)

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

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:250](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L250)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`stream`](/docs/api/interfaces/LLMProvider#stream)
