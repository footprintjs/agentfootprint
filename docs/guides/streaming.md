# Streaming & Lifecycle Events

> **Like:** a sportscaster narrating a game in real time. You hear what's happening as it happens, not after.

agentfootprint emits real-time lifecycle events during execution on a typed event bus. Every `Runner` (Agent, LLMCall, Sequence, …) is an event emitter — subscribe with `runner.on(type, listener)`. Consumers (CLI, web, mobile) use these to build smooth UX.

## Mental Model — Nested Lifecycles

The streaming/agent event types form a nested hierarchy. Read them as scopes:

```
agent.turn_start ───────────────────────────────────── agent.turn_end
   │
   ├─ agent.iteration_start
   │    ├─ stream.llm_start ── (stream.token | stream.thinking_delta)* ── stream.llm_end
   │    └─ stream.tool_start ────── stream.tool_end
   │  agent.iteration_end
   │
   ├─ agent.iteration_start
   │    ├─ stream.llm_start ── (stream.token | stream.thinking_delta)* ── stream.llm_end
   │    └─ stream.tool_start ────── stream.tool_end
   │  agent.iteration_end
        ⋮
```

A **turn** is one user message → final response. A turn contains one or more **iterations**, each made of an LLM call (with optional `stream.token` / `stream.thinking_delta` events inside) followed by zero or more tool calls. `agentfootprint.error.fatal` fires when a run terminates with an error.

**Background:** the event taxonomy mirrors the providers' native streaming protocols — Anthropic's Messages API distinguishes thinking / text / tool_use blocks; OpenAI's chat completions stream content + tool_calls separately. The `agentfootprint.stream.*` events are the lowest-common-denominator across them, plus the agentfootprint-specific framing events (`agentfootprint.agent.*`).

## Event Naming & Envelope

Every event has a hierarchical dotted `type` and an envelope shape `{ type, payload, meta }`. The typed payload lives on `e.payload`; `e.meta` carries `runtimeStageId`, `wallClockMs`, `turnIndex`, `iterIndex`, `runId`, etc. (see `EventMeta`).

```typescript
agent.on('agentfootprint.stream.token', (e) => {
  process.stdout.write(e.payload.content);   // e.payload is typed (LLMTokenPayload)
});
```

`.on()` is compile-time checked: the listener's `e.payload` is typed to the event you subscribed to. It returns an `Unsubscribe` function. Wildcards work too — `agent.on('agentfootprint.stream.*', …)` for a domain, `agent.on('*', …)` for everything.

## Quick Start

```typescript
import { Agent } from 'agentfootprint';

const agent = Agent.create({ provider, model: 'claude-sonnet-4-5' })
  .system('You are helpful.')
  .tool(searchTool)
  .build();

// Subscribe BEFORE running. Token-by-token streaming happens automatically
// when the provider exposes a streaming `provider.stream()` method.
agent.on('agentfootprint.agent.turn_start', (e) =>
  console.log(`User: ${e.payload.userPrompt}`));
agent.on('agentfootprint.stream.llm_start', (e) =>
  console.log(`\n--- LLM call (iteration ${e.payload.iteration}) ---`));
agent.on('agentfootprint.stream.token', (e) =>
  process.stdout.write(e.payload.content));
agent.on('agentfootprint.stream.tool_start', (e) =>
  console.log(`\nRunning ${e.payload.toolName}...`));
agent.on('agentfootprint.stream.tool_end', (e) =>
  console.log(`Done (${e.payload.durationMs}ms)`));
agent.on('agentfootprint.stream.llm_end', (e) =>
  console.log(`\n[${e.payload.content.length} chars, ${e.payload.durationMs}ms, ${e.payload.toolCallCount} tools]`));
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`\n=== Complete (${e.payload.iterationCount} iterations) ===`));
agent.on('agentfootprint.error.fatal', (e) =>
  console.error(`Error in ${e.payload.stage}: ${e.payload.error}`));

const result = await agent.run({ message: 'Search for TypeScript tutorials' });
```

`agent.run()` takes an `AgentInput` object (`{ message, identity? }`), not a bare string, and returns the final answer string (or a pause outcome — see below).

## Event Timeline

A typical multi-turn execution with tool calls:

