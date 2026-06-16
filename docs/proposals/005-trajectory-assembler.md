# Proposal: the per-loop trajectory assembler — one substrate that slices a recorded agent run into ordered loop frames

**Status:** v1 · proposed (NO implementation yet — design memo, revised after a two-lens review: library-inventor + trace-correctness/agent-eval domain expert. Every blocker and should-fix from both reviews is applied below). Gated on explicit "yes."
**Affects:** `agentfootprint/src/lib/context-bisect/` (a new `trajectory.ts` beside `llmEdgeWeigher.ts` / `localize.ts`, because the assembler needs `STAGE_IDS` + `EvidenceInput` and footprint.js/trace must stay agent-agnostic) and a new pure primitive `bucketByAnchors` in `footprintjs/trace` (the domain-agnostic half — see "Net-new vs reused"). No engine change. No public-trace-schema widening.
**Estimated change (v1):** ~250–350 LOC across two layers — a pure `bucketByAnchors` partition primitive in footprint.js/trace (property-tested there), and the thin agent-flavored `assembleTrajectory` that supplies the `call-llm` anchor convention, `stepOutputText`, `findLastWriter`/`commitValueAt`, and `EvidenceInput` projection on top. Pure, deterministic, read-only — zero new capture.
**Grounded in:** proposal 003 "Step 0" (the trajectory assembler it specified but left open), the 2026-06-16 `loopIteration`-population landing (footprint.js commit `969b3bc` / `FlowchartTraverser.ts:829`), and a source audit of the two REAL agent charts (`buildAgentChart.ts`, `buildDynamicAgentChart.ts`) that revealed two segmentation blockers the original Step-0 sketch would have shipped broken.

---

## One-liner / positioning

> **Slice a recorded ReAct run into ordered loop frames — one per iteration, bounded by the loop HEAD, carrying the loop's LLM call, its observable output, and the live sources that fed it — so the two-score localizer (L2), the per-loop recall scorer (L3), and the backtracking debugger (L4) all read the same honest substrate instead of one flattened bag.**

This is proposal 003's **Step 0 made concrete and corrected**. It is a pure read-only function, NOT a recorder — its one purpose is *assembly over a finished commit log* (Convention 1), the loop-level peer of `causalChain` / `commitValueAt` / `stepOutputText`, which are all pure commit-log functions too.

---

## The problem it solves

Today the localizer sees the whole run as **one flattened bag of sources scored against one output** (`localize.ts:465` — `scoreInfluence({ evidence, finalAnswerText: triggerOutput, embedder })`). A ReAct agent does not work that way: it thinks in rounds, and a source enters the model's attention *at a specific loop*. To score "how much did this source matter in the loop it actually entered" — and to walk a wrong answer back to the loop + decision that caused it — the run has to be **sliced into iterations first**. The commit log is one long unbroken ordered list (`getSnapshot().commitLog`); nothing in it carries a per-loop label a commit-log-only consumer can read. The assembler is the bookmark-placer that recovers the loop structure with no new capture.

Three downstream consumers need exactly this slicing and nothing more:
- **L2** (two-score localizer, proposal 004 — shipped *per-run*) wants to run *per loop* instead of once over the flattened bag.
- **L3** (per-loop recall scorer — next) wants "recall AT loop k", which is only well-defined once frames exist.
- **L4** (backtracking debugger — later) wants `causalChain` rooted *per loop* (`frame.llmCallId`) with the loop's live-source set, plus the governing decision as a control edge.

---

## The `LoopFrame` type (the substrate)

> File: `agentfootprint/src/lib/context-bisect/trajectory.ts` (NEW — lives beside `llmEdgeWeigher`/`localize` because it depends on `STAGE_IDS.CALL_LLM` + `EvidenceInput`; pure `footprintjs/trace` cannot own agent conventions — see "File placement" constraint below).

**Naming fix (BLOCKER, both reviews):** the design's central type cannot be called `ContextUnit` — that public name is ALREADY taken. `agentfootprint/src/lib/context-bisect/missingContext.ts:28` exports `interface ContextUnit { id; content? }`, re-exported through both `context-bisect/index.ts:29` AND the public barrel `observe.ts:265`. Two incompatible same-named exports in one package collide on the barrel and silently swap shapes on any adopter `import { ContextUnit }`. The per-loop source type is a distinct concept (a *live writer of a key for one loop*, not a dropped-context identity), so it gets a distinct plain name: **`ContextSource`** (aligns with the localizer's existing "context source" vocabulary).

