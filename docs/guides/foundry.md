# Microsoft Foundry Toolkit (Agent Inspector)

> **Like:** agentfootprint is the *engine + dashboard* of the car; the Foundry
> Toolkit is a *test track with its own gate protocol*. `foundryResponsesHost()`
> is the gate adapter — the agent you already built drives on unchanged.

The [Foundry Toolkit for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-windows-ai-studio.windows-ai-studio)
talks to a locally hosted agent over the **Responses** protocol. agentfootprint
serves that contract as one inbound hosting adapter on the same `AgentHost` port
every other host uses — your agent code does not change.

**This is an inbound hosting adapter, not a model provider.** It is the door
requests arrive at. Which model your agent calls is a separate, independent
decision — for a Foundry Local model it is the existing `openai()` provider
pointed at the local endpoint (see [adapters.md](adapters.md)); nothing about
this host changes either way.

## The whole integration

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

## What the adapter speaks

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

## What it deliberately does not do

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

## Verified how

The adapter passes the same host conformance suite as `nodeHost` and
`agentCoreRuntimeHost` over a real socket, plus a contract suite carrying the
request/lifecycle shapes captured from a real Toolkit 1.6.9 Agent Inspector
session (connection, streaming, final-answer rendering all observed live; the
capture and evidence live in the integration trial's reports). Cloud-hosted
Inspector behavior and Foundry Hosted Agent deployment are **not** covered.