```
agent.run({ message: 'Check order ORD-1003' })
  → agentfootprint.agent.turn_start { turnIndex: 0, userPrompt: 'Check order ORD-1003' }

  [Iteration 1 — LLM decides to call a tool]
    → agentfootprint.agent.iteration_start { turnIndex: 0, iterIndex: 1 }
    → agentfootprint.stream.llm_start { iteration: 1, provider, model, messagesCount, toolsCount }
    → agentfootprint.stream.token { iteration: 1, tokenIndex: 0, content: 'I' }
    → agentfootprint.stream.token { iteration: 1, tokenIndex: 1, content: "'ll" }
    → agentfootprint.stream.token { iteration: 1, tokenIndex: 2, content: ' look' }
    → agentfootprint.stream.token { iteration: 1, tokenIndex: 3, content: ' it up' }
    → agentfootprint.stream.llm_end { iteration: 1, toolCallCount: 1, content: "I'll look it up", usage, stopReason, durationMs }

  [Tool execution]
    → agentfootprint.stream.tool_start { toolName: 'lookup_order', toolCallId: 'tc-1', args: { orderId: 'ORD-1003' } }
    → agentfootprint.stream.tool_end { toolCallId: 'tc-1', result: '{"status":"denied",...}', durationMs: 42 }
    → agentfootprint.agent.iteration_end { turnIndex: 0, iterIndex: 1, toolCallCount: 1 }

  [Iteration 2 — LLM responds with final answer]
    → agentfootprint.agent.iteration_start { turnIndex: 0, iterIndex: 2 }
    → agentfootprint.stream.llm_start { iteration: 2 }
    → agentfootprint.stream.token { iteration: 2, tokenIndex: 0, content: 'Your' }
    → ...
    → agentfootprint.stream.llm_end { iteration: 2, toolCallCount: 0, content: 'Your order was denied...' }
    → agentfootprint.agent.iteration_end { turnIndex: 0, iterIndex: 2, toolCallCount: 0 }

  → agentfootprint.agent.turn_end { turnIndex: 0, finalContent: 'Your order was denied...', iterationCount: 2, totalInputTokens, totalOutputTokens, durationMs }
```

## The Streaming + Agent Event Types

| Event type | Fires | Key `payload` fields |
|---|---|---|
| `agentfootprint.agent.turn_start` | A turn begins | `turnIndex`, `userPrompt` |
| `agentfootprint.agent.iteration_start` | Each ReAct iteration begins | `turnIndex`, `iterIndex` |
| `agentfootprint.stream.llm_start` | Before each LLM invocation | `iteration`, `provider`, `model`, `systemPromptChars`, `messagesCount`, `toolsCount`, `temperature?` |
| `agentfootprint.stream.thinking_delta` | Extended-thinking chunk (provider-dependent) | `content` |
| `agentfootprint.stream.thinking_end` | Thinking block finished | (see `StreamThinkingEndPayload`) |
| `agentfootprint.stream.token` | One streamed text chunk (auto, when provider streams) | `iteration`, `tokenIndex`, `content` |
| `agentfootprint.stream.llm_end` | After each LLM invocation | `iteration`, `content`, `toolCallCount`, `usage` (`{ input, output, cacheRead?, cacheWrite? }`), `stopReason`, `durationMs` |
| `agentfootprint.stream.tool_start` | Each tool execution begins | `toolName`, `toolCallId`, `args`, `parallelCount?` |
| `agentfootprint.stream.tool_end` | Each tool execution ends | `toolCallId`, `result`, `error?`, `durationMs` |
| `agentfootprint.agent.iteration_end` | Each ReAct iteration ends | `turnIndex`, `iterIndex`, `toolCallCount` |
| `agentfootprint.agent.turn_end` | A turn produces its final answer | `turnIndex`, `finalContent`, `totalInputTokens`, `totalOutputTokens`, `iterationCount`, `durationMs` |
| `agentfootprint.error.fatal` | A run terminates with an error | `error`, `stage`, `scope` |

The complete payload shapes are the `*Payload` types exported from the package barrel (e.g. `LLMTokenPayload`, `LLMEndPayload`, `ToolEndPayload`, `AgentTurnEndPayload`). The full event registry — every domain (`context.*`, `cost.*`, `tools.*`, `permission.*`, …) — is `EVENT_NAMES`, also exported from `agentfootprint`.

## Token Streaming Is Automatic

There is no `.streaming()` toggle. `agentfootprint.stream.token` events fire whenever the configured `LLMProvider` exposes a `stream()` method — agentfootprint consumes it chunk-by-chunk and emits one `stream.token` per non-terminal chunk. Providers without a `stream()` method fall back to `provider.complete()`; the structural events (`llm_start` / `llm_end` / `tool_start` / `tool_end` / turn + iteration framing) still fire, just without per-token events.

