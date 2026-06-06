[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserAnthropicProvider

# Class: BrowserAnthropicProvider

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:344](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L344)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new BrowserAnthropicProvider**(`options`): `BrowserAnthropicProvider`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:348](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L348)

#### Parameters

##### options

[`BrowserAnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserAnthropicProviderOptions.md)

#### Returns

`BrowserAnthropicProvider`

## Properties

### name

> `readonly` **name**: `"browser-anthropic"` = `'browser-anthropic'`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:345](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L345)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:352](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L352)

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

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:356](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L356)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
