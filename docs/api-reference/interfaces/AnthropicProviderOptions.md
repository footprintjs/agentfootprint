[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AnthropicProviderOptions

# Interface: AnthropicProviderOptions

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:85](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L85)

## Properties

### apiKey?

> `readonly` `optional` **apiKey?**: `string`

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:87](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L87)

API key. Defaults to `ANTHROPIC_API_KEY` env var.

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:94](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L94)

Default max tokens when the request doesn't set it. Default 4096.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:92](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L92)

Default model used when `LLMRequest.model` is `'anthropic'` (the
shorthand). When the request specifies a full model id, that wins.
