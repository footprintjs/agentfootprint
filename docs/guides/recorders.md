# Recorders & Events

> **An agent that can't be measured can't be improved.** Events and recorders are agentfootprint's measurement layer.

Observation in agentfootprint is passive — it watches agent execution without changing behavior. It collects metrics, tracks costs, evaluates quality, surfaces grounding evidence, and feeds dashboards — all during traversal, never as a post-processing step.

There are **two observation surfaces**, and you pick based on how much structure you want:

1. **Typed events** — `agent.on(type, listener)`. Subscribe to the typed event stream. Lowest-level, zero ceremony, compile-time-checked payloads.
2. **Recorders** — `agent.attach(recorder)` (or the fluent `.recorder(rec)` at build time). Attach a footprintjs `CombinedRecorder` that accumulates across many events.

On top of those, the **`.enable.*` namespace** bundles ready-made observability layers (cost, logging, live status, flowchart) into one-liners.

```typescript
import { Agent } from 'agentfootprint';

const agent = Agent.create({ provider, model: 'claude-sonnet-4-20250514' })
  .system('Be helpful.')
  .build();

// Surface 1 — typed event subscription
agent.on('agentfootprint.stream.llm_end', (e) => {
  console.log(`${e.payload.usage.input}in / ${e.payload.usage.output}out`);
});

await agent.run({ message: 'Hello' });
```

---

## Surface 1 — Typed Events

Every runner (Agent, LLMCall, every composition and pattern) exposes a typed dispatcher:

```typescript
agent.on(type, listener, options?)   // subscribe; returns an Unsubscribe fn
agent.once(type, listener)           // subscribe once, then auto-detach
agent.off(type, listener)            // detach
agent.emit(name, payload)            // emit a consumer-defined event
```

`.on()` is **compile-time checked** — the listener's `e.payload` is typed to the event you subscribed to.

```typescript
// Specific typed subscription — payload type is known.
agent.on('agentfootprint.stream.llm_start', (e) => {
  console.log(`llm_start: iter=${e.payload.iteration} model=${e.payload.model}`);
});

// Domain wildcard — every `stream.*` event.
agent.on('agentfootprint.stream.*', (e) => {
  console.log(`[stream.*] ${e.type}`);
});

// Global wildcard — every event (debugging).
agent.on('*', () => { totalEvents++; });
```

Every event is an envelope: `{ type, payload, meta }`. The `meta` (`EventMeta`) carries `runtimeStageId`, `subflowPath`, `turnIndex`, `iterIndex`, `runId`, and timing — so you can correlate any event back to the exact execution step that produced it.

### Common event types

Event names are hierarchical dotted strings under `agentfootprint.<domain>.<event>`. The most useful for measurement:

| Event type | When it fires | Key payload fields |
|------------|--------------|--------------------|
| `agentfootprint.agent.turn_start` | A turn begins | `turnIndex`, `userPrompt` |
| `agentfootprint.agent.turn_end` | A turn produces its final answer | `turnIndex`, `finalContent`, `totalInputTokens`, `totalOutputTokens`, `iterationCount`, `durationMs` |
| `agentfootprint.agent.iteration_start` / `iteration_end` | Each ReAct loop iteration | `turnIndex`, `iterIndex`, `toolCallCount` |
| `agentfootprint.agent.route_decided` | The loop chooses tool-calls vs final | `chosen` (`'tool-calls' \| 'final'`), `rationale?` |
| `agentfootprint.stream.llm_start` | Before each LLM invocation | `iteration`, `provider`, `model`, `messagesCount`, `toolsCount` |
| `agentfootprint.stream.llm_end` | After each LLM invocation | `iteration`, `content`, `toolCallCount`, `usage` (`{ input, output, cacheRead?, cacheWrite? }`), `stopReason`, `durationMs` |
| `agentfootprint.stream.tool_start` / `tool_end` | Each tool execution | `toolName`, `toolCallId`, `args` / `result`, `error?`, `durationMs` |
| `agentfootprint.cost.tick` | After each costed LLM call (needs a `pricingTable`) | `scope`, `estimatedUsd`, `cumulative` |
| `agentfootprint.cost.limit_hit` | Cumulative cost crosses `costBudget` | `kind`, `limit`, `actual`, `action` |
| `agentfootprint.eval.score` | A consumer/eval recorder scores output | `metricId`, `value`, `target`, `targetRef` |
| `agentfootprint.context.injected` | Context lands in a slot | `slot`, `source`, `contentSummary`, `reason` |
| `agentfootprint.error.fatal` | An unrecovered error ends the run | `error`, `stage`, `scope` |
| `agentfootprint.pause.request` / `pause.resume` | Human-in-the-loop pause boundary | `reason`, `questionPayload` / `resumeInput` |

