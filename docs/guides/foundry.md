# Microsoft Foundry

> **Like:** agentfootprint is the *engine + dashboard* of the car. Foundry shows
> up twice and they are different parts: the **fuel** (a model your agent calls —
> `foundry()`, `foundryLocal()`) and a **test track with its own gate protocol**
> (the Foundry Toolkit's Agent Inspector — `foundryResponsesHost()`). Neither
> half needs the other.

- **Outbound** — the model your agent calls. Two providers, below.
- **Inbound** — the door requests arrive at. One hosting adapter, further down.

---

## Outbound: `foundry()` — a Foundry project

Point at a Foundry **project**, name a **deployment**, say which identity signs.
Inside a hosted Foundry container the first two are already in the environment,
so this is a complete configuration:

```ts
import { Agent } from 'agentfootprint';
import { foundry } from 'agentfootprint/providers';

const agent = Agent.create({
  provider: foundry(),   // endpoint injected by the platform; managed identity signs
  model: 'foundry',      // the shorthand for the configured deployment
}).build();
```

Anywhere else, name them:

```ts
import { DefaultAzureCredential } from '@azure/identity';
import { foundry } from 'agentfootprint/providers';

const provider = foundry({
  projectEndpoint: 'https://my-acct.services.ai.azure.com/api/projects/my-proj',
  deployment: 'gpt-4o-128k',
  credential: new DefaultAzureCredential(),   // or `apiKey`, never both
});
```

### What it speaks

| Wire point | Behavior |
|---|---|
| URL | The project endpoint **plus `/openai/v1`** — the api-version-free v1 route, GA, served directly off the project path. Trailing slashes trimmed; an endpoint already ending in `/openai/v1` is left alone. `foundryInferenceUrl()` is exported if you want the derived URL |
| Endpoint source | `projectEndpoint`, else `FOUNDRY_PROJECT_ENDPOINT` — **auto-injected** in a hosted Foundry container. Missing: refused by name, with the expected shape quoted |
| Model | The wire's `model` field carries the **deployment** name. `deployment`, else `AZURE_AI_MODEL_DEPLOYMENT_NAME` (the `azd` scaffolding convention), else `MODEL_NAME`. The request shorthand `'foundry'` resolves to it; a concrete deployment id passes through, so one provider can target several |
| Auth | `Authorization: Bearer` — a `credential` (any `@azure/identity` credential, duck-typed), an `apiKey` (string, or a callback re-read per request; the v1 route accepts a key as a Bearer), or, with **neither** given, `new DefaultAzureCredential()` from the optional `@azure/identity` peer |
| Token audience | `https://ai.azure.com/.default`, overridable with `scope`. Tokens are minted **before every request**, so MSAL's cache does the pacing |
| Dialect | Current OpenAI wire, declared rather than implied: `max_completion_tokens`, `stream_options.include_usage` on streams, and forced tool choice declared. (This is what the public `legacyEndpoint: false` dial on `openai()` exists for; `foundry()` sets it for you) |
| Endpoint validation | `https://` with `/api/projects/` in the path, or the refusal quotes what arrived. A resource root or an ARM URL would otherwise fail as a 404 or 401 far from the typo |

### What it deliberately does not do

- **Auto-detect a reasoning model.** Deployment names are arbitrary and hide the
  model, so `reasoning: true` must be declared to omit `temperature` and send the
  `developer` role. Same rationale as `azureOpenai()`.
- **Accept two credentials.** `credential` **and** `apiKey` together is refused by
  name: whichever one this factory silently preferred would be the one you did
  not think was in use.
- **Touch the control plane.** The token audience here is the data plane. Listing
  deployments or creating resources is `https://management.azure.com/.default`,
  a different audience whose tokens are a 401 here. `entraIdentity()` from
  `agentfootprint/security` exports both audience names, `AZURE_AI_SCOPE` and
  `AZURE_MANAGEMENT_SCOPE`.
- **Anything `openai()` does not do** — no multi-modal input, no JSON mode. It is
  the same machinery underneath.

### The hosted-container env contract

A container the Foundry platform runs for you starts with the wiring already
done, which is what makes `foundry()` with no arguments honest there:

| Variable | Who sets it | What to do with it |
|---|---|---|
| `FOUNDRY_PROJECT_ENDPOINT` | the platform, **injected** | Nothing — `foundry()` reads it |
| the rest of the `FOUNDRY_*` and `AGENT_*` names | the platform | Treat both prefixes as **reserved**: do not define your own variables under them, or a future platform key will collide with yours |
| `PORT` | the platform | The port your server must bind. agentfootprint's hosts default to their own port and **do not read `PORT`**, so pass it: `foundryResponsesHost({ port: Number(process.env.PORT ?? 8088) })` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | the platform | Present, and agentfootprint does **not** consume it today. An Application Insights sink is a later train; nothing here promises one, and no telemetry goes to it by accident |

## Outbound: `foundryLocal()` — a model on this machine

Foundry Local is Microsoft's on-device runtime: ONNX underneath, models pulled
with `foundry model run <alias>`, **no key and no account**. The adapter talks to
it over `fetch` alone — no SDK, no peer dependency — exactly as `ollama()` does:

```ts
import { Agent } from 'agentfootprint';
import { foundryLocal } from 'agentfootprint/providers';

const agent = Agent.create({
  provider: foundryLocal('qwen2.5-0.5b'),
  model: 'qwen2.5-0.5b',
}).build();

// the service on another port — `foundry server status` prints the live one
foundryLocal('qwen2.5-0.5b', { endpoint: 'http://127.0.0.1:57127' });
```

### What it speaks

| Wire point | Behavior |
|---|---|
| URL | `POST {endpoint}/v1/chat/completions` — the OpenAI dialect the service serves |
| Endpoint source | `endpoint`, else a duck-typed `foundry-local-sdk` manager's `urls[0]`, else `FOUNDRY_LOCAL_ENDPOINT`, else `FOUNDRY_LOCAL_BASE_URL`, else `http://localhost:5272`. A trailing `/v1` is trimmed; a bare `host:port` gets `http://` |
| The port | **Dynamic.** Every `foundry server start` may pick a new one; `5272` is only the port in Microsoft's own REST walkthrough. `foundry server status` prints the live URL, `foundry server start --port <p>` pins one. (Checking by hand, the service's status route is `GET /openai/status` — there is no `/v1/health`) |
| Model id | REST chat takes the **full variant id** (`qwen2.5-0.5b-instruct-generic-cpu:1`). An alias is resolved through the service's catalog — first matching variant wins, because that list's order **is** the service's priority order — and cached per provider instance. A name already ending in `-cpu`/`-gpu`/`-npu` (optionally `:version`) skips the lookup |
| Auth | **None.** No API key exists on this wire, so no `Authorization` header is sent — an invented value would only end up in somebody's proxy log |
| Streaming | SSE, with `stream_options: { include_usage: true }` always sent, so token counts are real rather than zero |
| Refusals | A typed `FoundryLocalUnavailableError` carrying `reason` (`'service-unreachable'` \| `'model-not-available'`), the `endpoint` tried, the `model`, and the models this machine has cached when the service could say. The messages are the fix: `foundry server start` **and** `foundry server status` for an unreachable service (with a dynamic port, a stale URL is the likelier cause), `foundry model run <model>` for a missing one |