```ts
// One source the loop's call-llm read, traced back to its live writer for THAT loop.
export interface ContextSource {
  readonly key: string;                 // the state key call-llm#k read (e.g. 'systemPromptInjections')
  readonly writerId: string | undefined;// runtimeStageId of findLastWriter's bundle (live source for THIS loop); undefined when never committed before the anchor
  readonly writerArrayIdx: number | undefined; // the commitLog ARRAY position of that writer — NOT CommitBundle.idx (which is optional); see "writerArrayIdx" fix
  readonly value: unknown;              // commitValueAt(commitLog, writerArrayIdx, key) — materialized live value; undefined under the pre-run-initial blind spot
  readonly evidence: EvidenceInput;     // { id: `${llmCallId}::${key}`, text: stringified value, ancestorTexts: [] } — the bridge field handed to scorers
}

// One ReAct iteration — bounded by the loop HEAD, pointing at the call-llm inside it.
export interface LoopFrame {
  readonly loopIndex: number;           // anchor ordinal 0,1,2… (DERIVED from commit log; NOT TraversalContext.loopIteration)
  readonly llmCallId: string;           // the call-llm#k runtimeStageId — the LLM-step pointer WITHIN the frame
  readonly llmCallArrayIdx: number;     // call-llm#k's commitLog ARRAY index — the beforeIdx for findLastWriter (EXCLUSIVE — see semantics)
  readonly headArrayIdx: number;        // the loop-HEAD commit's array index — the body's LOWER bound (see "body mis-bucketing" fix)
  readonly bodyIds: readonly string[];  // every CommitBundle.runtimeStageId in [headArrayIdx[k], headArrayIdx[k+1]) — the full multi-stage body of round k IN COMMIT ORDER, INCLUDING this round's own route + tool-calls
  readonly intermediateText: string | undefined; // stepOutputText over the call-llm commit — assistant content + tool-call intents
  readonly contextSources: readonly ContextSource[]; // one per key read by call-llm#k
  readonly incompleteSources?: ReadonlyArray<UntrackedSource>; // 'args'|'env'|'silent' — passed through VERBATIM from the call-llm bundle's untrackedSources
  readonly untrackedReadsPresent: boolean;       // true when incompleteSources is non-empty → "this step consumed untracked reads; slice may be incomplete here" (NOT a model-internalized claim — see honesty fix)
}

export interface SyntheticQuestionNode {
  readonly text: string;                // re-injected from the root InOutEntry.payload (__root__#0)
  readonly incompleteSources: readonly ['args']; // args is untracked by design
  readonly injected: true;              // the question→first-source link is a PROXY, never a recorded dependency
}

export interface Trajectory {
  readonly frames: readonly LoopFrame[];
  readonly prelude: readonly string[];  // commits BEFORE the first head (seed, sf-memory-read/*) — run-setup, NOT loop body (see "first-frame lower bound" fix)
  readonly question: SyntheticQuestionNode; // only populated when the contrastive path is actually wired — see "L2 composition" honesty fix
  readonly honestyFlags: readonly HonestyFlag[]; // reuses context-bisect's HonestyFlag type — degrade, never throw
  readonly truncated?: { byFrames: boolean }; // set only when maxFrames cut the run
}
```

