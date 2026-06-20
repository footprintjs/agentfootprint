---
title: BrowserAzureOpenAIProviderOptions
---

# Interface: BrowserAzureOpenAIProviderOptions

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:258](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L258)

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:263](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L263)

API key (Azure `api-key`). REQUIRED.

***

### apiVersion

> `readonly` **apiVersion**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:265](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L265)

Azure API version, e.g. `2024-12-01-preview`. REQUIRED.

***

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:269](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L269)

Default max tokens.

***

### deployment

> `readonly` **deployment**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:267](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L267)

The DEPLOYMENT name (Azure's "model"), e.g. `gpt-4o-128k`. REQUIRED.

***

### endpoint

> `readonly` **endpoint**: `string`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:261](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L261)

Resource endpoint, e.g. `https://my-co.openai.azure.com` (or a same-origin
 proxy path like `/azure` to sidestep CORS in dev). REQUIRED.

***

### reasoning?

> `readonly` `optional` **reasoning?**: `boolean`

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:272](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/BrowserOpenAIProvider.ts#L272)

Set when the Azure deployment is a **reasoning model** (o1/o3/o4-mini) — omits
 `temperature` and sends the `developer` role.