### What it deliberately does not do

- **Claim forced tool choice.** `tool_choice` is undocumented on this wire, so
  `carriesForcedToolChoice` is `false` and an agent using
  `.outputSchema(parser, { strategy: 'tool-forced' })` refuses at run start,
  naming this provider rather than sending a field that may be ignored.
- **Preflight-refuse on tool support.** The catalog reports it per variant, but a
  wrong refusal is worse than a weak answer — the same stance `ollama()` takes.
  Pick a tool-capable variant.
- **Multi-modal, prompt caching, structured thinking.** None of the three. A
  reasoning model's `<think>` tags ride the answer text untouched.
- **Guess when the catalog is silent.** A failed alias lookup sends the name you
  wrote, so the chat call's own error names the model you actually asked for.

## Outbound: choosing from the environment

`providerFromEnv()` picks a provider from `.env` with no branching in your code.
Both doors are in its order, and both placements are deliberate:

1. `OLLAMA_MODEL` → `ollama()`
2. **`FOUNDRY_LOCAL_MODEL`** (+ optional `FOUNDRY_LOCAL_ENDPOINT` | `FOUNDRY_LOCAL_BASE_URL`) → **`foundryLocal()`**
3. **`FOUNDRY_PROJECT_ENDPOINT`** + (`AZURE_AI_MODEL_DEPLOYMENT_NAME` | `MODEL_NAME`) → **`foundry()`**
4. `AZURE_OPENAI_API_KEY` + endpoint + api-version + deployment → `azureOpenai()`
5. `ANTHROPIC_API_KEY` → `anthropic()`
6. `OPENAI_API_KEY` → `openai()`

