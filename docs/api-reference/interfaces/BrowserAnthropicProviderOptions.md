[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserAnthropicProviderOptions

# Interface: BrowserAnthropicProviderOptions

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:74](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L74)

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:76](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L76)

API key. REQUIRED — browser providers don't read env vars.

***

### apiUrl?

> `readonly` `optional` **apiUrl?**: `string`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:82](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L82)

Override the API URL (proxies, edge deployments, mocks).

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:80](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L80)

Default max tokens. Default 4096.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [agentfootprint/src/adapters/llm/BrowserAnthropicProvider.ts:78](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BrowserAnthropicProvider.ts#L78)

Default model when `LLMRequest.model` is `'anthropic'`.
