# recorders/

Passive observers that collect data during traversal. Never shape behavior.

All recorders implement `AgentRecorder` — optional hooks fired by the agent loop. Attach via `.recorder()` on builders, or use `agentObservability()` for the bundled preset.

## Categories

### Evaluation — Was the agent faithful?

| Recorder | Fires on | Collects | Audience |
|----------|----------|----------|----------|
| `ExplainRecorder` | `onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete` | Per-iteration evaluation units: context (input, systemPrompt, tools, messages), decisions, sources (tool results), claims (LLM output) | LLM evaluator, test suite |

```typescript
const explain = new ExplainRecorder();
agent.recorder(explain).build();
await agent.run('Check order');

const report = explain.explain();
report.iterations;  // per-iteration connected data for faithfulness/hallucination checks
report.sources;     // tool results (ground truth)
report.claims;      // LLM output (to verify)
report.context;     // what the LLM had (systemPrompt, tools, messages)
```

### Metrics — How much did it cost? How fast?

| Recorder | Fires on | Collects | Audience |
|----------|----------|----------|----------|
| `TokenRecorder` | `onLLMCall` | Per-call token counts (input/output), model, latency | Ops dashboard, billing |
| `CostRecorder` | `onLLMCall` | USD cost per call (from pricing table) | Billing, budget alerts |
| `ToolUsageRecorder` | `onToolCall` | Per-tool call count, errors, avg latency | Ops dashboard, tool health |
| `TurnRecorder` | `onTurnStart`, `onTurnComplete` | Turn lifecycle, iteration count, message count | Agent loop monitoring |

```typescript
const tokens = new TokenRecorder();
const cost = new CostRecorder({ pricingTable: { 'claude-sonnet-4-20250514': { input: 3, output: 15 } } });
agent.recorder(tokens).recorder(cost).build();
await agent.run('Hello');

tokens.getStats();    // { totalCalls, totalInputTokens, totalOutputTokens, calls[] }
cost.getTotalCost();  // 0.0042
cost.getEntries();    // per-call breakdown
```

### Safety — Did it follow rules?

| Recorder | Fires on | Collects | Audience |
|----------|----------|----------|----------|
| `GuardrailRecorder` | `onToolCall`, `onTurnComplete` | Policy violations, blocked actions | Security team, compliance |
| `PermissionRecorder` | `onToolCall` | Tool permission checks (allowed/denied) | Security audit |
| `QualityRecorder` | `onTurnComplete` | Output quality scores from judge function | QA, eval pipeline |

### Export — Send data to external systems

| Recorder | Fires on | Collects | Audience |
|----------|----------|----------|----------|
| `OTelRecorder` | `onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete`, `onError` | OpenTelemetry spans (duck-typed tracer — zero `@opentelemetry` dependency) | Datadog, Grafana, any OTel backend |

```typescript
import { trace } from '@opentelemetry/api';
const otel = new OTelRecorder(trace.getTracer('my-agent'));
agent.recorder(otel).build();
// Spans automatically exported to your OTel collector
```

### Composition — Bundle recorders

| Export | What | Use case |
|--------|------|----------|
| `CompositeRecorder` | Fans out events to multiple child recorders | Custom bundles |
| `agentObservability()` | Preset: Token + Tool + Cost + Explain | One-liner for full observability |

```typescript
const obs = agentObservability();
agent.recorder(obs).build();
await agent.run('Hello');

obs.tokens();   // TokenRecorder stats
obs.tools();    // ToolUsageRecorder stats
obs.cost();     // CostRecorder total
obs.explain();  // ExplainRecorder evaluation data — the differentiator
```

### Agent narrative — UI-shaped run timeline

| Export | What | Use case |
|--------|------|----------|
| `agentTimeline()` | Subscribes to `agentfootprint.stream.*` + `.context.*` emits, folds into the agent-shaped narrative (turns → iterations → tool calls + per-iteration context injections + ledger) | The canonical "what happened in this run" data structure for UIs (Lens, Grafana, custom dashboards, CLI debuggers, replay tools) |

**The abstraction**: parallels footprintjs's `CombinedNarrativeRecorder` — one place every UI / observability tool consumes the agent's run, instead of each UI library re-implementing the translation.

### The v2 architecture — event stream + selectors + humanizer

```
EVENT STREAM              (structured, canonical — single source of truth)
    ↓
SELECTORS                 (typed, memoized, lazy, composable — THE API)
    ↓
VIEWS                     (React / Vue / Angular / CLI / Grafana / replay)
```

No pre-shaped "timeline blob" — every renderer calls the selectors it needs. Lazy memoization makes re-reads free until new events arrive. New view? Add a selector. New domain phrasing? Swap the humanizer.