The full registry (`EVENT_NAMES`, `ALL_EVENT_TYPES`, and the `AgentfootprintEventMap` type) is exported from the main `agentfootprint` barrel. There are dozens more domains — `memory.*`, `tools.*`, `skill.*`, `permission.*`, `reliability.*`, `composition.*`, `embedding.*` — all subscribable the same way.

### Consumer-owned events

Domains like `eval`, `memory`, and `skill` are partly consumer-driven — emit your own with `agent.emit()`. If the name matches a registered type it routes through the typed map; otherwise it reaches `'*'` listeners as an opaque event.

```typescript
agent.on('agentfootprint.eval.score', (e) => {
  console.log(`eval.score: ${e.payload.metricId}=${e.payload.value}`);
});

agent.emit('agentfootprint.eval.score', {
  metricId: 'response-quality',
  value: 0.85,
  target: 'run',
  targetRef: 'this-run',
  evaluator: 'heuristic',
});
```

---

## Surface 2 — Recorders

A **recorder** is a footprintjs `CombinedRecorder` — one object that hooks the scope, control-flow, and emit channels, with a stable `id`. Attach it to a built agent, or fluently at build time:

```typescript
import { Agent } from 'agentfootprint';
import type { CombinedRecorder } from 'agentfootprint';

const audit: CombinedRecorder = {
  id: 'audit',
  onWrite: (e) => log('scope write', e.key),
};

// Post-build:
const detach = agent.attach(audit);   // returns an Unsubscribe
// detach();                          // remove it later

// Or fluently at build time (sugar over agent.attach):
const agent2 = Agent.create({ provider })
  .system('Be helpful.')
  .recorder(audit)   // ← attach during build
  .build();
```

`.attach()` / `.recorder()` is **idempotent by `id`** (a recorder with the same id replaces the previous one; different ids coexist) — agentfootprint inherits this contract from footprintjs.

### Built-in recorder bridges

agentfootprint auto-attaches a set of internal **emit-bridge recorders** when you call `.build()` — they translate footprintjs scope/flow events into the typed `agentfootprint.*` event stream you subscribe to in Surface 1. You normally don't construct them yourself; the agent wires them. They're exported as factory functions for advanced cases (e.g. attaching to a bare footprintjs executor):

| Factory | Bridges into | Subpath |
|---------|--------------|---------|
| `agentRecorder(opts)` | `agentfootprint.agent.*` | `agentfootprint`, `agentfootprint/observe` |
| `streamRecorder(opts)` | `agentfootprint.stream.*` | `agentfootprint`, `agentfootprint/observe` |
| `costRecorder(opts)` | `agentfootprint.cost.*` | `agentfootprint`, `agentfootprint/observe` |
| `evalRecorder(opts)` | `agentfootprint.eval.*` | `agentfootprint`, `agentfootprint/observe` |
| `memoryRecorder(opts)` | `agentfootprint.memory.*` | `agentfootprint`, `agentfootprint/observe` |
| `skillRecorder(opts)` | `agentfootprint.skill.*` | `agentfootprint`, `agentfootprint/observe` |
| `toolsRecorder(opts)` | `agentfootprint.tools.*` | `agentfootprint`, `agentfootprint/observe` |
| `permissionRecorder(opts)` | `agentfootprint.permission.*` | `agentfootprint`, `agentfootprint/observe` |
| `compositionRecorder(opts)` | `agentfootprint.composition.*` | `agentfootprint`, `agentfootprint/observe` |
| `ContextRecorder` (class) | `agentfootprint.context.*` | `agentfootprint`, `agentfootprint/observe` |

Each factory takes `{ dispatcher, getRunContext, id? }`. Because the agent already attaches them, the way you *consume* their output is by subscribing with `agent.on(...)` (Surface 1) — not by reading methods off the recorder.

### Recorders that accumulate (for UI / dashboards)

Some recorders aggregate the event stream into a queryable structure. These are the ones you attach and then read back:

| Factory / class | What it accumulates | Subpath |
|-----------------|---------------------|---------|
| `boundaryRecorder()` / `BoundaryRecorder` | Chart in/out boundaries (entry/exit pairs at every subflow) | `agentfootprint`, `agentfootprint/observe` |
| `liveStateRecorder()` / `LiveStateRecorder` | Live LLM / tool / turn state for streaming dashboards | `agentfootprint`, `agentfootprint/observe` |
| `runStepRecorder()` / `buildRunSteps(...)` | A step graph (`RunStep[]`) over the whole run | `agentfootprint` |

These are the building blocks the agentfootprint Lens UI composes — see [streaming.md](streaming.md) for the full lifecycle-event timeline.

---

## `.enable.*` — One-Liner Observability Layers

The `enable` namespace wires a pre-built observability layer in a single call. Each returns an `Unsubscribe` (or, for `flowchart`, a handle you can query).

