# Recorders

> **An agent that can't be measured can't be improved.** Recorders are agentfootprint's measurement layer.

Recorders are passive observers that watch agent execution without changing behavior. They collect metrics, track costs, evaluate quality, surface grounding evidence, and enforce guardrails — all during traversal, never as a post-processing step.

Attach recorders to any concept via the `.recorder()` builder method:

```typescript
const tokens = new TokenRecorder();
const agent = Agent.create({ provider })
  .system('Be helpful.')
  .recorder(tokens)   // ← attach during build
  .build();

await agent.run('Hello');
console.log(tokens.getStats());
```

---

## AgentRecorder Interface

All recorders implement the same interface. Every hook is optional — implement only what you need.

```typescript
interface AgentRecorder {
  readonly id: string;
  onTurnStart?(event: TurnStartEvent): void;
  onLLMCall?(event: LLMCallEvent): void;
  onToolCall?(event: ToolCallEvent): void;
  onTurnComplete?(event: TurnCompleteEvent): void;
  onError?(event: AgentErrorEvent): void;
  clear?(): void;
}
```

### Event Types

| Event | When it fires | Key fields |
|-------|--------------|------------|
| `TurnStartEvent` | User message received | `turnNumber`, `message` |
| `LLMCallEvent` | After each LLM invocation | `model`, `usage`, `latencyMs`, `turnNumber`, `loopIteration`, `finishReason` |
| `ToolCallEvent` | After each tool execution | `toolName`, `args`, `result`, `latencyMs` |
| `TurnCompleteEvent` | Agent produces final response | `turnNumber`, `content`, `messageCount`, `totalLoopIterations` |
| `AgentErrorEvent` | Error occurs | `phase` (`prompt`/`llm`/`tool`/`message`), `error`, `turnNumber` |

### Event Ordering

```
1. onTurnStart        — user message received
2. onLLMCall          — each LLM invocation (may repeat in tool loops)
3. onToolCall         — each tool execution (may repeat)
4. onTurnComplete     — agent produces final response
   (or onError        — if something fails)
```

---

## Built-in Recorders

### TokenRecorder

Tracks token usage across all LLM calls.

```typescript
import { TokenRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
agent.recorder(tokens);
await agent.run('Hello');

const stats = tokens.getStats();
// {
//   totalCalls: 2,
//   totalInputTokens: 150,
//   totalOutputTokens: 45,
//   totalLatencyMs: 823,
//   averageLatencyMs: 412,
//   calls: [{ model, inputTokens, outputTokens, latencyMs, turnNumber, loopIteration }]
// }

tokens.getTotalTokens(); // 195 (input + output)
tokens.clear();          // Reset
```

### CostRecorder

Calculates USD cost per model using a configurable pricing table.

```typescript
import { CostRecorder } from 'agentfootprint';

const cost = new CostRecorder({
  pricingTable: {
    'claude-sonnet-4-20250514': { input: 3, output: 15 },   // per 1M tokens
    'gpt-4o': { input: 2.5, output: 10 },
  },
});
agent.recorder(cost);
await agent.run('Hello');

cost.getTotalCost();  // 0.00045 (USD)
cost.getEntries();    // [{ model, inputTokens, outputTokens, inputCost, outputCost, totalCost }]
cost.clear();
```

Models not in the pricing table get $0 cost (no error).

### TurnRecorder

Tracks turn lifecycle: start, complete, or error.

```typescript
import { TurnRecorder } from 'agentfootprint';

const turns = new TurnRecorder();
agent.recorder(turns);
await agent.run('Hello');

turns.getTurns();
// [{ turnNumber: 1, message: 'Hello', content: '...', messageCount: 3, status: 'completed' }]

turns.getCompletedCount(); // 1
turns.getErrorCount();     // 0
turns.clear();
```

### ToolUsageRecorder

Tracks which tools are called, how often, latency, and errors.

