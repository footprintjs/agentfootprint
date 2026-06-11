# Trace Debugging — the Introspection Toolpack

> RFC-003 Part C. footprintjs trace evidence exposed as **tools an LLM calls** — a debugging
> model navigates a completed run's evidence by step ids instead of reading dumps.

## The idea

Every agentfootprint/footprintjs run already produces a complete evidence trail: the commit log
(what every step wrote, with verbs and honesty markers), the execution tree (what each step is,
what it read), decision evidence from `decide()`, and the narrative. Feeding all of it to a model
is expensive and mostly wasted — a debugger doesn't read the whole core dump, it **navigates**.

`traceToolpack(artifacts)` turns the evidence into 5–6 tools, id-addressed like a debugger:

```typescript
import { FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { traceToolpack, callTraceTool } from 'agentfootprint/observe';

// 1. The production run (any chart or agent) — collect artifacts once.
const executor = new FlowChartExecutor(chart);
const ctrl = controlDepRecorder();
executor.attachCombinedRecorder(ctrl);
executor.enableNarrative();
await executor.run({ input });

// 2. A SEPARATE debugging session over the COMPLETED run.
const tools = traceToolpack({
  snapshot: executor.getSnapshot(),
  controlDeps: ctrl.asLookup(),                                // optional: decision edges
  narrative: executor.getNarrativeEntries().map((e) => e.text), // optional: adds read_narrative
});

// Mount on a (cheap) debugging agent…
const debugAgent = Agent.create({ provider: cheapModel }).tool(...tools).build();
// …or drive scripted / offline (the auditor pattern):
const overview = await callTraceTool(tools, 'run_overview');
```

## The tools