```typescript
// Live status line — "what's the agent doing right now".
const stopThinking = agent.enable.thinking({
  onStatus: (status) => console.log(`  ⎈ ${status}`),
});

// Firehose structured logging, filtered by domain.
import { LoggingDomains } from 'agentfootprint';
const stopLogging = agent.enable.logging({
  domains: [LoggingDomains.STREAM, LoggingDomains.AGENT],
  logger: { log: (message) => console.log(`  [log] ${message}`) },
});

// Live composition graph — feed any graph renderer (React Flow, D3, …).
const flow = agent.enable.flowchart();
// flow.getSnapshot()  → query the graph any time

try {
  await agent.run({ message: 'analyze the Q3 report' });
} finally {
  stopThinking();
  stopLogging();
}
```

| `enable.*` method | Returns | Purpose |
|-------------------|---------|---------|
| `enable.thinking(opts)` | `Unsubscribe` | Terse Claude-Code-style status line (`onStatus`). *Deprecated in v2.8 in favor of `enable.liveStatus`, kept for back-compat.* |
| `enable.logging(opts?)` | `Unsubscribe` | Firehose structured logs filtered by domain. *Deprecated in v2.8 in favor of `enable.observability`, kept for back-compat.* |
| `enable.flowchart(opts?)` | `FlowchartHandle` | Live composition graph with `getSnapshot()` |
| `enable.observability(opts?)` | `Unsubscribe` | Pipe every event into a vendor strategy (OTel, CloudWatch, AgentCore, …) |
| `enable.cost(opts?)` | `Unsubscribe` | Subscribe a `CostStrategy` to `cost.tick`; defaults to an in-memory sink for read-back |
| `enable.liveStatus(opts)` | `Unsubscribe` | Chat-bubble live-status state machine (strategy required) |

---

## Worked Example: Cost & Tokens

Cost and token data flow through the typed event stream. Supply a `PricingTable` so `cost.tick` events carry USD, then subscribe:

```typescript
import { Agent, type PricingTable } from 'agentfootprint';

const pricing: PricingTable = {
  name: 'demo-pricing',
  pricePerToken: (_model, kind) => {
    if (kind === 'input') return 0.00001;  // $0.01 / 1k input
    if (kind === 'output') return 0.00003; // $0.03 / 1k output
    return 0;
  },
};

const agent = Agent.create({
  provider,
  model: 'claude-sonnet-4-20250514',
  pricingTable: pricing,
  costBudget: 0.0001,   // optional — fires cost.limit_hit on crossing
})
  .system('Be helpful.')
  .build();

let inputTokens = 0;
let outputTokens = 0;
agent.on('agentfootprint.stream.llm_end', (e) => {
  inputTokens += e.payload.usage.input;
  outputTokens += e.payload.usage.output;
});

agent.on('agentfootprint.cost.tick', (e) => {
  console.log(`[tick] +$${e.payload.estimatedUsd.toFixed(6)} — cumulative $${e.payload.cumulative.estimatedUsd.toFixed(6)}`);
});

agent.on('agentfootprint.cost.limit_hit', (e) => {
  console.log(`⚠  budget ${e.payload.limit} crossed — actual ${e.payload.actual} (${e.payload.action})`);
});

await agent.run({ message: 'do the thing' });
console.log(`tokens: ${inputTokens}in / ${outputTokens}out`);
```

The library never auto-aborts on budget — `cost.limit_hit` is advisory; the consumer decides what to do.

---

## Custom Recorder

A recorder is any object with a stable `id` plus the footprintjs `CombinedRecorder` hooks you care about (`onWrite`, `onCommit`, `onStageExecuted`, `onDecision`, `onEmit`, `onError`, …). Implement only what you need:

```typescript
import type { CombinedRecorder } from 'agentfootprint';

class AuditRecorder implements CombinedRecorder {
  readonly id = 'audit';
  private log: string[] = [];

  // Scope channel — fires during stage execution.
  onWrite(e): void {
    this.log.push(`write ${e.key}`);
  }

  // Emit channel — fires for agentfootprint.* events routed through emit.
  onEmit(e): void {
    this.log.push(`emit ${e.name}`);
  }

  getLog(): string[] {
    return [...this.log];
  }
}

const rec = new AuditRecorder();
agent.attach(rec);
await agent.run({ message: 'Hello' });
console.log(rec.getLog());
```

For a recorder that observes a *specific* agentfootprint domain (cost, eval, tools, …) the simplest path is to subscribe with `agent.on('agentfootprint.<domain>.*', listener)` and accumulate in a closure — no class needed.

> **Compose, don't duplicate.** Building a domain-shaped view (a step graph, a cost ledger, a quality scoreboard)? Consume the typed event stream or wrap one of the accumulating recorders above — don't re-walk the execution tree. See [streaming.md](streaming.md).
