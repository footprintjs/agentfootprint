---
title: BrowserOpenAIProviderOptions
---

# Interface: BrowserOpenAIProviderOptions

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:102](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L102)

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:104](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L104)

API key. REQUIRED.

***

### apiUrl?

> `readonly` `optional` **apiUrl?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:110](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L110)

Override the API URL (Ollama, Together, vLLM, OpenAI proxies).

***

### authScheme?

> `readonly` `optional` **authScheme?**: `"bearer"` \| `"api-key"`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:115](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L115)

Auth header scheme. `'bearer'` (default) → `Authorization: Bearer <key>`;
 `'api-key'` → the `api-key` header (Azure OpenAI).

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:108](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L108)

Default max tokens.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:106](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L106)

Default model when `LLMRequest.model` is `'openai'`.

***

### organization?

> `readonly` `optional` **organization?**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:112](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L112)

Optional `Organization` header.

***

### reasoning?

> `readonly` `optional` **reasoning?**: `boolean`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:119](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L119)

Treat the target as a **reasoning model** (o-series): omit `temperature` and send
 the `developer` role. Standard o-series ids are auto-detected; set for arbitrary
 Azure deployment names.