```typescript
import { ToolUsageRecorder } from 'agentfootprint';

const toolUsage = new ToolUsageRecorder();
agent.recorder(toolUsage);
await agent.run('Search for AI trends');

const stats = toolUsage.getStats();
// {
//   totalCalls: 3,
//   totalErrors: 0,
//   byTool: {
//     web_search: { calls: 2, errors: 0, totalLatencyMs: 450, averageLatencyMs: 225 },
//     calculator: { calls: 1, errors: 0, totalLatencyMs: 12, averageLatencyMs: 12 },
//   }
// }

toolUsage.getToolNames(); // ['web_search', 'calculator']
toolUsage.clear();
```

### ExplainRecorder

The differentiator: collects **per-iteration grounding evidence** during traversal. Each loop iteration becomes a self-contained evaluation unit — what context the LLM had, what tools it chose to call, what those tools returned, and the LLM's claim. An external evaluator can then verify each claim against its sources without re-running the agent.

```typescript
import { ExplainRecorder } from 'agentfootprint/explain';

const explain = new ExplainRecorder();
const agent = Agent.create({ provider }).tool(lookupOrder).recorder(explain).build();
await agent.run('Check order ORD-1003');

const report = explain.explain();
report.iterations;  // EvalIteration[] — { context, decisions, sources, claim } per loop
report.sources;     // ToolSource[]    — flat: every tool result
report.claims;      // LLMClaim[]      — flat: every LLM response
report.decisions;   // AgentDecision[] — flat: every tool call
report.context;     // LLMContext      — last context snapshot
report.summary;     // string          — human-readable summary
```

Per-iteration shape (the "connected data" the rest of the library is structured around):

```typescript
interface EvalIteration {
  iteration: number;            // 0-based loop index
  runtimeStageId?: string;      // links to commit log + execution tree
  context: LLMContext;          // system prompt, available tools, messages, model
  decisions: AgentDecision[];   // tool calls made this iteration
  sources: ToolSource[];        // tool results returned
  claim: LLMClaim | null;       // LLM response (null on tool-calling iterations)
}
```

**Why this matters:** the connected shape lets a follow-up LLM (or a human reviewer) trace every claim back to the tool result that supports it. Most observability stacks log events; `ExplainRecorder` produces *evidence*. This is what `agentObservability().explain()` returns under the hood.

### QualityRecorder

Evaluates output quality via a custom judge function. The judge runs on each turn completion.

> **LLM-as-judge caveat:** when the judge is itself an LLM, you inherit the well-documented biases of LLM-as-judge evaluation (Zheng et al. 2023 — "LLM as a Judge"): position bias, verbosity bias, self-preference. Validate judge output against a small human-labeled set before trusting averages.

```typescript
import { QualityRecorder } from 'agentfootprint';

const quality = new QualityRecorder((event) => {
  // Simple rule-based judge (could also call an LLM)
  const score = event.content.length > 50 ? 0.9 : 0.3;
  return { score, label: score > 0.5 ? 'good' : 'poor', turnNumber: event.turnNumber };
});
agent.recorder(quality);
await agent.run('Explain quantum computing');

quality.getScores();       // [{ score: 0.9, label: 'good', turnNumber: 1 }]
quality.getAverageScore(); // 0.9
quality.clear();
```

The judge function can be async (for LLM-as-judge patterns). Async judges fire-and-forget to avoid blocking execution.

```typescript
const llmJudge = new QualityRecorder(async (event) => {
  const score = await myJudgeLLM.evaluate(event.content);
  return { score, turnNumber: event.turnNumber };
});
```

### GuardrailRecorder

Checks safety and policy constraints on each turn completion. Returns violations or null.

