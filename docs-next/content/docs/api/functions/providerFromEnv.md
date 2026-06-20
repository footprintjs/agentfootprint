---
title: providerFromEnv
---

# Function: providerFromEnv()

> **providerFromEnv**(`opts?`): [`ProviderFromEnv`](/docs/api/interfaces/ProviderFromEnv)

Defined in: [src/adapters/llm/createProvider.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L114)

Resolve an `LLMProvider` from environment variables — drop your company's
values in `.env` and the right provider is configured automatically, with no
code branching. (Node only — reads `process.env`; the vendor SDK is lazy-loaded
only for the detected provider.)

Detection order (first match wins):
  1. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` |
     `OPENAI_BASE_URL`) [+ `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT`|`MODEL_NAME`]
  2. **Anthropic** — `ANTHROPIC_API_KEY`
  3. **OpenAI** — `OPENAI_API_KEY`
Otherwise throws (or returns the mock when `{ fallbackToMock: true }`).

## Parameters

### opts?

#### fallbackToMock?

`boolean`

## Returns

[`ProviderFromEnv`](/docs/api/interfaces/ProviderFromEnv)

## Example

```ts
import { providerFromEnv } from 'agentfootprint';
  const { provider, model, kind } = providerFromEnv({ fallbackToMock: true });
  const agent = Agent.create({ provider, model }).build();
```
