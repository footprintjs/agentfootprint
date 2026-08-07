[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / providerFromEnv

# Function: providerFromEnv()

> **providerFromEnv**(`opts?`): [`ProviderFromEnv`](/agentfootprint/api/generated/interfaces/ProviderFromEnv.md)

Defined in: [src/adapters/llm/createProvider.ts:133](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/llm/createProvider.ts#L133)

Resolve an `LLMProvider` from environment variables — drop your company's
values in `.env` and the right provider is configured automatically, with no
code branching. (Node only — reads `process.env`; the vendor SDK is lazy-loaded
only for the detected provider.)

Detection order (first match wins):
  1. **Ollama (local)** — `OLLAMA_MODEL` names a model, e.g. `qwen3`
     [+ `OLLAMA_HOST` for a runtime that isn't on localhost]
  2. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` |
     `OPENAI_BASE_URL`) [+ `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT`|`MODEL_NAME`]
  3. **Anthropic** — `ANTHROPIC_API_KEY`
  4. **OpenAI** — `OPENAI_API_KEY`
Otherwise throws (or returns the mock when `{ fallbackToMock: true }`).

**Why the local model goes first.** Every other arm triggers on a
CREDENTIAL, and credentials arrive in a shell by accident all the time —
a key exported in `.zshrc` two months ago for something else. `OLLAMA_MODEL`
triggers on a NAME you had to choose and type, so its presence is a
declaration rather than a leftover: someone who writes `OLLAMA_MODEL=qwen3`
has said which model they want this run to use, and honoring the cloud key
instead would both ignore them and cost them money. (`OLLAMA_HOST` alone is
NOT a trigger — people export it just to run Ollama, and it must not hijack
an app that never asked for a local model.)

**No probing.** This function reads environment variables and nothing else.
It never opens a socket to see whether a daemon is up — its answer stays
deterministic, instant, and identical on a laptop and in CI. If `OLLAMA_MODEL`
is set and the daemon is down, you get the provider, and the refusal arrives
from the call itself with `ollama serve` in the message.

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