| Event | Non-streaming provider | Streaming provider |
|-------|------------------------|--------------------|
| `agent.turn_start` / `turn_end` | Yes | Yes |
| `agent.iteration_start` / `iteration_end` | Yes | Yes |
| `stream.llm_start` / `llm_end` | Yes | Yes |
| `stream.token` | **No** | Yes |
| `stream.thinking_delta` / `thinking_end` | **No** | Yes (thinking-capable provider) |
| `stream.tool_start` / `tool_end` | Yes | Yes |
| `error.fatal` | Yes | Yes |

So the same subscriber code works with any provider — you simply get token events only when the provider can stream.

## SSE (Server-Sent Events)

For web backends streaming to browsers, use `toSSE(runner)` (or the class form `new SSEFormatter(runner).stream()`). It subscribes to the runner's event bus and yields SSE-formatted strings until the run finishes; drive `runner.run(...)` in parallel.

```typescript
import { toSSE } from 'agentfootprint';

app.post('/agent', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');

  // Start the run; do NOT await it yet — the iterable below drains events live.
  const running = agent.run({ message: req.body.message });

  for await (const chunk of toSSE(agent)) {
    res.write(chunk);
  }
  await running;
  res.end();
});
```

`toSSE` accepts `ToSSEOptions`: `filter` (predicate to skip events), `format` (`'full'` default, or `'text'` to yield only `stream.token` content), `eventName` (custom event-name extractor), and `heartbeatMs` (emit `: ping` comments to keep proxied connections alive). Output:

```
event: agentfootprint.stream.token
data: {"type":"agentfootprint.stream.token","payload":{"iteration":1,"tokenIndex":0,"content":"Hello"},"meta":{...}}

event: agentfootprint.stream.tool_start
data: {"type":"agentfootprint.stream.tool_start","payload":{"toolName":"search","toolCallId":"tc-1","args":{"q":"test"}},"meta":{...}}
```

For a token-only chat feed, pass `{ format: 'text' }` — each chunk is then the raw token text with no `event:`/`data:` framing. Use `encodeSSE(eventName, payload)` to format app-level frames (auth/error echoes) outside the runner's typed registry.

## Error Isolation

Listener errors are isolated by the event dispatcher — a throwing `.on()` handler never crashes the agent pipeline (passive observers never break execution). The run continues and other listeners still fire.

## Parallel Tool Calls

When the LLM requests multiple tool calls in a single iteration, each `stream.tool_start` carries a `parallelCount` field (the number of calls requested that iteration). Tools execute in the order the LLM requested them, so their `tool_start` / `tool_end` events arrive serially and each `toolCallId` pairs its own start/end. To group events per tool in the UI, key by `toolCallId`:

```typescript
const tools = new Map<string, { name: string; startedAt: number; endedAt?: number }>();

agent.on('agentfootprint.stream.tool_start', (e) => {
  tools.set(e.payload.toolCallId, { name: e.payload.toolName, startedAt: Date.now() });
});
agent.on('agentfootprint.stream.tool_end', (e) => {
  const t = tools.get(e.payload.toolCallId);
  if (t) t.endedAt = Date.now();
});
```

## Pause Events

When a tool requests human input (via `pauseHere()` / `askHuman()`), `agent.run()` returns a `RunnerPauseOutcome` (`{ paused: true, checkpoint, pauseData }`) instead of a string, and the runner emits `agentfootprint.pause.request`:

```typescript
import { isPaused } from 'agentfootprint';

agent.on('agentfootprint.pause.request', (e) => {
  showResumeUI(e.payload.questionPayload);   // ask the human
});

const outcome = await agent.run({ message: 'Refund this order' });
if (isPaused(outcome)) {
  // persist outcome.checkpoint somewhere, then later:
  const result = await agent.resume(outcome.checkpoint, { approved: true });
}
```

## Key Design Decisions

- **footprintjs: zero changes** — tokens flow through footprintjs's stream callback; agentfootprint adds semantics on top.
- **One event bus, many surfaces** — `.on()` (typed), `toSSE()` (SSE wire format), `enable.*` (grouped observability layers), and recorders all consume the same dispatcher.
- **Error isolation** — listener errors are swallowed by the dispatcher and never break execution.
- **Token streaming is provider-driven** — no opt-in flag; it follows from whether the provider implements `stream()`.
- **Latency on `llm_end` and `tool_end`** — `durationMs` is measured around the provider/tool call itself.
