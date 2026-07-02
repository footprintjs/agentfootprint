---
paths:
  - src/core/pause.ts
  - src/core/runCheckpoint.ts
  - src/core/Agent.ts
  - src/core/RunnerBase.ts
  - src/core/runner.ts
  - src/core/agent/stages/toolCalls.ts
  - src/core/agent/stages/seed.ts
  - src/core/agent/stages/prepareFinal.ts
  - src/core/agent/stages/reliabilityExecution.ts
  - src/core/agent/stages/callLLM.ts
  - src/core/agent/buildAgentChart.ts
  - src/core/agent/buildDynamicAgentChart.ts
  - src/core/slots/**
  - src/reliability/**
  - src/resilience/withRetry.ts
  - src/identity/withCredentialRetry.ts
  - src/lib/context-bisect/**
  - src/lib/trace-toolpack/**
  - src/observability/contextError/finders/**
  - src/lib/influence-core/**
---
<!-- analyzed-at: 5a5b7cb @ 2026-07-02 | model: fable-5 -->
# Backtracking in agentfootprint — 6 mechanisms

The per-stage transaction commit and `FlowchartCheckpoint` machinery live UPSTREAM in footprintjs. `src/memory/causal/writeSnapshot.ts`/`loadSnapshot.ts` are cross-session memory persistence, NOT backtracking. **Two disjoint checkpoint types with similar names:** `FlowchartCheckpoint` (M1, footprintjs, full scope) vs `AgentRunCheckpoint` (M2, history-only) — `agent.resume()` vs `agent.resumeOnError()`; never cross-wire them.

## M1 — Pause/Resume (human-in-the-loop, intentional)
Files: `core/pause.ts` (`PauseRequest` :47-56, `pauseHere` :71-73, `askHuman` :100) · `stages/toolCalls.ts:352-366` (catch → commit partial → RETURN payload = footprintjs pause; resume handler :485-524) · `RunnerBase.ts:294-312` `detectPause` · `Agent.ts:754-767` `resume()` (fresh executor → executor.resume).

Trace: tool calls `askHuman({question})` → PauseRequest thrown from tool.execute → caught at toolCalls.ts:352 → `scope.history`, `pausedToolCallId/Name/StartMs` committed (:354-357) → returns a defined object → footprintjs pause + FlowchartCheckpoint → detectPause → `{paused, checkpoint, pauseData}`. Later `agent.resume(checkpoint, answer)` → fresh executor seeds from checkpoint → resume handler appends answer as the paused tool's result, iteration++, clears pausedTool* (:521-523) → loop continues.

| Step | SAVED | RESTORED | DISCARDED |
|---|---|---|---|
| PauseRequest caught | history + pausedTool* committed to scope BEFORE the pause return | — | remaining parallel tool calls this turn |
| checkpoint (footprintjs) | JSON FlowchartCheckpoint (sharedState, subflowStates, pausedStageId, pauseData) | — | recorder/narrative state (never captured) |
| agent.resume() | — | full scope incl. history + paused fields | old executor; fresh runId; cross-executor narrative empty |
| resume handler | new history (answer as tool result) | — | pausedTool* zeroed |

Invariant: everything the resume handler needs must be IN SCOPE at pause time — scope is the only carrier across the checkpoint.
Breaks when: a tool holds progress in a closure/module variable (or a DetachHandle in scope — structuredClone drops its prototype) then pauses → cross-executor resume restores scope but not the closure. Also `runTyped()` + pause throws by design (Agent.ts:597-601).

```
execute(scope):
  try: result = tool.execute(args)
  catch PauseRequest e:
    scope.history = newHistory; scope.pausedTool* = tc.id/name/t0   # commit BEFORE pausing
    return {toolCallId, toolName, ...e.data}                         # defined return ⇒ pause
resume(scope, humanInput):
  scope.history += toolResult(humanInput, scope.pausedToolCallId)
  scope.iteration += 1; scope.pausedTool* = cleared
```

## M2 — Error-checkpoint replay (`resumeOnError`, history-only memento)
Files: `core/runCheckpoint.ts` (`AgentRunCheckpoint` :69-97, `RunCheckpointError` :123-145, tracker :156-166, `buildCheckpoint` :174-194, `validateCheckpoint` :204-230) · `Agent.ts` (tracker install :616-622, catch-and-wrap :638-661, `resumeOnError` :711-720, `installCheckpointTracker` :729-752, `pendingResumeHistory` side channel :254-257) · `stages/seed.ts:42` `consumePendingResumeHistory` (read-AND-clear), restore :67-72. Source events: toolCalls.ts:471-481 (execute path) + toolCalls.ts:512-518 (resume path) emit `iteration_end` with PLAIN detached history; prepareFinal.ts:43 emits `iteration_end` WITHOUT a history field — it only advances lastCompletedIteration (the tracker keeps the last toolCalls-provided history, guard Agent.ts:739-747).

Trace (provider 500s at iteration 3): iterations 1-2 emit iteration_end → tracker snapshots history + lastCompletedIteration → iter 3 throws → catch: not PauseSignal/PolicyHalt/ReliabilityFailFast AND tracker.history nonempty → `throw RunCheckpointError(cause, buildCheckpoint(...))`. Consumer persists `err.checkpoint`; `agent.resumeOnError(cp)` → validate → `pendingResumeHistory = cp.history` → re-`run(cp.originalInput.message)` → seed consumes the side channel and sets `scope.history = [...resumeHistory]` → model re-decides from restored history.

| Step | SAVED | RESTORED | DISCARDED |
|---|---|---|---|
| each iteration_end | history[] + lastCompletedIteration into tracker | — | previous tracker snapshot |
| error caught | checkpoint: runId, history, lastCompletedIteration, originalInput, failurePoint | — | mid-iteration partial state |
| resumeOnError | — | ONLY conversation history + original message | iteration counter (re-seeds 1), token/cost accumulators, runId, recorder state, failed iteration's tool side effects |

Invariant: iteration boundaries are atomic — iteration_end's history fully encodes progress, so REPLAY ≡ continue. Explicitly NOT exact-state restore (Agent.ts:678-695).
Breaks when: a non-idempotent tool (payment, send-email) ran inside the FAILED iteration — resume re-issues it and it executes AGAIN (no toolCallId dedup, runCheckpoint.ts:37-49). Also interleaving resumeOnError with a concurrent run() — pendingResumeHistory is one instance field, consumed by whichever seed runs first.

```
run(input):
  on 'iteration_end'(e): tracker.history = e.history; tracker.last = e.iterIndex
  try: return executor.run(input)
  catch cause:
    if recoverable && tracker.history.length: throw RunCheckpointError(cause, buildCheckpoint(tracker))
resumeOnError(cp):
  pendingResumeHistory = validateCheckpoint(cp).history
  return run({message: cp.originalInput.message})   # seed: history = pendingResumeHistory ?? [userMsg]
```

## M3 — Inline reliability retry (retry inside ONE stage)
Files: `stages/reliabilityExecution.ts:130-559` `executeWithReliability` (MAX_LOOP=50 :292; closure-local attempt/providerIdx/breakerStates :158-168; retry :453-482, retry-other :484-516, fallback :518-547, fail-fast :203-241; first-chunk arbitration :419-425; `applyFeedback` :577-597) · call site `stages/callLLM.ts:269-284` (returns undefined = fail-fast took $break) · `reliability/CircuitBreaker.ts`, `classifyError.ts`.

| Step | SAVED | RESTORED | DISCARDED |
|---|---|---|---|
| each failed attempt | closure-only: lastError/kind, breaker counters, validationErrorHistory | — | failed response |
| retry w/ feedbackForLLM | mutableRequest += ephemeral user message (append-only; never scope.history) | — | — |
| success | response → normal scope commit in callLLM | — | all retry bookkeeping (closure dies with the stage) |
| fail-fast | scope.reliabilityFail* + `$break(reason)` (:217-239) | — | — |

Invariant: retry state stays CLOSURE-LOCAL, never scope — commits across the ReAct loop must not include attempt counters (:35-43). The trace shows one stage that "internally retried N times".
Breaks when: **`retry-other` never actually switches providers** — callFn closes over the default provider; providerIdx only feeds telemetry/breaker keys (documented bug :503-511). A failover list + retry-other rule silently re-calls the same provider. Also any mid-stream failure after the first chunk escalates retry→fail-fast (:419-425).

```
loop up to 50:
  if breaker rejects: errorKind='circuit-open' else try callFn(mutableRequest) catch → classify; attempt++
  branch = evalRules(postDecide) or default
  if firstChunkSeen && branch not in {ok,fail-fast}: fail-fast('mid-stream-not-retryable')
  ok→return | retry→maybe append ephemeral feedback; continue | retry-other→providerIdx++ (telemetry-only!) 
  fallback→fallbackFn(request, err) | fail-fast→scope.reliabilityFail*; $break(); return undefined
```

## M4 — Chart-level reliability gate (**UNMOUNTED**)
`reliability/buildReliabilityGateChart.ts:147-457`: Init → PreCheck → CallProvider → PostDecide → `loopTo('pre-check')` (:455); retry state in SCOPE, round-tripping via `args.incomingBreakerStates` (:415-421). **Not exported, not mounted in any production path — editing it changes nothing in the agent's runtime today (test/reliability/gate-chart-7pattern.test.ts does import and execute it, so edits are still test-covered).** Its per-retry stage tracing is the intended fix for M3's retry-other bug. Invariant: all mutable gate state must be structured-clone-safe scope; providers/rules stay in the factory closure. Breaks when: a provider function is put into scope → structuredClone throws.

## M4b — Transport retry decorators (stateless fixed-point)
`resilience/withRetry.ts:61-99` (complete() only; stream() passes through UN-retried :91-97; defaultShouldRetry skips AbortError + 4xx-except-429 :116-126) · `identity/withCredentialRetry.ts:67-102` (only THROWN errors retry; result branches return immediately). Nothing saved/restored. Breaks when: the wrapped call has per-attempt side effects (billing) — retries multiply them.

## M5 — ReAct loop re-entry (loopTo + Replace guard)
Flat chart loops to `sf-injection-engine` (buildAgentChart.ts:473); grouped chart to `sf-llm-call` (buildDynamicAgentChart.ts:459). Each iteration re-runs the 3 slot subflows; every loop-crossed mount carries `arrayMerge: ArrayMergeMode.Replace` (buildDynamicAgentChart.ts:248,261,276 — ":235-236 Replace is load-bearing"; buildAgentChart.ts:284,333+). Not rollback — re-entry with OVERWRITE semantics: persistent state (history, iteration, cum tokens) is stage-written; per-iteration derived arrays are replaced.
Invariant: every array a slot re-derives per iteration must be mounted with Replace (footprintjs default CONCATENATES). Breaks when: a new loop-crossed mount omits Replace → injections/tools duplicate every iteration (silently growing prompts).

## M6 — Counterfactual replay + backward walk (offline analysis)
Files: `lib/context-bisect/trajectory.ts:411` `assembleTrajectory` (slices commitLog into LoopFrames via findLastWriter/commitValueAt; flat + grouped logs :16-24) · `ablation.ts` (`applyAblations` :116-144 — agent REBUILT from filtered inputs; `runAblationProbe` :221-254 — N seeded re-runs, majority-flip; `verdictFor` :267-309 — unstable baseline ⇒ inconclusive) · `bisect.ts` ddmin · `walk-to-root.ts:169` (narrow → hop along writerId provenance → ablate; beam-k) · finders (`removeAndRetry.ts:12-52`, shrinkToCause, testManyCombos; `FindInput.rerun` contract finders/types.ts:45-47) · `toBacktrackTrace.ts` (UI rewind serialization).

| Step | SAVED | RESTORED | DISCARDED |
|---|---|---|---|
| record | original run's commitLog + output | — | — |
| per probe | probe stats (flips, similarity, cost) | NOTHING — agent rebuilt from scratch minus ablated pieces | the probe run entirely |
| verdict | confirmed/not-confirmed/inconclusive | — | sub-majority flips (→ inconclusive) |

Invariant: causal claims come ONLY from majority-flip over ≥2 seeded reruns on a STABLE baseline (`resolveSamples` clamps ≥2, ablation.ts:150-153; unstable baseline ⇒ inconclusive :278-284). Rankings elsewhere are correlational proxies.
Breaks when: a nondeterministic agent whose un-ablated baseline itself flips across seeds → every verdict inconclusive; suspects of kind 'stage'/'arg' have no library-removable input — 'stage' → undefined (ablation.ts:72-73); 'arg' → a defined `{kind:'arg', note}` spec that applyAblations ignores (the runner must override the input itself, ablation.ts:63-71).

```
rerun = (removedIds) => runFreshAgent(applyAblations(specs(removedIds), ALL)).output
probe(specs): flips = Σ_seed outcomeChanged(original, rerun(specs, seed)); flipped = flips*2 > samples
walkToRoot: frame = symptom; loop: narrow(frame) → beam-k writers → ablate each → hop to writerId's frame
```

## M7 — Variable-first triage surface (consumes fp's slice layer)

Files: `src/lib/trace-toolpack/traceToolpack.ts` `buildBacktrack` — the 6th
toolpack tool, `backtrack(variable, element?, before?)`: slice mode =
`sliceForKey` + `formatSlice` (fp 9.10.0); element mode = `elementProvenance`
(the history mega-key answer: `history[N]` names its birth iteration —
attribution `append-verb`/EXACT under the agent's `commitValues: 'delta'`
default). Reserved under selfExplain (AgentBuilder.ts — inline list).
`src/lib/context-bisect/sliceToBacktrackTrace.ts` — the STRUCTURAL sibling of
toBacktrackTrace: `sliceToJSON` (fp) → atui BacktrackTrace. Always
`mode: 'correlational'`; every card `upperBound: true`; score = 1/(1+depth)
hop proximity NAMED in the honesty lines; missing slices render an empty
board that says why. Never fabricates a verdict.

Invariant: the LLM tool and the human board consume the SAME slice queries —
their answers cannot disagree (the parity loop: agent emits the trace, a
person confirms/overrides on the board).
Breaks when: af's executor defaults leave `writeProvenance` off — edges are
stage-level (honest ceiling); enabling `'reads-prefix'` tightens them with no
consumer change (fp #P1).

## Cross-mechanism seams
- Scope is the only durable carrier across pause (M1), fail-fast $break (M3 → ReliabilityFailFastError via scope.reliabilityFail*), and policy halt (toolCalls.ts:447-466 strict order: synthetic tool_result → halt emit → history commit → $break) — so M2's checkpoint always sees consistent state.
- Event payloads feeding M2's tracker must be PLAIN DETACHED arrays (toolCalls.ts:475-480) — a live TypedScope proxy in iteration_end.history breaks checkpoint serialization under deferred delivery.
- Retry telemetry flows via the emit channel (reliability.retried/recovered/fail_fast), never via scope commits.