```typescript
import { GuardrailRecorder } from 'agentfootprint';

const guardrail = new GuardrailRecorder((event) => {
  if (event.content.includes('CONFIDENTIAL')) {
    return {
      rule: 'pii-leak',
      message: 'Output contains confidential data',
      severity: 'error',
      turnNumber: event.turnNumber,
    };
  }
  return null;
});
agent.recorder(guardrail);
await agent.run('Summarize the report');

guardrail.hasViolations();           // true/false
guardrail.getViolations();           // [{ rule, message, severity, turnNumber }]
guardrail.getViolationsByRule('pii-leak');
guardrail.clear();
```

Severity levels: `'info'`, `'warning'`, `'error'`. Defaults to `'warning'`.

### CompositeRecorder

Fans out events to multiple recorders. Error isolation: one recorder failing does not affect others.

```typescript
import {
  CompositeRecorder,
  TokenRecorder,
  CostRecorder,
  TurnRecorder,
  ToolUsageRecorder,
  QualityRecorder,
  GuardrailRecorder,
} from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder();
const turns = new TurnRecorder();
const toolUsage = new ToolUsageRecorder();

const all = new CompositeRecorder([tokens, cost, turns, toolUsage]);

const agent = Agent.create({ provider })
  .system('Be helpful.')
  .recorder(all)     // Single attachment, all 4 recorders receive events
  .build();

await agent.run('Hello');

// Access each recorder's data independently
console.log(tokens.getStats());
console.log(cost.getTotalCost());
console.log(turns.getCompletedCount());
console.log(toolUsage.getStats());

// Access child recorders
all.getRecorders(); // [tokens, cost, turns, toolUsage]
all.clear();        // Clears all children
```

---

## Summary Table

| Recorder | Hooks Used | Key Methods |
|----------|-----------|-------------|
| `TokenRecorder` | `onLLMCall` | `getStats()`, `getTotalTokens()`, `clear()` |
| `CostRecorder` | `onLLMCall` | `getTotalCost()`, `getEntries()`, `clear()` |
| `TurnRecorder` | `onTurnStart`, `onTurnComplete`, `onError` | `getTurns()`, `getCompletedCount()`, `getErrorCount()`, `clear()` |
| `ToolUsageRecorder` | `onToolCall` | `getStats()`, `getToolNames()`, `clear()` |
| `ExplainRecorder` | `onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete` | `explain()` → `{ iterations, sources, claims, decisions, context, summary }` |
| `QualityRecorder` | `onTurnComplete` | `getScores()`, `getAverageScore()`, `clear()` |
| `GuardrailRecorder` | `onTurnComplete` | `getViolations()`, `hasViolations()`, `getViolationsByRule()`, `clear()` |
| `PermissionRecorder` | `onToolCall` + `onBlocked` (wired via `gatedTools`) | `getSummary()`, `getBlocked()`, `getDenied()`, `getAllowed()` — see [security.md](security.md) |
| `CompositeRecorder` | All (fans out) | `getRecorders()`, `clear()` |
| `agentObservability()` | All — bundles Token + Cost + Tool + Explain | `.tokens()`, `.tools()`, `.cost()`, `.explain()` |

> **Recorder ID & idempotency:** `attachRecorder` is idempotent by `id` — attaching a recorder with the same id replaces the previous one. Different ids coexist. Built-ins use auto-incremented defaults (`metrics-1`, `cost-1`, ...) so multiple instances don't accidentally collide. If a framework auto-attaches a recorder, override it by attaching your own with the same id.

---

## Custom Recorder

Implement only the hooks you need:

```typescript
import type { AgentRecorder, LLMCallEvent, TurnCompleteEvent } from 'agentfootprint';

class AuditRecorder implements AgentRecorder {
  readonly id = 'audit';
  private log: string[] = [];

  onLLMCall(event: LLMCallEvent): void {
    this.log.push(`LLM call to ${event.model}: ${event.usage?.inputTokens}in/${event.usage?.outputTokens}out`);
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    this.log.push(`Turn ${event.turnNumber} complete: ${event.content.slice(0, 50)}...`);
  }

  getLog(): string[] {
    return [...this.log];
  }

  clear(): void {
    this.log = [];
  }
}
```
