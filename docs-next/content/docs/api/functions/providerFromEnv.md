---
title: providerFromEnv
---

# Function: providerFromEnv()

> **providerFromEnv**(`opts?`): [`ProviderFromEnv`](/docs/api/interfaces/ProviderFromEnv)

Defined in: [src/adapters/llm/createProvider.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L208)

Resolve an `LLMProvider` from environment variables — drop your company's
values in `.env` and the right provider is configured automatically, with no
code branching. (Node only — reads `process.env`; the vendor SDK is lazy-loaded
only for the detected provider.)

Detection order (first match wins):
  1. **Ollama (local)** — `OLLAMA_MODEL` names a model, e.g. `qwen3`
     [+ `OLLAMA_HOST` for a runtime that isn't on localhost]
  2. **Foundry Local (local)** — `FOUNDRY_LOCAL_MODEL` names a model, e.g.
     `qwen2.5-0.5b` [+ `FOUNDRY_LOCAL_ENDPOINT` | `FOUNDRY_LOCAL_BASE_URL`
     when the service isn't on the docs' example port]
  3. **Foundry (project)** — `FOUNDRY_PROJECT_ENDPOINT`
     + (`AZURE_AI_MODEL_DEPLOYMENT_NAME` | `MODEL_NAME`); the returned
     `model` is the deployment you named. Auth is whatever `foundry()`
     resolves — inside a hosted Foundry container that is managed identity
     with zero further configuration. The endpoint with NO deployment named
     does not match: this arm steps aside, every arm below gets its normal
     turn, and Foundry's refusal is raised only if none of them resolves.
  4. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` |
     `OPENAI_BASE_URL`) + `AZURE_OPENAI_API_VERSION`
     + (`AZURE_OPENAI_DEPLOYMENT` | `MODEL_NAME`).
     `AZURE_OPENAI_ENDPOINT` and `OPENAI_BASE_URL` are two spellings of the
     same resource root and reach the identical URL; the returned `model` is
     the deployment you named.
  5. **Anthropic** — `ANTHROPIC_API_KEY`
  6. **OpenAI** — `OPENAI_API_KEY`
Otherwise throws (or returns the mock when `{ fallbackToMock: true }`).

**Why the local models go first.** The credential arms trigger on a
CREDENTIAL, and credentials arrive in a shell by accident all the time —
a key exported in `.zshrc` two months ago for something else. `OLLAMA_MODEL`
and `FOUNDRY_LOCAL_MODEL` trigger on a NAME you had to choose and type, so
their presence is a declaration rather than a leftover: someone who writes
`OLLAMA_MODEL=qwen3` has said which model they want this run to use, and
honoring the cloud key instead would both ignore them and cost them money.
(`OLLAMA_HOST` alone is NOT a trigger — people export it just to run
Ollama, and it must not hijack an app that never asked for a local model.
The same holds for `FOUNDRY_LOCAL_ENDPOINT` / `FOUNDRY_LOCAL_BASE_URL`.)

**Why Foundry sits between the names and the keys.**
`FOUNDRY_PROJECT_ENDPOINT` is a product-specific spelling nobody exports by
accident — and the one the hosted Foundry platform AUTO-INJECTS into its
containers — so where it is present AND a deployment is named, Foundry is
the declared destination and it outranks the lingering-credential arms
below. It still yields to the two local-model arms: precisely because the
platform can inject it, it must never beat a model name a person typed for
THIS run.

**Why an endpoint alone never breaks your boot.** That same injection cuts
the other way. A hosted Foundry container whose agent calls Anthropic — the
shape this project's own hosting adapter ships for — receives the endpoint
whether or not anyone asked for Foundry INFERENCE, and it names no
deployment. So an endpoint with no deployment is not a throw: the arm holds
its refusal, and Azure, Anthropic, OpenAI and `fallbackToMock` all run
exactly as they did before this arm existed. The held refusal surfaces only
when the environment declares nothing else at all — where it is the most
useful message there is, because the endpoint is then the only clue.

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

[`ProviderFromEnv`](/docs/api/interfaces/ProviderFromEnv)

## Example

```ts
import { providerFromEnv } from 'agentfootprint';
  const { provider, model, kind } = providerFromEnv({ fallbackToMock: true });
  const agent = Agent.create({ provider, model }).build();
```
