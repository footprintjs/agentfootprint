# Design: Local Observability, Offline Replay & the PII model

> **Status:** design spec (converged). Nothing here is built yet except items explicitly
> marked **(today)**. This doc locks the *names and the boundaries* before any code, so the
> implementation has one reference.

## 1. The load-bearing distinction — Harness vs Observability

Every primitive in this area answers exactly one question, and that question decides where it
lives:

> **Does it change what the agent DOES, or only what we RECORD?**

- **Changes execution → Agent harness (data-flow).** It runs *inside* the agent loop; the LLM,
  shared state, memory, and output all see its effect. Docs home: **Build**.
- **Only changes what's recorded → Observability.** It reads a *mirror* of the run; execution is
  untouched. Docs home: **Debug** (local inspection) or **Monitor** (production export).

This is the rule that keeps `RedactionPolicy` (observability) and `anonymizeInput` (harness)
from being confused — they share the folk word "redact" but sit on opposite sides of the line.

| Primitive | Changes execution? | Bucket | Docs |
|---|---|---|---|
| `anonymizeInput` (+ later `deanonymizeOutput`) | **yes** — LLM sees the masked value | Harness | **Build** |
| `RedactionPolicy` | no — observer mirror only | Observability | **Monitor** |
| `localObservability` / `getTrace` / `<Replay>` | no — local inspection | Observability | **Debug** |
| `enable.observability({ strategy })` (OTEL/AgentCore/…) | no — ships a copy out | Observability | **Monitor** |

## 2. The four layers (mechanism, recap)

One typed event stream per run; everything below consumes it.

```
agent.run()
  └─ Layer 1  Substrate (footprint.js)   raw channels fire DURING the single DFS pass
  └─ Layer 2  Typed events               runner.on('agentfootprint.<domain>.<event>')  (65 events / 18 domains)
  └─ Layer 3  Retain (LOCAL / Debug)     recorders fold events → StepGraph/RunTree   ← Lens, Replay
  └─ Layer 4  Forget (EXPORT / Monitor)  strategies → vendor wire, ship & forget       ← OTEL, AgentCore
```

`anonymizeInput` is **not** on this diagram — it lives in the **execution path** (a stage), one
layer *before* any of this. That's precisely why it's harness, not observability.

## 3. Two observability doors (today + proposed)

Both subscribe to the same Layer-2 stream; they differ by **retain vs forget**.

```ts
// EXPORT — Layer 4, ship & forget  (today)
agent.enable.observability({
  strategy: otelObservability({ endpoint }),       // or agentcore/cloudwatch/xray
  detach:   { driver: microtaskBatchDriver, mode: 'forget' },
});

// LOCAL — Layer 3, retain & render  (PROPOSED: localObservability)
const dev = agent.enable.localObservability();      // retains StepGraph/RunTree, keeps content
await agent.run({ message });
<Lens recorder={dev} />;                             // (a) live
const trace = dev.getTrace({ redact });             // (b) JSON-lossless Trace → offline
<Replay trace={trace} />;                            //     rehydrate, no re-run
```

Mental model: **`localObservability` = look at this run. `observability` = send this run away.**

## 4. The PII model — two redactions, named per ecosystem convention

Web survey (high confidence): in **observability** tools a "redaction policy" scrubs **logs/traces
only — the LLM still sees raw** (OTEL, Langfuse, Datadog, Phoenix, Vercel AI SDK, LangSmith). The
word "redact" is *overloaded* (security libs reuse it for data-flow masking), so the reliable
disambiguator is the **verb family**: telemetry says *record/capture/mask*; security says
*anonymize/deanonymize/guardrail*.

Therefore we name by side of the harness/observability line:

| Concern | Name | Touches | Convention anchor |
|---|---|---|---|
| Don't **log** PII | **`RedactionPolicy`** (keep) | observer mirror / trace / `getTrace({ redact })` | OTEL, Langfuse, Datadog |
| Don't let the **LLM see** PII | **`anonymizeInput`** (+ later `deanonymizeOutput`) | the prompt at entry | LLM Guard Anonymize/Deanonymize, LangChain PresidioReversibleAnonymizer |

**Rules that fall out:**

1. **`RedactionPolicy` is correctly named and stays** — it matches the observability-domain
   convention. **Doc fix:** state explicitly *"trace/observer redaction — does NOT change what the
   LLM sees."* Kills the only ambiguity.
