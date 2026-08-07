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
  events: recorded.events,                                     // optional: tool-call timings
});

// Mount on a (cheap) debugging agent…
const debugAgent = Agent.create({ provider: cheapModel }).tool(...tools).build();
// …or drive scripted / offline (the auditor pattern):
const overview = await callTraceTool(tools, 'run_overview');
```

## The tools

| Tool | Question it answers |
|------|---------------------|
| `run_overview()` | What happened, broadly? Stage list (id + name + description), loops, where errors appeared, honesty notes, and what the run cost. **The entry point.** |
| `find_in_trace(query, maxHits?)` | **Where does "…" appear in this run?** Free text → step ids and keys. The bridge from the user's words to something the other tools can take. |
| `trace_node(runtimeStageId)` | What did step X write (bounded previews + true sizes), read, and where did its inputs come from (parents, with the routing decision's rule label)? |
| `trace_slice(runtimeStageId, key?, maxDepth?, maxNodes?)` | Which chain of steps produced the data at X? Backward read→write slice with `[control: rule]` edges, as an indented tree of drillable ids. |
| `backtrack(variable, element?, before?)` | Why is VARIABLE K what it is? Variable-first — no step id needed. `element` names which step produced `K[i]`. |
| `who_wrote(key, beforeStageId?)` | Which step last wrote key K (optionally before step Y)? |
| `get_value(runtimeStageId, key, maxChars?)` | The full value of K as of step X — the explicit on-demand fetch, capped + truncation-marked. |
| `inspect_tool_call(toolCallId)` | **One tool call, end to end**: which tool, the args the model *proposed*, the args it actually *ran with*, the result, the outcome, the duration, the step that ran it. |
| `read_narrative(offset?, maxLines?)` | The human-readable story, paginated (only when `narrative` was provided). |

### `find_in_trace` — the first move when you have words, not ids

Every other tool needs a name you already have. A question arrives in the user's
words ("why did you say order 7712 was out of warranty?"), and the model's only
options used to be guessing a state key or reading the whole narrative. This
searches stage names and descriptions, state keys, every committed value and the
narrative — and hands back **pointers**, each line ending with the exact call
that opens it:

```
FOUND 3 match(es) for '7712' in 12 stage(s), 36 state key(s), 40 committed step(s) …
- tool-calls#22 wrote 'history' (append): …"content":"Order 7712: sku KB-88…  → get_value('tool-calls#22', 'history')
- narrative line 41: … wrote lastToolResult …                                  → read_narrative({ offset: 41 })
```

It serves a bounded **window** around each match, never the value. A miss names
what never enters the record at all — run input, env, pre-run state, closures,
and anything redaction removed — so "not found" cannot be misread as "did not
happen".

### `inspect_tool_call` — the four records, joined

A tool call is the most-asked-about thing in an agent run and the most scattered.
The args the model proposed live on an assistant turn; the args it **actually ran
with** live in the middleware ledger (and only when a rule changed them); the
result is a `role:'tool'` turn; the timing exists only in the event stream. One id,
four lookups — so the tool does the join:

```
TOOL CALL c2 — check_inventory
step: tool-calls#22 — drill with trace_node('tool-calls#22')
proposed by the model: {"sku":"KB-88"}
ran with: {"sku":"KB-88","limit":5} — CHANGED at before-tool by 'clamp-limit': "page size capped at 5"
result: "Stock for KB-88: 12 units available…"
outcome: ok
duration: 4ms
```

The proposed/ran-with split is the reason it exists: a governance rule that
rewrites args is **invisible in the conversation** — the model reads its own
proposal in history and the tool ran on something else. Timings need
`artifacts.events`; without them the line reads `duration: ⚠ unavailable` and
explains that the commit log has no clock, rather than inventing a number.

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
- **The captured turn carries three things**, not one: the snapshot, the
  narrative, and a bounded tail of the run's typed events. The last two are what
  `read_narrative` and `inspect_tool_call`'s timings read, and both default ON.
- **`delegate` switches the model at that point:** the skill unlocks a single
  `explain_run` tool whose investigation runs on a nested `traceDebugAgent`
  at the delegate's (cheaper) price; the main conversation pays one tool call.

```ts
.selfExplain({
  include: { narrative: true, events: true },  // both default true
  maxEvents: 2000,                             // per-turn tail cap
})
```

Turn one off when the cost matters more than the answer — a very long turn, or a
narrative that only repeats what the structured tools already say. `events: false`
makes **no** wildcard subscription at all rather than a subscription that is
ignored, and the tools that read the missing part say which switch turns it back
on instead of answering emptily.

A working end-to-end demo is
[examples/features/49-self-explain-live.ts](../../examples/features/49-self-explain-live.ts):
an order-support agent skips a refund in turn 1, then justifies the skip in turn 2
through visible `find_in_trace` → `inspect_tool_call` → `run_overview` calls. It
prints per-tool execution counters either side of the explanation to prove nothing
re-ran, and runs on a scripted mock by default (set `ANTHROPIC_API_KEY` for a live
small model; `DEMO_MODEL` picks it).

When the main agent already carries many domain tools, prefer `delegate` (or
route why-questions to a dedicated `traceDebugAgent` with a `Conditional`) —
it keeps the production catalog at exactly one extra tool and the trace WALK
out of the production context (only the bounded, evidence-cited answer
returns as a tool result — treat it as data like any other).

Two boundary notes, honestly: a turn that PAUSES (human-in-the-loop) has not
completed — during the pause, "previous completed run" remains the older one;
and after a resume, the explainable run covers the post-resume portion only
(footprintjs Convention-4: control chains don't survive a pause/resume).
Tool names `run_overview` · `find_in_trace` · `trace_node` · `trace_slice` ·
`backtrack` · `who_wrote` · `get_value` · `inspect_tool_call` ·
`read_narrative` (inline) and `explain_run` (delegate) are reserved at build
time; a composed ToolProvider emitting those names would win the slot's
first-occurrence dedup and shadow the trace tools — don't. The reservation is
read from the pack itself (`TRACE_TOOL_NAMES`), so it cannot fall behind it.

Nine tool definitions land on the tools slot for the one activated iteration.
That is a real bulge past the 2000-char `contextBudget.tools` default — which is
a **signal, not a limiter** (nothing is ever truncated). An agent that opted into
`.selfExplain()` should raise it: `contextBudget: { tools: 6000 }`.

## Reopening a saved run — `openRecording`

`recordRun(agent)` freezes a run into `{ snapshot, events, structure }`, the shape
the viewers read. The toolpack reads a different shape. `openRecording` is the
adapter between them, so last Tuesday's run on disk is as navigable as this one:

```ts
import { recordRun } from 'agentfootprint/observe';
import { openRecording, traceToolpack, callTraceTool } from 'agentfootprint/observe';