```typescript
import { Agent, agentTimeline, anthropic } from 'agentfootprint';

const t = agentTimeline();
const agent = Agent.create({ provider: anthropic('claude-sonnet-4-5') })
  .recorder(t)
  .build();

await agent.run('Investigate port errors on switch-3');

// Raw (rare — low-level tooling only)
t.getEvents();              // readonly AgentEvent[] — the canonical stream

// Selectors — the API every renderer uses
t.selectAgent();            // { id, name }
t.selectTurns();            // AgentTurn[] — iterations + tool calls + context
t.selectMessages();         // AgentMessage[]
t.selectTools();            // AgentToolInvocation[]
t.selectSubAgents();        // SubAgentTimeline[] — identity + content per sub-agent
t.selectFinalDecision();    // Record<string, unknown>

// v2 audience-laddered selectors (engineer → analyst → user)
t.selectTopology();         // engineer view: composition graph (nodes + edges)
t.selectCommentary();       // analyst view: human narrative per event
t.selectActivities();       // user view: ThinkKit-style breadcrumb list
t.selectStatus();           // user view: single-line current-status pill

// Aggregates + indexes
t.selectRunSummary();       // totals (tokens, tool counts, skill activations)
t.selectIterationRanges();  // iter ↔ event-index map for scrubbers
```

**Humanizer — pluggable, not baked in**

Events stay pure data. Human-readable strings only appear at selector time, through the humanizer. Swap it for domain-specific phrasings without touching data:

```typescript
t.setHumanizer({
  describeToolStart: (e) => {
    if (e.toolName === 'influx_get_port_status') {
      return `Checking port status on ${e.args.switchName}`;
    }
    return undefined; // fall through to library default ("Running toolName")
  },
});
```

Translation, localization, and UX tone changes are humanizer swaps — no data-model changes.

**Multi-agent**: each sub-agent in a Pipeline / Swarm gets its own named instance. Each lands in its own snapshot slot for separate visualization:

```typescript
const classify = agentTimeline({ id: 'classify' });
const analyze  = agentTimeline({ id: 'analyze'  });
const respond  = agentTimeline({ id: 'respond'  });
```

**Composition discovery is automatic.** `agentTimeline()` composes footprintjs's `TopologyRecorder` internally. `selectSubAgents()` folds per-sub-agent content from emit events tagged with matching `subflowPath`. Works for any composition shape (Pipeline / Parallel / Conditional / Swarm / arbitrary nesting) because composition shape comes from footprintjs's primitive channels — no runner-side declarations.

**One shape, many renderers.** Lens (React), future Vue/Angular consumers, CLI tools, Grafana panels — all import the typed selector surface. The UI is a pure renderer. The recorder owns every derivation.

## Event → Recorder Mapping

| AgentRecorder hook | Who fires it | Which recorders listen |
|--------------------|-------------|----------------------|
| `onTurnStart` | RecorderBridge (before execution) | TurnRecorder, ExplainRecorder, OTelRecorder |
| `onLLMCall` | RecorderBridge (per LLM iteration) | TokenRecorder, CostRecorder, ExplainRecorder, OTelRecorder |
| `onToolCall` | RecorderBridge (per tool execution) | ToolUsageRecorder, ExplainRecorder, GuardrailRecorder, PermissionRecorder, OTelRecorder |
| `onTurnComplete` | RecorderBridge (after execution) | TurnRecorder, ExplainRecorder, QualityRecorder, OTelRecorder |
| `onError` | RecorderBridge (on failure) | OTelRecorder |

## Design Principles

1. **Collect during traversal, never post-process.** Every recorder fires on AgentRecorder hooks during execution. No tree walking after the fact.
2. **Passive observation.** Recorders never change agent behavior. They watch and accumulate.
3. **Connected data shapes.** ExplainRecorder groups data per-iteration so evaluators get context + decisions + sources + claims as a unit, not disconnected flat arrays.
4. **Idempotent by ID.** Same ID replaces, different IDs coexist. `agentObservability()` uses `'agent-observability'` — consumer can override or add a second instance.
5. **All recorders implement `clear()`.** Executor calls `clear()` before each `run()` to prevent cross-run accumulation.

## Narrative (footprintjs, not agentfootprint)

Narrative is a separate system in footprintjs — a FlowRecorder that captures the execution story as human-readable text. It's for **LLM-based debugging**: a follow-up LLM reads the narrative and reasons about what happened.

```typescript
const narrative = executor.getNarrative();
// ["SystemPrompt executed.", "Wrote: systemPrompt", "CallLLM executed.", ...]
// Feed to an LLM: "Here's what the agent did. What went wrong?"
```

Narrative lives in footprintjs because it's a flowchart concern (stage execution order). AgentRecorders live in agentfootprint because they're agent concerns (LLM calls, tool use, evaluation).

## KeyedRecorder<T> — Map-Based Storage

All metric recorders (Token, ToolUsage, Cost) extend `KeyedRecorder<T>` from `footprintjs/trace`. Data is stored as `Map<runtimeStageId, T>` — keyed by the unique execution step identifier.

```typescript
// O(1) lookup by runtimeStageId
const llmCall = tokens.getByKey('call-llm#5');

// All entries as a Map (insertion-ordered)
const map = tokens.getMap();

// Aggregated stats (backward compatible)
const stats = tokens.getStats();
```

Every recorder event carries a mandatory `runtimeStageId` — the universal key that links recorder data to the commit log and execution tree. No fallbacks, no auto-generated keys.
