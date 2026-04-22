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

```typescript
import { Agent, agentTimeline, anthropic } from 'agentfootprint';

const t = agentTimeline();
const agent = Agent.create({ provider: anthropic('claude-sonnet-4-5') })
  .recorder(t)
  .build();

await agent.run('Investigate port errors on switch-3');

const timeline = t.getTimeline();
timeline.turns;                    // AgentTurn[] — one per .run() call
timeline.turns[0].iterations;      // AgentIteration[] — one per LLM call
timeline.turns[0].iterations[0].toolCalls;  // tool invocations + results
timeline.turns[0].contextInjections;        // RAG / Skill / Memory / Instructions tags
timeline.turns[0].contextLedger;            // folded counter delta
                                            // { systemPromptChars: 1200, system: 1, ... }

// SequenceRecorder primitives (inherited from footprintjs/trace):
t.getEntries();         // raw TimelineEntry[] in emit order
t.getEntryRanges();     // O(1) per-step range index — for time-travel sliders
t.aggregate(...);       // reduce all entries
```

**Multi-agent**: each sub-agent in a Pipeline / Swarm gets its own named instance. Each lands in its own snapshot slot for separate visualization:

```typescript
const classify = agentTimeline({ id: 'classify' });
const analyze  = agentTimeline({ id: 'analyze'  });
const respond  = agentTimeline({ id: 'respond'  });
```

**Why a separate library?** Same pattern as `contextEngineering()` — agentfootprint owns the contract and the translation, UI libraries (`agentfootprint-lens`, `agentfootprint-grafana`, custom dashboards) own the rendering. One translation, many UIs.

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
