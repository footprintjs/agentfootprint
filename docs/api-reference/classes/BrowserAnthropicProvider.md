[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserAnthropicProvider

# Class: BrowserAnthropicProvider

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:192](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L192)

## Implements

- [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Constructors

### Constructor

> **new BrowserAnthropicProvider**(`options`): `BrowserAnthropicProvider`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:196](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L196)

#### Parameters

##### options

[`BrowserAnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserAnthropicProviderOptions.md)

#### Returns

`BrowserAnthropicProvider`

## Properties

### name

> `readonly` **name**: `"browser-anthropic"` = `'browser-anthropic'`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:193](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L193)

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`name`](/agentfootprint/api/generated/interfaces/LLMProvider.md#name)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:200](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L200)

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

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:204](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L204)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

#### Implementation of

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md).[`stream`](/agentfootprint/api/generated/interfaces/LLMProvider.md#stream)