**Standing slice-level caveat on EVERY `Trajectory` (the central honesty contract):** *"contextSources show only sources re-committed to tracked state; context the model retained internally — carried in its own reasoning and never re-committed to a tracked key — leaves no read→write edge and is NOT represented here."* This is unconditional, NOT a per-frame boolean (see honesty fix #1).

---

## The assembler API (the simplest call an adopter wants)

**Signature fix (SHOULD-FIX, inventor):** the original 5 positional args re-derived what the package already centralizes and were error-prone (`llmCallIds`/`getKeysRead` swap silently typechecks against `unknown` rootPayload). The shipped localizer takes ONE bag — `ContextBugArtifacts { snapshot, controlDeps?, quality?, events?, llmCallIds? }` (`types.ts:81`) — and `buildArtifactIndex` (`localize.ts:203`) ALREADY extracts `commitLog` from `snapshot.commitLog`, builds `lastIdxOf` (`commitLog[i].runtimeStageId → i`), and builds `readsOf` by walking `snapshot.executionTree` `stageReads`. The assembler takes the **same bag** and reuses `buildArtifactIndex` rather than re-implementing the walk:

```ts
export function assembleTrajectory(
  artifacts: ContextBugArtifacts,        // SAME bag the localizer takes — { snapshot, events?, llmCallIds?, ... }
  opts?: { maxTextChars?: number; maxFrames?: number; verifyWith?: (id: string) => number | undefined },
): Trajectory;
```

- `commitLog`, `lastIdxOf`, `readsOf` (the `getKeysRead` map), and the root payload (`InOutEntry __root__#0`, via `ROOT_RUNTIME_STAGE_ID`) are ALL derived internally from `artifacts.snapshot` — adopter call is just `assembleTrajectory(artifacts)`.
- `lastIdxOf` is built internally (one pass, identical to `buildArtifactIndex:205`) because `stepOutputText(commitLog, lastIdxOf, runtimeStageId, maxChars)` (`llmEdgeWeigher.ts:148`) REQUIRES it — it is NOT on the public signature (the plain-API rule keeps the adopter surface minimal).
- `opts.verifyWith` is the OPTIONAL dev-mode cross-check (the `loopIteration` lookup recorder, below). Default path needs no recorder.

**WHY a pure function, not a recorder (Convention 1 — one purpose):**
1. Its one purpose is **assembly** (read-only projection over a FINISHED commit log), not event **ingestion**. A recorder's purpose is live capture; this never observes the run.
2. Every input is already a finished artifact: `snapshot` (post-run), `llmCallIds` (from already-captured emit events via `llmCallIdsFromEvents`), `readsOf` (from `snapshot.executionTree`). A recorder would be a Convention-1 violation (capture + project in one class).
3. It mirrors `causalChain` / `commitValueAt` / `stepOutputText` — all pure read-only commit-log functions, never recorders. The assembler is their loop-level peer.
4. The ONE place a recorder IS justified is the optional cross-check (a `KeyedStore<number>`-owning `FlowRecorder` keyed by `runtimeStageId` capturing `TraversalContext.loopIteration`, exposing `loopIterationOf(id)`) — fed in via `opts.verifyWith`, used only to assert anchor-derived `loopIndex === loopIterationOf(llmCallId)` in dev mode. Default path needs no recorder.

---

## The segmentation rule (anchor-range — corrected)

The commit log is the segmentation authority; `loopIteration` is a dev-mode cross-check, never the grouping primitive. **Two source-verified blockers forced a correction to the original Step-0 sketch.**

### Rule (corrected)

**1. The HEAD bounds the body; the call-llm points inside it.** (BLOCKER, trace-expert — "body mis-bucketing".) The original sketch bounded frames on `call-llm` "for simplicity." That is the bug. The loop is **branch-sourced** from `tool-calls` back to the loop head, so the per-iteration commit order is verified as:

```
InjectionEngine → Context (+3 parallel slot subflows) → UpdateSkillHistory → Cache → CallLLM → [Thinking] → Route → ToolCalls → loop
```

(`buildAgentChart.ts:222,293,361,372,395,420–433` — `tool-calls` loops to `SUBFLOW_IDS.INJECTION_ENGINE`; `toolCalls.ts` writes `scope.history`/`lastToolResult`/`iteration` AFTER `call-llm`.) A `call-llm`-anchored half-open range `(anchorIdx[k-1], anchorIdx[k]]` silently pushes iteration (k-1)'s OWN `Route` + `ToolCalls` commits into frame k — breaking `bodyIds`/`intermediateText` as a "what happened in round k" view and mis-attributing each tool result's birth iteration. **Fix:** bound the body on the loop HEAD.

- **HEAD anchor** = `splitStageId(bundle.stageId).localStageId === SUBFLOW_IDS.INJECTION_ENGINE` (flat chart) or the `sf-llm-call` boundary entry / `turn-seed` (grouped chart) — both SSOT in `conventions.ts`. Use `splitStageId` (NOT `parseRuntimeStageId`) because `bundle.stageId` is the FULL prefixed form (the file-header collision warning).
- **Frame k body** = `[headArrayIdx[k], headArrayIdx[k+1])` — half-open on the head, open-ended for the last frame. Now round k's `Route` + `ToolCalls` land in frame k where they belong.
- **call-llm** stays the **LLM-step pointer WITHIN** the frame (`llmCallId`, `llmCallArrayIdx`), not the body boundary. `findLastWriter(lastToolResult, llmCallArrayIdx_k)` still correctly reaches back into frame (k-1)'s tool commit as a legitimate cross-frame source.

**2. The first frame's lower bound and the prelude.** (SHOULD-FIX, inventor — "first-frame lower bound undefined".) For k=0 there is no `headArrayIdx[-1]`. Pre-loop commits (`seed#0`, `sf-memory-read/*` — verified present before the first head) are NOT loop body. **Fix:** they go in an explicit `Trajectory.prelude: string[]` (commits in `[0, headArrayIdx[0])`), and the partition is **total**: every commit lands in exactly one frame OR the prelude (property-tested).

**3. Concurrent fork stages are a non-issue.** The `context` selector's `sf-system-prompt ‖ sf-messages ‖ sf-tools` share the global `_executionCounter` so their ids interleave, but they ALL commit strictly before the sequential `call-llm#k` and within `[headArrayIdx[k], headArrayIdx[k+1])`, so range-bucketing captures them regardless of interleave order. Bucketing only requires the boundaries to be sequential, which the head and call-llm both are.

**4. Nested-subflow re-entry is automatic — IN THE FLAT CHART.** Subflow child traversers share the parent `_executionCounter` and `_visitCounts` (`FlowchartTraverser.ts:452–453`), so subflow `CommitBundle.runtimeStageId`s carry the parent prefix and sort in-range by array position. `splitStageId` recovers the local anchor name at any depth (proven in `conventions.ts` `slotFromSubflowId`/`stageRole`).

**5. The GROUPED chart needs subtree descent — NOT a flat range.** (BLOCKER, trace-expert — "grouped-chart body is a single subflow mount".) In `buildDynamicAgentChart` the WHOLE turn (`turn-seed → injection → context fork → cache → call-llm`) runs INSIDE `sf-llm-call` with its OWN child scope; the boundary `outputMapper` (`buildDynamicAgentChart.ts:376–396`) bubbles ONLY `llmLatestContent`/`llmLatestToolCalls`/tokens/`skillHistory` to the parent. The internal slot keys (`systemPromptInjections`, `messagesInjections`, `dynamicToolSchemas`, `cacheMarkers`) live in the SUBFLOW's commit stream — they are NOT in the parent `commitLog` the assembler walks. `splitStageId` does NOT fix this; it is **scope-locality**, not name-prefixing (the same trap as the lens "subflow internals" memory note). **Fix (v1 scope decision):**
- **v1 restricts `assembleTrajectory` to the FLAT chart (`buildAgentChart`).** This is the default agent runtime and the one the multi-loop fixture will target.
- **Grouped mode is detected and degraded, never silently mis-bucketed:** `parseRuntimeStageId(callLlmId).subflowPath === SUBFLOW_IDS.LLM_CALL` is the signal. When detected, the assembler emits a `Trajectory.honestyFlags` entry (`'untracked-sources'`-class note: *"grouped chart — slot keys live in the sf-llm-call subtree; descend via getSubtreeSnapshot for per-source context"*) and assembles what the parent log DOES carry (the bubbled keys + outer route/tool-calls), rather than fabricating absent sources.
- **Grouped subtree-join is a documented v2 follow-up:** `getSubtreeSnapshot(snapshot, 'sf-llm-call')` (verified `runner/getSubtreeSnapshot.ts:53`) exposes the per-subflow commit stream; stitching contextSources across the mount boundary via the outputMapper'd keys is genuinely net-new and gated separately.

**6. The cross-check is optional and degrades — it never refuses.** (SHOULD-FIX, trace-expert — "anchor-count cross-check false-mismatch".) `llmCallIdsFromEvents` requires an `EmitRecorder` attached and events captured (`agent.on('*')`); if the adopter forgot, `llmCallIds` is empty while the commit log has N anchors. The commit-log head/call-llm scan is the **sole, self-sufficient** segmentation authority and needs no events. **Fix:** `llmCallIds` is OPTIONAL (cross-check only). When supplied AND the count differs from the commit-log-derived anchor count, the assembler emits a `Trajectory.honestyFlags` entry (`'no-llm-call-ids'`-class) — degrade, never throw, matching the engine's "isolate and degrade" convention. This also removes the event-capture coupling from the pure assembler (strengthens the "pure function not recorder" justification).

**7. dynamicTurnSeed-resets-slots is a HELP.** The flat chart's `InjectionEngine`/`Context` re-run and re-commit the slot keys each loop, so `findLastWriter(commitLog, key, llmCallArrayIdx_k)` lands on the CURRENT turn's commit — loop-local sources for free. (In the grouped chart `turn-seed` does the same, but inside the subflow scope — see fix #5.)

**8. `findLastWriter`'s `beforeIdx` is EXCLUSIVE — pass `llmCallArrayIdx`, not `+1`.** (SHOULD-FIX, trace-expert.) `findLastWriter`'s loop is `for (i = end-1; …)` with `end = beforeIdx` (verified `commitLogUtils.ts:23`), so `beforeIdx` is exclusive. Passing `llmCallArrayIdx` finds the PRIOR writer — exactly what a source feeding the call should be — and crucially does NOT resolve to call-llm's OWN write-back for a key call-llm both reads AND writes (e.g. token counters). Property test: a read-and-written key (tokens) resolves to the prior frame, never self.

---

## Honesty flags (where the trajectory is incomplete)

**1. Model-internalized context is UNDETECTABLE — do NOT claim `untrackedSources` detects it.** (SHOULD-FIX, both reviews — the most important honesty correction.) `UntrackedSource` is ONLY `'args'|'env'|'silent'` (verified `types.ts:45–57`). A fact the model carried in its OWN reasoning and never re-committed produces NO read by any stage → triggers NONE of these flags. Worse: `dynamicTurnSeed` calls `$getArgs()` (`buildDynamicAgentChart.ts:83`), so `'args'` fires on every grouped turn regardless of whether the model internalized anything — making `modelInternalizedHint` a FALSE signal. **Fix:**
- `LoopFrame.incompleteSources` passes through `CommitBundle.untrackedSources` VERBATIM — it truthfully means *"this call-llm step consumed untracked args/env/silent reads; slice may be incomplete here"* (mirroring `causalChain`'s existing `⚠ slice may be incomplete here`).
- The per-frame boolean is renamed `untrackedReadsPresent` (truthful) — it does NOT assert WHERE the gap is.
- The model-internalized blind spot becomes the **unconditional standing `Trajectory`-level caveat** (above), NOT a per-frame derived flag. This is the difference between an honest tool and a misleading one.

**2. The question anchor is untracked by design.** Run input via `getArgs()` is `UntrackedSource 'args'`. The assembler re-injects the question as a `SyntheticQuestionNode` from the root `InOutEntry.payload` (`__root__#0`, `ROOT_RUNTIME_STAGE_ID`), stamped `incompleteSources: ['args']` + `injected: true` — the question→first-source link is a PROXY, never a recorded dependency (proposal 003 Step-1). **It is only populated when the contrastive path is actually wired (see L2 composition fix) — otherwise it ships absent rather than feeding a code path that does not exist.**

**3. Pre-run initial-state blind spot — `value: undefined`, honestly.** `findLastWriter` + `commitValueAt` share a blind spot (verified `commitLogUtils.ts:53–58`): a source derived purely from run-start initial state (no `set` anchor) folds from absent. The flat chart re-commits slot keys each loop so this is fine for those — but keys seeded ONCE at root and never re-written (`maxIterations`, `userMessage`, `runIdentity`, which `inputMapper` marks read-only) fold-from-absent and surface as `value: undefined` with `writerId: undefined`. The `ContextSource` carries `undefined` rather than fabricating a value. Documented as expected, not a bug. (`userMessage` is the question — its correct source is the `SyntheticQuestionNode`, not a commit.)

**4. Anchor-count mismatch → honesty flag, never silent mis-bucket** (fix #6 above).

**5. `loopIteration`-on-`CommitBundle` is STILL GATED.** `CommitBundle` has no `loopIteration`/`parentRuntimeStageId` field (verified `types.ts:60–86`). The assembler DERIVES from `runtimeStageId` (head/anchor-range) and does NOT depend on the gated public-trace-schema widening (proposal 003:188). If a real adopter needs `forkBranch`, take the join recorder first; the engine field is a separate "yes."

**6. Same-executor resume accumulates two runIds into one commit log.** (NIT, trace-expert.) On pause mid-body the current call-llm committed but route/tool-calls may be mid-flight; resume gets a FRESH runId (Convention 4) and SAME-executor resume accumulates both runs' commits into one log. `CommitBundle` has no `runId` field (verified `types.ts:60–86`), so v1 **documents the limitation explicitly**: the assembler assumes a single uninterrupted run. A property test over a synthetic paused+resumed log pins the behavior. (Filtering by runId needs the gated flow-event join — deferred with fix #5.)

---

## Composition with L2 / L3 / L4

**L2 (two-score localizer) — composition claim CORRECTED (BLOCKER, inventor).** The design claimed L2 is "shipped" and consumes the trajectory "unchanged" via `scoreContrastiveInfluence(answerText = frame.intermediateText, referenceText = trajectory.question.text)`. **This is false as written.** The shipped localizer calls `scoreInfluence({ evidence, finalAnswerText: triggerOutput, embedder })` (`localize.ts:465`) — single-anchor `scoreInfluence`, NO `referenceText`/question anchor at all. `scoreContrastiveInfluence` exists and is exported but is **unused by the localizer**. Honest statement:
- **Today L2 scores per-run against `triggerOutput` via `scoreInfluence` (no question anchor).**
- **Per-loop consumption is net-new work, NOT "unchanged":** re-pointing L2 at `frame.intermediateText` as the per-loop answer is a real change to the localizer.
- **Scope decision for THIS proposal:** the assembler drives the EXISTING `scoreInfluence` path per frame — for frame k, hand `frame.contextSources.map(s => s.evidence)` as `evidence` and `frame.intermediateText` as `finalAnswerText`, running the shipped scorer once per loop instead of once per run. Output stays `InfluenceScore[]` so `rankingConfidence` + ablation compose unchanged.
- **`SyntheticQuestionNode`/`referenceText` ship ONLY IF the contrastive path is wired** (a separate decision — moving L2 to `scoreContrastiveInfluence` + a question anchor). Until then `Trajectory.question` is produced but not consumed; the contrastive wiring is flagged as the L2-re-point follow-up, not part of Step-0. This keeps the proposal from producing a field that feeds a non-existent code path.

**L3 (per-loop recall scorer — NEXT).** Consumes the SAME `LoopFrame[]`, scoring RECALL: for each frame, did the `contextSources` that SHOULD have driven `frame.intermediateText` actually influence it? Reuses `contextSources[].evidence` as the candidate set and `intermediateText` as the answer. The per-frame slicing is exactly what makes "recall AT loop k" well-defined. No new assembler output needed.

**L4 (backtracking debugger — LATER).** Consumes `frame.llmCallId` as the `causalChain` startId and `frame.contextSources[].writerId` as the per-loop live-source set:
```ts
causalChain(commitLog, frame.llmCallId, getKeysRead,
  { controlDeps: controlDepRecorder().asLookup(), weigh: llmEdgeWeigher.weigh });
```
the SAME `causalChain`/`EdgeWeigher` VERBATIM, now rooted per-loop. The control edge (`ControlDepRecorder`, nearest governing decision via `parentRuntimeStageId`) brings the "wrong early tool pick" decision into frame k's slice as `kind:'control'`. `untrackedReadsPresent` tells L4 when the slice is honestly incomplete at that loop.
- **NET-NEW for L4 (out of Step-0 scope, flagged):** loop-scoped ablation. The shipped `AblationSpec` excludes a source for the WHOLE run and returns ONE output (proposal 003:141,154). Ablating a `ContextSource` AT its loop and re-deciding needs a loop-scoped contract that does not exist yet. The assembler PRODUCES the frames L4 needs; the loop-scoped confirmer is a separate phase.

---

## File placement (a constraint, not a choice) — and the trace-level split

(NIT→adopted, inventor.) The assembler's CORE — partition a commit log by an arbitrary anchor-id list — is **domain-agnostic** and a genuine `footprintjs/trace`-level primitive (peer of `causalChain`). `footprintjs/trace` MUST stay agent-agnostic and cannot own `'call-llm'`/`'sf-injection-engine'` as anchors. So the layering is:

- **`footprintjs/trace`: `bucketByAnchors(commitLog, headAnchorRuntimeStageIds)`** — a pure partition primitive that takes the head anchor id list AS DATA (no `call-llm` knowledge), returns `{ frames: { headArrayIdx, bodyIds }[], prelude }`, property-tested there. Its one purpose = partition.
- **`agentfootprint/src/lib/context-bisect/trajectory.ts`: `assembleTrajectory`** — supplies `STAGE_IDS`/`SUBFLOW_IDS` conventions, finds the head + call-llm anchors via `splitStageId`, layers `stepOutputText`/`findLastWriter`/`commitValueAt`/`EvidenceInput` projection on top of `bucketByAnchors`. Its one purpose = agent-flavored frame projection.

This honors Convention 1 (two purposes, two homes) and matches how `splitStageId`/`causalChain` live in trace while `llmEdgeWeigher` lives in agentfootprint.

---

## Plain walkthrough (for the non-developer reader)

Picture an AI agent solving a problem in rounds — round 1: gather some facts, phone the AI model, get an answer; round 2: gather more facts, phone again; and so on until done. Every round leaves a paper trail in a logbook (the commit log): one numbered line for everything it wrote that round. The trouble is the logbook is ONE long unbroken list — round 1, 2, 3 all run together — and you can't tell where one round ends and the next begins.

This tool is the bookmark-placer. It knows that each round STARTS at the same step (the "loop head" — where the agent begins gathering context again) and phones the model exactly once in the middle. So it walks the logbook, drops a bookmark at the START of every round, and says: everything from this bookmark to the next is ONE round — including that round's own tool calls and routing decision at the END, which is the bit the first naive sketch got wrong (it would have shoved round 1's tool calls into round 2's slice). Several helpers working in parallel that round all finish before the phone call, so they fall in the right slice automatically.

For each round it fills out an index card (a `LoopFrame`): which round number, what the agent said that round, and — for each fact the agent looked at — WHO last wrote that fact and what it said (following the logbook backwards to the freshest entry). Three other tools read these cards: one scores how much each fact mattered THIS round, one checks whether the facts that should have mattered actually did, and one traces a wrong answer back to the fact (or the bad decision) that caused it — all per round, instead of for the whole run smeared together.

The honest part: sometimes the agent "just knew" something from its own head and never wrote it down. There's no logbook line to follow, so the tool can't show you that fact — but instead of pretending it's complete, every card-set carries a standing warning: *"some facts may live only in the model's reasoning and aren't shown here."* We do NOT slap a per-round "model internalized something" stamp, because the only signals we have ('args'/'env'/'silent' reads) fire even when nothing was internalized — that would be a false alarm. We mark "this step read something untracked, so the slice may be incomplete" truthfully, and keep the model-internalized limitation as one honest, run-wide note. The original question comes in untracked too, so it's marked a re-injected best-guess, not a recorded link — and we only attach it when the scorer that needs it is actually wired.

---

## Net-new vs reused

**Reused VERBATIM (zero engine/API additions):**
- `splitStageId`, `parseRuntimeStageId`, `buildRuntimeStageId` (`footPrint/.../runtimeStageId.ts`)
- `findLastWriter`, `commitValueAt` (`footPrint/.../commitLogUtils.ts`) — with EXCLUSIVE-`beforeIdx` semantics documented
- `stepOutputText` (`agentfootprint/.../llmEdgeWeigher.ts:148`) — fed an internally-built `lastIdxOf`
- `buildArtifactIndex`, `ContextBugArtifacts`, `llmCallIdsFromEvents`, `HonestyFlag`/`HonestyFlagKind` (`agentfootprint/.../localize.ts`, `types.ts`)
- `STAGE_IDS.CALL_LLM`, `SUBFLOW_IDS.INJECTION_ENGINE`/`LLM_CALL` (`conventions.ts` — SSOT)
- `EvidenceInput`, `InfluenceScore`, `scoreInfluence`, `rankingConfidence` (`influence-core`)
- `ROOT_RUNTIME_STAGE_ID` / `InOutEntry.payload` (`InOutRecorder.ts:75`), `getSubtreeSnapshot` (deferred grouped path)
- `causalChain`, `ControlDepRecorder.asLookup()`, `llmEdgeWeigher.weigh` (consumed by L4, not by the assembler)

**Genuinely net-new:**
- `bucketByAnchors(commitLog, headAnchorIds)` — the pure HEAD-range partition primitive in `footprintjs/trace`, property-tested (every commit lands in exactly one frame OR the prelude; head count === supplied anchor count; bodyIds reconstruct the log in order).
- `LoopFrame` / `ContextSource` / `Trajectory` / `SyntheticQuestionNode` types — no such symbol exists today (grep-confirmed; `ContextUnit` deliberately AVOIDED due to the existing public export).
- `assembleTrajectory(artifacts, opts)` — the thin agent-flavored projection composing ONLY shipped primitives.
- `untrackedReadsPresent` + the standing slice-level model-internalized caveat — promotes the per-stage `untrackedSources` D2 marker to a per-loop honest signal WITHOUT over-claiming model-internalization.
- `SyntheticQuestionNode` from `__root__#0` (produced; consumed only when the contrastive path is wired).
- OPTIONAL Convention-1 `loopIteration` cross-check recorder (`KeyedStore<number>` `FlowRecorder`, `loopIterationOf(id)`) — dev-mode assertion only, fed via `opts.verifyWith`.

**FLAGGED-FOR-L4 (out of Step-0 scope):** a loop-scoped `AblationSpec` — the loop-scoped causal confirmer is a separate phase.
**BLOCKED-ON-FIXTURE (not the assembler's blocker):** the segmentation rule, the λ default, and "forward beats position-based" cannot be CALIBRATED without the multi-loop CTXBUG planting fixture (proposal 003:91,158). The assembler ships FIRST precisely because it is pure deterministic read-only assembly verifiable with PROPERTY tests independent of calibration.

---

## Validation plan (Convention 3 — 7 test types)

| Type | Asserts |
|---|---|
| **Unit** | `splitStageId(bundle.stageId).localStageId` matches HEAD/`call-llm` at every nesting depth; `findLastWriter` with `beforeIdx = llmCallArrayIdx` resolves the PRIOR writer (not self) for a read-and-written key (tokens). |
| **Functional** | On a synthetic 3-loop flat-chart commit log: 3 frames, each carrying its OWN route+tool-calls (NOT the previous round's); `bodyIds` in commit order; `intermediateText` from the round's call-llm. |
| **Integration** | Run `assembleTrajectory(artifacts)` → feed `frame.contextSources.map(s=>s.evidence)` + `frame.intermediateText` into the SHIPPED `scoreInfluence` per frame; assert `InfluenceScore[]` shape unchanged and `rankingConfidence` composes. |
| **Property** | TOTALITY — every `CommitBundle` lands in exactly one frame OR the prelude (none dropped/duplicated); head count === supplied anchor count; `bodyIds` ∪ `prelude` reconstruct the full commit log in array order. Fuzzed over random loop counts + interleaved fork commits. |
| **Security** | `intermediateText`/`ContextSource.value` respect `redactedPaths` (only committed/scrubbed values via `commitValueAt`); no raw payload leaks through `evidence.text`. |
| **Performance** | Single linear pass over `commitLog` for bucketing + one `findLastWriter` per `(frame, key)`; budget within the localizer's existing `buildArtifactIndex` envelope on an N-loop log. |
| **Load** | Sustained assembly over a long-trajectory (≥50-loop) synthetic log without quadratic blowup; `lastIdxOf` built once. |
| **Edge / honesty** | Grouped-chart detection emits a degrade flag (no fabricated sources); empty `llmCallIds` does NOT throw; anchor-count mismatch → `honestyFlags` not exception; a `userMessage`/`maxIterations` source folds to `value: undefined`; a paused+resumed synthetic log's behavior is pinned. |

Integration tests are also the mandatory `examples/` demo (Convention 2): a runnable flat-agent run → `assembleTrajectory` → per-loop `scoreInfluence` printout.

---

*Gated: no code until an explicit "yes." This memo is the artifact to react to. Every blocker and should-fix from the library-inventor and trace-correctness reviews is folded in above — name collision (`ContextUnit`→`ContextSource`), the false L2-"unchanged" claim, the body mis-bucketing (HEAD-bounded, not call-llm-bounded), the grouped-chart scope-locality (flat-only v1 + degrade), the signature bag, the first-frame prelude, `writerArrayIdx` (not optional `bundle.idx`), and the model-internalized honesty correction (`untrackedReadsPresent` + standing caveat, never a false per-frame stamp).*