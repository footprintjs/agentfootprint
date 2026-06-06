[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserAnthropicProviderOptions

# Interface: BrowserAnthropicProviderOptions

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:83](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L83)

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:85](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L85)

API key. REQUIRED — browser providers don't read env vars.

***

### apiUrl?

> `readonly` `optional` **apiUrl?**: `string`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:91](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L91)

Override the API URL (proxies, edge deployments, mocks).

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:89](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L89)

Default max tokens. Default 4096.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [src/adapters/llm/BrowserAnthropicProvider.ts:87](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/BrowserAnthropicProvider.ts#L87)

Default model when `LLMRequest.model` is `'anthropic'`.