A **local model name outranks the project endpoint**: `FOUNDRY_LOCAL_MODEL` is a
name a person typed for this run, and `FOUNDRY_PROJECT_ENDPOINT` can be injected
by the platform — an injected variable must never beat a hand-typed one. And the
project endpoint **outranks the credential arms below it**, because those trigger
on a credential and credentials linger in a shell by accident, while
`FOUNDRY_PROJECT_ENDPOINT` is a product-specific spelling nobody exports by
mistake. An endpoint with no deployment named is refused, not guessed — Foundry
routes by deployment and has no default. See [adapters.md](adapters.md) for the
full table.

---

## Inbound: hosting your agent for Agent Inspector

The [Foundry Toolkit for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-windows-ai-studio.windows-ai-studio)
talks to a locally hosted agent over the **Responses** protocol. agentfootprint
serves that contract as one inbound hosting adapter on the same `AgentHost` port
every other host uses — your agent code does not change.

**This half is a hosting adapter, not a model provider.** It is the door requests
arrive at; which model the agent calls is the outbound decision above, and
nothing here changes it.

### The whole integration

```ts
import { foundryResponsesHost, memorySessions, standingAgent } from 'agentfootprint/hosting';

const handle = await standingAgent({
  agent,                          // any agentfootprint Agent
  sessions: memorySessions(),
  host: foundryResponsesHost(),   // :8088 — POST/HEAD /responses, GET /readiness
});
process.on('SIGTERM', () => void handle.close());
```

Point Agent Inspector at `http://localhost:8088` and chat. The runnable,
self-testing version of this file is
[`examples/deploy/foundry-responses.ts`](../../examples/deploy/foundry-responses.ts).

### What the adapter speaks

| Contract point | Behavior |
|---|---|
| `HEAD /responses` | `204` — the Inspector's capability probe |
| `GET /readiness` | `200` `{"status":"healthy"}` |
| `POST /responses`, `input` as a string | one turn |
| `POST /responses`, `input` as user-message items with `input_text` parts | one turn (parts joined) |
| `stream: true` **in the body** | the nine-event Responses SSE lifecycle, `response.created` → `response.completed`, stable ids, monotonic `sequence_number` |
| failure while streaming | terminal `response.failed` |
| session | `conversation` → `agent_session_id` → `session_id`, first present wins |
| caller disconnect | aborts `HostRequest.signal` |
| request body | refused over the ceiling (default 1 MiB, `maxBodyBytes`) |
| a handler that throws | reported as a failed response with a **sanitized** message — an uncaught exception's text never travels |

Under it sits `responsesWire()` — the Responses protocol as a plain `HttpWire`,
with no vendor in it. A deployment that speaks Responses on paths of its own
composes `httpHost({ wire: responsesWire(), ... })` directly.

### What it deliberately does not do

Each of these is **refused by name** (HTTP 400 before your agent runs), never
silently dropped:

- image and file input parts;
- non-`message` input items (`function_call_output`, reasoning items, …);
- non-`user` roles.

And these are out of scope by design:

- **Workflow Visualizer topology.** The Inspector renders the conversation; it
  will show one generic run, not your agent's internal structure. Nothing in
  the Responses text protocol carries topology, and this adapter does not
  invent a channel for it. An agent's internal structure is readable from
  agentfootprint's own recorders (`agentfootprint/observe`).
- The full Responses API surface: response retrieval/storage, background mode,
  explicit cancel routes, tool-call continuation.
- `reply.awaiting` / `reply.artifact` / `reply.sessions` terminals — the
  protocol has no shape for them, so they fail explicitly rather than
  answering with an invented success.

---

## Verified how

**The hosting adapter** passes the same host conformance suite as `nodeHost` and
`agentCoreRuntimeHost` over a real socket, plus a contract suite carrying the
request/lifecycle shapes captured from a real Toolkit 1.6.9 Agent Inspector
session (connection, streaming, final-answer rendering all observed live; the
capture and evidence live in the integration trial's reports). Cloud-hosted
Inspector behavior and Foundry Hosted Agent deployment are **not** covered.

**`foundry()`** is driven by the real `openai` SDK against a fake Foundry wire on
a real socket, which is the only way to prove the four things a client double
cannot see: the request lands on `/openai/v1/chat/completions` under the project
path; auth arrives as `Authorization: Bearer` rather than classic Azure's
`api-key`; the body carries `max_completion_tokens` and never `max_tokens`, with
`stream_options.include_usage` on streams; and a token that rotates between calls
reaches the second request.

**`foundryLocal()`** is tested against an injected fake `fetch` — endpoint
resolution, alias→variant catalog resolution and its cache, SSE streaming with
usage riding the final empty-choices chunk, and both typed refusals — so the
suite runs offline with nothing installed.

Neither provider is claimed as field-verified against a live Foundry account or a
live Foundry Local install. The wire facts they are built on are Microsoft's own
documented ones, named above so you can check them against your resource before
you trust them.