| Tool | Question it answers |
|------|---------------------|
| `run_overview()` | What happened, broadly? Stage list (id + name + description), loops, where errors appeared, honesty notes. **The entry point.** |
| `trace_node(runtimeStageId)` | What did step X write (bounded previews + true sizes), read, and where did its inputs come from (parents, with the routing decision's rule label)? |
| `trace_slice(runtimeStageId, key?, maxDepth?, maxNodes?)` | Which chain of steps produced the data at X? Backward read→write slice with `[control: rule]` edges, as an indented tree of drillable ids. |
| `who_wrote(key, beforeStageId?)` | Which step last wrote key K (optionally before step Y)? |
| `get_value(runtimeStageId, key, maxChars?)` | The full value of K as of step X — the explicit on-demand fetch, capped + truncation-marked. |
| `read_narrative(offset?, maxLines?)` | The human-readable story, paginated (only when `narrative` was provided). |

Step ids are `runtimeStageId`s (`stageId#executionIndex`, e.g. `normalize#1`) — the universal
key linking the commit log, the execution tree, and recorder events. The `#index` is **global
across the run**, not per-stage.

## The contracts

- **Bounded by default.** Previews are capped; slices have depth/node budgets; values have char
  budgets. Per-call params raise budgets only up to hard caps (`TOOLPACK_HARD_CAPS`) the model
  cannot exceed.
- **Honest, never silent.** Truncated slices say `⚠ slice truncated`; steps that consumed
  untracked inputs (`$getArgs()`/`$getEnv()`/silent reads) say `⚠ slice may be incomplete here`;
  missing read tracking or a missing `controlDeps` lookup is stated, not omitted; values the
  commit log cannot see (pre-run state, closure-smuggled values) are named as such.
- **Redaction-respecting.** footprintjs scrubs the commit log at commit time
  (`setRedactionPolicy`); the toolpack passes placeholders through verbatim, flags redacted keys
  (`(redacted by policy)`), and never reconstructs around a redaction.
- **Strict schemas (#9).** On small runs the id parameter carries an `enum` of every real step
  id — Agent dispatch rejects garbage args before execution and the model self-corrects. Key
  parameters deliberately have **no** enum: asking about a key outside the commit log has an
  honest answer, not a validation error. Bad ids that get through return corrective messages
  naming the real executions.

## Security posture (read this)

Trace content can carry **adversarial text from the original run** — tool results, retrieved
documents, user input all flow through state and would be served back (bounded) by these tools.
Re-exposing trace content to an LLM re-exposes prompt injection (see the
[Prompt Injection guide](prompt-injection.md)):

- Run the debugger as a **separate session over a completed run** (the offline auditor pattern) —
  not as tools mounted on the production agent mid-run (recursion + injection risks).
- Treat tool outputs as **data, not instructions**; the bounded views limit blast radius but do
  not sanitize semantics.
- The toolpack never re-runs anything and holds no credentials — it is a read-only view over
  frozen artifacts.

## Token economics

The demo ([examples/observability/01-trace-debug-session.ts](../../examples/observability/01-trace-debug-session.ts))
plants a wrong value (DTI computed against annual income) that flows through a `decide()`
decision; a scripted debugger session finds the culprit in 8 tool calls, serving **~2.7K chars
vs a ~29K-char full dump (~9%)** — and the gap widens with run size, because the session cost
scales with what the model *opens*, not with what the run *produced*.

## The conversational doors — ask the trace instead of reading it

Two packaged ways to put a model on the other side of the toolpack
(`examples/observability/07` and `08` run both offline):

### `traceDebugAgent` — the dedicated debugger

One call returns a ready Agent: toolpack mounted, the proven methodology
(overview → drill by id → cite evidence → respect ⚠) as its system prompt.
A separate session over a completed run — the security posture above, packaged.

```ts
import { traceDebugAgent } from 'agentfootprint/observe';

const debuggerAi = traceDebugAgent({
  artifacts: { snapshot: agent.getLastSnapshot()!, controlDeps: ctrl.asLookup() },
  provider: anthropic(),
  model: 'claude-haiku-4-5',   // cheap model, expensive run — that's the point
});
await debuggerAi.run({ message: 'Why was loan APP-7 approved?' });
```

### `.selfExplain()` — why-questions inside the main conversation

Most why-questions are follow-ups. One builder call lets the main agent answer
them from its own previous completed run:

```ts
Agent.create({ provider, model })
  .system('You are a refunds assistant.')
  .tool(lookupOrder)
  .selfExplain()   // optional: { instruction, delegate: { provider, model } }
  .build();
```

- **One skill is mounted.** Day to day the catalog carries only the activation
  row; the iteration after the LLM activates it, the catalog gains the trace
  tools — delivered via a `skillScopedTools` provider composed with yours, so
  your production tool list is never touched.
- **Evidence binds late, and only to COMPLETED runs.** Capture happens at each
  run's terminal flush, so the tools can never see the in-flight turn. A failed
  run still captures — "why did you fail?" works.
- **`delegate` switches the model at that point:** the skill unlocks a single
  `explain_run` tool whose investigation runs on a nested `traceDebugAgent`
  at the delegate's (cheaper) price; the main conversation pays one tool call.

When the main agent already carries many domain tools, prefer `delegate` (or
route why-questions to a dedicated `traceDebugAgent` with a `Conditional`) —
it keeps the production catalog at exactly one extra tool and the trace WALK
out of the production context (only the bounded, evidence-cited answer
returns as a tool result — treat it as data like any other).

Two boundary notes, honestly: a turn that PAUSES (human-in-the-loop) has not
completed — during the pause, "previous completed run" remains the older one;
and after a resume, the explainable run covers the post-resume portion only
(footprintjs Convention-4: control chains don't survive a pause/resume).
Tool names `run_overview` · `trace_node` · `trace_slice` · `who_wrote` ·
`get_value` (inline) and `explain_run` (delegate) are reserved at build time;
a composed ToolProvider emitting those names would win the slot's
first-occurrence dedup and shadow the trace tools — don't.

### The tool boundary, named honestly

`trace_node` on the agent's tool-execution step now carries an explicit marker:
the trace records what went INTO a tool and what came BACK; what happened
inside the consumer's system is not traced — unless the tool returns its own
diagnostic refs (a request id, a log link), which flow through the trace like
any other result data.
