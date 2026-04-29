[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OpenAIProviderOptions

# Interface: OpenAIProviderOptions

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:121](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L121)

## Properties

### apiKey?

> `readonly` `optional` **apiKey?**: `string`

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:123](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L123)

API key. Defaults to `OPENAI_API_KEY` env var.

***

### baseURL?

> `readonly` `optional` **baseURL?**: `string`

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:125](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L125)

Base URL — set for OpenAI-compatible APIs (Ollama, Together, vLLM).

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:132](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L132)

Default max tokens when the request doesn't set it. Optional.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:130](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L130)

Default model used when `LLMRequest.model` is `'openai'` (the
shorthand). Full model ids pass through unchanged.
