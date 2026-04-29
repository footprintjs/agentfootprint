[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ollama

# Function: ollama()

> **ollama**(`options?`): [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/adapters/llm/OpenAIProvider.ts:266](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/OpenAIProvider.ts#L266)

Convenience factory for Ollama (OpenAI-compatible endpoint).

## Parameters

### options?

[`OpenAIProviderOptions`](/agentfootprint/api/generated/interfaces/OpenAIProviderOptions.md) & `object` = `{}`

## Returns

[`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

## Example

```ts
import { ollama } from 'agentfootprint/providers';

  const provider = ollama({ defaultModel: 'llama3.2' });
  // Talks to http://localhost:11434/v1 by default.
```
