---
title: BrowserAnthropicProvider
---

# Class: BrowserAnthropicProvider

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:344](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserAnthropicProvider.ts#L344)

## Implements

- [`LLMProvider`](/docs/api/interfaces/LLMProvider)

## Constructors

### Constructor

> **new BrowserAnthropicProvider**(`options`): `BrowserAnthropicProvider`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:348](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserAnthropicProvider.ts#L348)

#### Parameters

##### options

[`BrowserAnthropicProviderOptions`](/docs/api/interfaces/BrowserAnthropicProviderOptions)

#### Returns

`BrowserAnthropicProvider`

## Properties

### name

> `readonly` **name**: `"browser-anthropic"` = `'browser-anthropic'`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:345](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserAnthropicProvider.ts#L345)

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`name`](/docs/api/interfaces/LLMProvider#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:352](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserAnthropicProvider.ts#L352)

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

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:356](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserAnthropicProvider.ts#L356)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

#### Implementation of

[`LLMProvider`](/docs/api/interfaces/LLMProvider).[`stream`](/docs/api/interfaces/LLMProvider#stream)