2. **The entry feature is NOT `redactInput`** (inherits the overload, collides with
   `RedactionPolicy`). It is **`anonymizeInput`** — least-overloaded, pairs with a future
   `deanonymizeOutput`, plain-name compliant.
3. Reserve **"guardrail"** for *non-PII* input gating (block / jailbreak / toxicity).

### Redaction is bound to the trust boundary

`RedactionPolicy` redacts a **mirror** (engine keeps `redactedSharedMemory`; recorders read it, the
LLM uses the real data). A *local* trace is safe in-process but **serializing it is a boundary
crossing** (bug report, docs, a teammate). So trace redaction is enforced at **`getTrace()`**, and
the `Trace` is **self-describing**:

```ts
dev.getTrace({ redact: scrub });             // function — write-once, arbitrary logic
dev.getTrace({ redact: { keys: ['ssn'] } }); // declarative RedactionPolicy
dev.getTrace();                              // inherits setRedactionPolicy() if set, else raw
// trace.redaction → 'none' | 'pii' | 'policy'   (a <Replay> UI can warn on 'none')
```

## 5. API surface

**Real today** — `enable.observability({ strategy, detach })`
([RunnerBase.ts:489](../../src/core/RunnerBase.ts)), `otelObservability` / `agentcoreObservability`
/ `cloudwatchObservability` / `xrayObservability` / `consoleObservability`,
`enable.flowchart({ onUpdate })` → `FlowchartHandle`
([FlowchartRecorder.ts:179-185](../../src/recorders/observability/FlowchartRecorder.ts)),
`redactThinkingBlocks` (security), `LensRecorder` + `<Lens>`.

> **Redaction policy lives one layer down.** `RedactionPolicy` / `setRedactionPolicy` and the
> fluent `.redact(policy)` are **footprint.js** surfaces (`RunnableChart`/`FlowChartExecutor`), and
> `redactPatch` is `footprintjs/advanced`. The agentfootprint **agent does not surface a redaction
> setter today** — verified, `.redact(` appears nowhere in `agentfootprint/src`. So "set a trace
> redaction policy on an agent" is itself a small **gap**: either thread it through `Agent.create`
> or document the executor-level path. Track alongside `getTrace({ redact })`.

**Proposed (the build)** —

| Symbol | Layer / bucket | Notes |
|---|---|---|
| `agent.enable.localObservability()` → handle | L3 / Debug | wraps `enable.flowchart` + serializer; keeps content in-process |
| `handle.getTrace({ redact? })` → `Trace` | L3 / Debug | JSON-lossless; redact at the serialize boundary; `trace.redaction` flag |
| `toFlowchart(trace)` | render | pure `Trace` → render data; no live runner |
| `<Replay trace={…} />` | render | rehydrate + render; works for live/captured/3rd-party traces |
| `anonymizeInput` (+ `deanonymizeOutput`) | harness / **Build** | data-flow PII masking at entry; **separate from this feature** |
| `applyRedaction(value, policy)` (optional) | shared primitive | pure export of the engine's existing applier, so one `RedactionPolicy` works imperatively (in a stage) and declaratively |

## 6. Open decisions

1. **`Trace` content policy** — default `getTrace()`: redaction-`inherit` (prod-safe) vs raw. Lean:
   inherit (opt *into* raw via `redact:'none'`, never out of safety).
2. **Where `anonymizeInput` lands** — core `Agent.create({ anonymizeInput })` vs the `security`
   barrel. (Out of scope for the localObservability build; tracked here so the boundary is named.)
3. **`applyRedaction` export** — ship the pure applier now, or only when `anonymizeInput` needs it.
4. **`localObservability` shape** — own verb (recommended) vs `enable.observability({ strategy:
   lensCapture })` for door-uniformity. Lean: own verb (it *retains*; it isn't a ship-and-forget
   strategy).

## 7. Build order

1. **Serializer** — `StepGraph`/`RunTree` → JSON-lossless `Trace` (+ `trace.redaction`). Load-bearing.
2. `getTrace({ redact })` on the Layer-3 handle.
3. `localObservability()` verb (thin wrapper over `enable.flowchart` + serializer).
4. `toFlowchart(trace)` + `<Replay trace>` in `agentfootprint-lens`.
5. Docs: Debug page (localObservability/Replay) + Monitor `RedactionPolicy` "trace-only" note.
6. (separate track) `anonymizeInput` — Build / harness.
