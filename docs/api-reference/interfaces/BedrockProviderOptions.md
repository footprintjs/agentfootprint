[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BedrockProviderOptions

# Interface: BedrockProviderOptions

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:106](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L106)

## Properties

### defaultMaxTokens?

> `readonly` `optional` **defaultMaxTokens?**: `number`

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:115](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L115)

Default max tokens when not in the request. Default 4096.

***

### defaultModel?

> `readonly` `optional` **defaultModel?**: `string`

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L113)

Default model id (e.g., `anthropic.claude-sonnet-4-5-20250929-v1:0`).
Used when `LLMRequest.model` is the shorthand `'bedrock'`.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [agentfootprint/src/adapters/llm/BedrockProvider.ts:108](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/BedrockProvider.ts#L108)

AWS region (e.g., 'us-east-1'). Defaults to AWS SDK auto-detect.
