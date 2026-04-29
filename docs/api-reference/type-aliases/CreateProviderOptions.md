[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & [`MockProviderOptions`](/agentfootprint/api/generated/interfaces/MockProviderOptions.md) \| `object` & [`AnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/AnthropicProviderOptions.md) \| `object` & [`OpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/OpenAIProviderOptions.md) \| `object` & [`OpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/OpenAIProviderOptions.md) & `object` \| `object` & [`BedrockProviderOptions`](/agentfootprint/api/generated/interfaces/BedrockProviderOptions.md) \| `object` & [`BrowserAnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserAnthropicProviderOptions.md) \| `object` & [`BrowserOpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/BrowserOpenAIProviderOptions.md)

Defined in: [agentfootprint/src/adapters/llm/createProvider.ts:49](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/createProvider.ts#L49)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
