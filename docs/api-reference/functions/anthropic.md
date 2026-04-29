[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / anthropic

# Function: anthropic()

> **anthropic**(`options?`): [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/adapters/llm/AnthropicProvider.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/AnthropicProvider.ts#L113)

Build an `LLMProvider` backed by Anthropic's Messages API.

## Parameters

### options?

[`AnthropicProviderOptions`](/agentfootprint/api/generated/interfaces/AnthropicProviderOptions.md) = `{}`

## Returns

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Example

```ts
import { Agent } from 'agentfootprint';
  import { anthropic } from 'agentfootprint/providers';

  const agent = Agent.create({
    provider: anthropic({ defaultModel: 'claude-sonnet-4-5-20250929' }),
    model: 'anthropic',
  })
    .tool(weatherTool)
    .build();
```