// …when the run happens
const recorder = recordRun(agent);
await agent.run({ message });
fs.writeFileSync('run.json', JSON.stringify(recorder.toRecording()));

// …any time later, in any process
const tools = traceToolpack(openRecording(JSON.parse(fs.readFileSync('run.json', 'utf8'))));
console.log(await callTraceTool(tools, 'find_in_trace', { query: 'order 7712' }));
```

It is pure — no engine, no agent, no I/O — and honest about the two things a
serialized run cannot carry back:

- **`controlDeps` does not survive.** It is a lookup *function* built by a recorder
  that watched the run happen, and nothing in a finished recording can rebuild one.
  Slices opened over a recording therefore carry the existing
  `⚠ control edges unavailable` marker.
- **The narrative survives only if it was attached.** `recordRun` deliberately
  attaches no narrative recorder, so add `agent.attach(narrative())` at record time
  if you want `read_narrative` later. `openRecording` lifts it from the snapshot's
  recorder rows when it is there, identified by shape rather than by id.

Two teaching refusals, both naming `recordRun` as the producer: a bundle with no
snapshot, and a snapshot missing `commitLog` or `executionTree` (usually a
hand-assembled bundle, a UI view model, or an older format).

### The tool boundary, named honestly

`trace_node` on the agent's tool-execution step now carries an explicit marker:
the trace records what went INTO a tool and what came BACK; what happened
inside the consumer's system is not traced — unless the tool returns its own
diagnostic refs (a request id, a log link), which flow through the trace like
any other result data.
