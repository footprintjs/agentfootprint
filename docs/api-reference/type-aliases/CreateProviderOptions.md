[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & [`MockProviderOptions`](/agentfootprint/api/generated/interfaces/MockProviderOptions.md) \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OpenAIProviderOptions` & `object` \| `object` & `BedrockProviderOptions` \| `object` & [`BrowserAnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserAnthropicProviderOptions.md) \| `object` & [`BrowserOpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserOpenAIProviderOptions.md)

Defined in: [src/adapters/llm/createProvider.ts:50](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/llm/createProvider.ts#L50)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
