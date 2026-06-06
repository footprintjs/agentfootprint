[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserOpenAIProviderOptions

# Interface: BrowserOpenAIProviderOptions

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:97](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L97)

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:99](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L99)

API key. REQUIRED.

***

### apiUrl?

> `readonly` `optional` **apiUrl?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:105](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L105)

Override the API URL (Ollama, Together, vLLM, OpenAI proxies).

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:103](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L103)

Default max tokens.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:101](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L101)

Default model when `LLMRequest.model` is `'openai'`.

***

### organization?

> `readonly` `optional` **organization?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:107](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/llm/BrowserOpenAIProvider.ts#L107)

Optional `Organization` header.
