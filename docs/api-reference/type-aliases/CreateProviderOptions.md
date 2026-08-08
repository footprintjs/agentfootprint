[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & `MockProviderOptions` \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OllamaProviderOptions` \| `object` & `BedrockProviderOptions` \| `object` & `BrowserAnthropicProviderOptions` \| `object` & `BrowserOpenAIProviderOptions`

Defined in: [src/adapters/llm/createProvider.ts:51](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/adapters/llm/createProvider.ts#L51)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
