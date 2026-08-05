[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / providerFromEnv

# Function: providerFromEnv()

> **providerFromEnv**(`opts?`): [`ProviderFromEnv`](/agentfootprint/api/generated/interfaces/ProviderFromEnv.md)

Defined in: [src/adapters/llm/createProvider.ts:114](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/adapters/llm/createProvider.ts#L114)

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

[`ProviderFromEnv`](/agentfootprint/api/generated/interfaces/ProviderFromEnv.md)

## Example

```ts
import { providerFromEnv } from 'agentfootprint';
  const { provider, model, kind } = providerFromEnv({ fallbackToMock: true });
  const agent = Agent.create({ provider, model }).build();
```
