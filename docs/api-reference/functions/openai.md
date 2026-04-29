[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / openai

# Function: openai()

> **openai**(`options?`): [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:151](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L151)

Build an `LLMProvider` backed by OpenAI's Chat Completions API.

## Parameters

### options?

[`OpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/OpenAIProviderOptions.md) = `{}`

## Returns

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Example

```ts
import { Agent } from 'agentfootprint';
  import { openai } from 'agentfootprint/providers';

  const agent = Agent.create({
    provider: openai({ defaultModel: 'gpt-4o' }),
    model: 'openai',
  })
    .tool(searchTool)
    .build();
```
