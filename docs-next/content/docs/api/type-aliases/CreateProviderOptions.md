---
title: CreateProviderOptions
---

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & [`MockProviderOptions`](/docs/api/interfaces/MockProviderOptions) \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OpenAIProviderOptions` & `object` \| `object` & `BedrockProviderOptions` \| `object` & [`BrowserAnthropicProviderOptions`](/docs/api/interfaces/BrowserAnthropicProviderOptions) \| `object` & [`BrowserOpenAIProviderOptions`](/docs/api/interfaces/BrowserOpenAIProviderOptions)

Defined in: [src/adapters/llm/createProvider.ts:50](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/llm/createProvider.ts#L50)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
