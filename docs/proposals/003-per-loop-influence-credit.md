# Proposal: per-loop influence — trajectory-aware credit assignment for the influence scorer

**Status:** v1 · proposed (NO implementation yet — design memo, gated on explicit "yes")
**Affects:** `agentfootprint/src/lib/influence-core/` (new `scoreTrajectoryInfluence` strategy alongside `scoreInfluence` / `scoreContrastiveInfluence`), optionally `agentfootprint/observe` (a recorder that assembles the per-loop trajectory from the footprint.js commit log). No engine change in v1.
**Estimated change (v1):** ~250–350 LOC of a new pluggable scorer + a trajectory assembler over data footprint.js *already records*. No new model-training loop (see "inference-time estimation").
**Grounded in:** the 2026-06-15 deep-research report (104 sources, 22 verified claims) — see "Research grounding" below.

---

## One-liner / positioning

> **Stop scoring a context source by how much it resembles the *final* answer. Score it by how much it *changed the agent's chance of getting there* — and let that credit flow backward across loop iterations.**

The three current scorers (`scoreInfluence`, `scoreContrastiveInfluence`, and the ablation tier in `localizeContextBug`) are all **flat**: they relate a source to *one* output. None propagates credit across the *steps* of a multi-loop agent. This proposal adds the missing temporal dimension — the one piece the literature says a per-step agent attributor needs.

---

## The problem it solves

Today's `scoreInfluence` has a `DEPTH` signal (`1 / (1 + number of reasoning ancestors)`) that is *supposed* to be the "where in the trajectory" knob. It has two defects:

1. **It's dormant in flat scenarios.** With no reasoning ancestors (our current single-LLM-call benchmark cases), `DEPTH` is a constant — it contributes nothing. It only activates inside a real multi-loop agent.
2. **Even when active, it's a fixed structural decay**, not a measure of *whether the step mattered*. "Earlier = less, on a fixed curve" is exactly the flat/uniform-credit pattern the RL literature shows **mis-assigns blame** — "a single wrong tool call at turn 3 gets the same blame as dozens of correct later actions."

Concretely, the user's motivating question: in a ReAct agent, a **tool choice in loop 1** and the **reasoning in the last loop** should not get credit by their *position* — they should get credit by how much each *moved the outcome*. A wrong tool pick early can be the whole cause while looking "far" from the final answer; our current scorer would *discount* it for being deep in the past.

---

## Research grounding (2026-06-15 report)

The field splits into two camps; our scorers live in the first, the missing piece is in the second.

- **Camp 1 — context/data attribution** (ContextCite, TracLLM, AttriBoT, CAMAB). Verified: **all single-output, flat-context** — they attribute one answer to a flat bag of sources and, by their authors' own framing, do **not** propagate credit across agent steps. A 2025 retrofit of ContextCite onto reasoning steps "excessively emphasizes the final reasoning step" — the same final-answer bias our FA term has. *Our scorers are a recognized family; it's the family that doesn't do per-loop credit.*
- **Camp 2 — RL temporal credit assignment** (Process Reward Models, **AgentPRM**, **GRPO-λ**, counterfactual turn-credit C3 / SCAR). Verified: this camp **does** solve per-step credit toward a terminal outcome, and explicitly warns flat episode-level credit blames the wrong step.
  - **AgentPRM** (arXiv 2511.08325) is the closest published formulation: score each step by **promise** (a Q-value: expected chance of eventually succeeding after this step) and **progress** (an advantage `A = Q − V`: how much better this step was than the baseline at that point), modeling that steps depend on each other.
  - **GRPO-λ** (arXiv 2510.00194) supplies the **backward-propagation mechanism** — an eligibility-trace / λ-return that flows credit from the terminal outcome back to earlier steps ("rapid value propagation towards earlier tokens"), instead of a fixed decay.
  - **AttriBoT** (arXiv 2411.15102) supplies the **scaling recipe** for the causal tier: >300× speedup over naïve leave-one-out via caching + proxy models — the route to running ablation at *every* loop iteration of a long trajectory.

Honest caveats from the report: the "influence functions are bad" claim was **refuted** in verification (no claim made there); and **attribution stability under non-determinism is the least-grounded area** — no off-the-shelf method exists, which is an *opportunity* (see signal 3).

---

## The design — a new pluggable strategy, not a rewrite

footprint.js / agentfootprint already record the entire per-loop trajectory that flat scorers throw away: the **commit log**, **`runtimeStageId`** (per loop iteration), the **causal chain**, and (RFC-003) control-dependency edges. That is the raw material AgentPRM needs and no embedding-only scorer has. So this is *assembly + scoring*, not new capture.

```
scoreTrajectoryInfluence({
  trajectory,      // ordered loop steps, each: { runtimeStageId, contextUnits[], decisionText }
  outcome,         // terminal success/failure signal (or a goal-similarity proxy)
  estimator,       // INJECTED: how to get promise(Q) / progress(A) per step (see below)
  lambda?,         // eligibility-trace decay for backward credit flow (GRPO-λ style)
  embedder?,       // for the goal-relative proxy estimator default
}) => InfluenceScore[]   // SAME shape — rankingConfidence + ablation compose unchanged
```

Two new per-source signals **replace the flat `DEPTH` term** (FA / AVG / PERSIST stay as-is for content):

- **`promise`** — the step's expected contribution to reaching the outcome (Q-value).
- **`progress`** — advantage `Q − V`: how much *better than baseline* the step was. Pleasingly, this is the *same shape* as contrastive's "subtract a reference" — but on expected-success, not text similarity, so it's a step toward causal grounding rather than just confound control.

Credit is then **propagated backward** across loops with a λ-decayed eligibility trace, so a decisive early tool choice keeps its credit instead of being discounted for being "deep."

### The key idea that keeps it library-shaped: inference-time estimation

AgentPRM normally needs a *trained* reward model — too heavy for a library. The injected `estimator` makes that a **strategy choice**, with a ship-a-default + bring-your-own:

| estimator | how it gets Q / A | cost | when |
|---|---|---|---|
| **goal-similarity (default)** | proxy Q = embedding similarity of the post-step state to the goal/outcome; A = step-over-step delta | free, embedder-only | quick, correlational |
| **ablation-MC** | Q estimated from a few seeded continuations after ablating the step (Monte-Carlo) | model re-runs | causal, scaled by AttriBoT-style caching |
| **bring-your-own** | consumer plugs a trained PRM / critic | their cost | research / production |

This mirrors the existing claim ladder exactly: **scorers buy speed (correlational, free); ablation buys truth (causal, real re-runs).** The default keeps influence cheap; the ablation-MC estimator is the honest causal tier.

### Signal 3 — the novel contribution: stability under non-determinism

The report found **no published method** for "how stable is a per-step attribution when each LLM decision is non-deterministic." Because the ablation-MC estimator already runs seeded re-runs, we get this **for free**: report the **variance / flip-rate** of each step's credit across seeds as a **confidence band** on every influence score. This is both honest (a wide band = "don't trust this attribution") *and* a clean, defensible **paper angle** the literature doesn't cover.

---

## Honest scope & non-goals

- **v1 is correlational-by-default, causal-by-opt-in** — same honesty ladder as the existing scorers. The goal-similarity estimator is a proxy; only ablation-MC (or a real PRM) makes a causal claim.
- **Not an RL training loop.** We estimate promise/progress at *inference time*; we do not train a reward model. (Open question the report raised: how well inference-time MC approximates a trained PRM — worth measuring on CTXBUG.)
- **Does not replace** `scoreInfluence` / `scoreContrastiveInfluence` / ablation — it's a fourth pluggable strategy for the *multi-loop* case. Flat single-call scenarios keep using the flat scorers (cheaper, identical output there).
- **Absence/crowding (B6) stays** `rankingConfidence` + `findDroppedContext` + ablation territory — trajectory credit is about *present* steps' influence, not missing context.

## Validation plan (Convention 2/3)

- **Needs a multi-loop CTXBUG instance.** Current instances are mostly single-call; this requires a real ReAct trajectory with a plantable early-vs-late culprit (e.g. wrong tool pick in loop 1 vs. wrong reasoning in the last loop). Building that fixture is the **first concrete step** and is itself paper data (RQ: does position-based vs. credit-based attribution disagree, and which is right?).
- 7-type test coverage; runnable example; guide. The eligibility-trace math gets property tests (credit conservation, λ=0 ⇒ reduces to per-step, λ=1 ⇒ full backward flow).

## Estimated work & sequencing

1. **Multi-loop CTXBUG fixture** (planting harness) — gates everything; also paper data.
2. **Trajectory assembler** over the commit log / `runtimeStageId` (a recorder in `observe`).
3. **`scoreTrajectoryInfluence`** + goal-similarity estimator (default) — the cheap path.
4. **ablation-MC estimator** + AttriBoT-style caching — the causal path + the seed-variance band.
5. Measure position-based (current DEPTH) vs. credit-based on the fixture; write up.

Steps 1–3 are the minimum viable per-loop scorer; 4–5 are the causal + paper-grade extension.


---

## Cross-loop propagation mechanism (v1.1 refinement)

This section answers three questions raised about cross-loop influence and specifies the mechanism precisely enough to implement later. It is a **design pass only** — no implementation code.

### The three questions, answered plainly

**1. Do we contrast per loop today?** No. The shipped contrastive scorer (`scoreContrastiveInfluence`) runs **once**, at the end of a run, scoring every source against **one** final answer minus **one** reference. Nothing calls it per loop iteration. The good news: per-loop contrasting needs **no scorer rewrite** — the function only needs a different answer/reference text pair, which a thin per-loop driver supplies.

**2. Do we have a cross-loop mechanism today?** No. The library *records* everything needed (per-stage write log in the commit log, a unique `runtimeStageId` per iteration, the runtime parent link `parentRuntimeStageId`, the backward causal-chain DAG, and control-dependency edges), but there is **no assembler** that groups records into ordered loop iterations, **no propagator** that carries one loop's influence into the next, and **no per-loop weigher**. The one shipped aggregator (`computePathScores`) walks **backward only** and uses **max-product** (a "strongest single path" rule) — the wrong shape for "a source's total = its own influence **plus** what it carried forward."

> **Substrate correction (verified in source).** The engine field `TraversalContext.loopIteration` is *declared* but **never populated by the engine** — it is computed only inside one narrative renderer and is **absent from `CommitBundle`**. Loop grouping must therefore be **derived** from `runtimeStageId`: a repeated loop-anchor `stageId` with an ascending `#executionIndex` *is* the loop counter (use the exported `parseRuntimeStageId`), chained across iterations by `parentRuntimeStageId`. Any design that buckets by `loopIteration` is built on a phantom field.

**3. How should previous-loop influence flow?** Anchor on the **user's question**; score **each loop**; **propagate** the prior loop's accumulated influence forward into the next loop; **aggregate** to one score per source. A source entering at loop 1 earns credit there *and* a fading share of credit at every later loop it helped enable, because each loop is literally built from the previous loop's output.

### Recommended mechanism — `scoreTrajectoryInfluence`

A **question-anchored forward eligibility trace**, gated by real causal reachability, with a per-loop contrast and an opt-in causal rung. Forward is the user-facing direction; one backward construction step is reused only to obtain real dependency edges.

**Step 0 — Assemble the trajectory (new, pure read; zero new capture).** Walk `getSnapshot().commitLog`; derive loop iterations from `runtimeStageId` (`parseRuntimeStageId` → repeated stage id + ascending execution index), chained by `parentRuntimeStageId`. Emit per loop a `LoopFrame { loopIndex, llmCallId, intermediateText (stepOutputText), contextUnits[] (live sources via findLastWriter + commitValueAt) }`. Specify and unit-test a loop-segmentation rule for multi-stage bodies and nested subflows.

**Step 1 — Anchor on the question.** Embed the run input once (`getArgs()` / root `InOutEntry.payload`, `__root__#0`). Inject it as a synthetic reference node. Because `args` reads are **untracked** (`untrackedSources: 'args'`), stamp `incompleteSources:['args']` on every consuming node and a slice-level **`forward-anchor:injected`** flag — the question→first-source link is a proxy, never a recorded dependency.

**Step 2 — One backward slice for real edges (reuse `causalChain` verbatim).** Root at the answer step; pass `controlDeps = controlDepRecorder().asLookup()` so a loop's tool-choice decision enters as a `kind:'control'` edge (the "wrong early tool pick is the whole cause" case). Inherit `truncated` / `incompleteSources` honesty (OR `truncated` across all loop slices). If `controlDeps` is absent, surface a `no-control-deps` flag — never degrade early-source attribution silently.

**Step 3 — Derive a forward reachability GATE.** `flattenCausalDAG` enumerates each node once; reverse `parentEdges` into a writer→reader adjacency. A source whose forward reach touches no later loop is gated to ~0 regardless of question-similarity. **This fixes the backward-only blind spot by structural reachability — not by multiplying two similarity proxies** (the rejected `forward × backward` form amplifies topical look-alikes).

**Step 4 — Per-loop contrast (the speed-tier weight).** Per `LoopFrame`, call `scoreContrastiveInfluence(answerText = loopN-intermediate, referenceText = question | aligned-reference-run-loopN)` over live, reachable sources. `FA_N(e) = sim(e, loopN-state) − sim(e, reference)` isolates what each source added to **this loop's** progress beyond restating the question. Keep the sign (a source the loop contradicts is informative); clamp only at final normalization.

**Step 5 — EdgeWeigher bridge (optional).** To expose a weighted forward DAG, stamp `score_N` via the `EdgeWeigher` seam — but it is **synchronous** and the scorer is **async**, so use the proven **prime-then-reslice** two-pass (`await weigher.prime(unweightedSlice)` to batch-embed, then re-slice with the sync `weigh`), exactly as `llmEdgeWeigher` does. A throwing weigher degrades to 1.0 (engine-isolated).

**Step 6 — Forward eligibility propagation (the one new combinator).** Running per-source eligibility: `contribution_N(src) = score_N(src) + λ · carry_{N-1}(src)`, carry decaying at λ and **zeroed** when a source leaves the context window. `λ=0` → per-loop only; `λ=1` → full forward flow; default `λ≈0.7` (**uncalibrated until the fixture below exists**). Because the slice is a **merging DAG**, the additive sum must finalize each node before any parent consumes it and count each edge **exactly once** (reverse-topological, ascending execution index) to avoid double-counting — this invariant must be written down and unit-proven on a re-convergent fixture. Reset on new `runId` (Convention 4).

**Step 7 — Aggregate to `InfluenceScore[]`.** `final(src)` = normalized eligibility sum (combinator pluggable: `eligibility` default | `max` | `last`). Emit the **same `InfluenceScore[]` shape** plus a per-source forward track and `reachedAnswer`, so `rankingConfidence` and the ablation tier compose unchanged. **Scale honesty:** eligibility-summed scores do **not** inherit the calibrated `clearWinner` margin (0.05, tuned for raw composite scores) — trust the **ranking**, and recalibrate the margin for this estimator.

**Step 8 — Honesty + stability.** Default `mode:'correlational'` (embedding geometry, never causal); surface `incompleteSources:['args']`, `forward-anchor:injected`, `no-control-deps`, `truncated`. Opt-in **causal** rung: per-loop ablation re-runs the chain forward N seeded times with the source removed at its loop, measuring flip-rate on **both** the per-loop intermediate **and** the final answer (`verdictFor`, forced inconclusive on an unstable baseline). Note honestly that per-loop ablation needs a **loop-scoped ablation contract** (the shipped `AblationSpec` excludes a source for the whole run and returns one output) — real net-new work. Stability: seeded re-runs (`resolveSamples` clamps ≥2) → per-loop flip-rate + stdev (`similarityStats`), aggregated to a per-source confidence; rank-flippers demoted to shortlist. **A deterministic embedder gives a degenerate band at the speed tier — the genuine variance band is a causal-tier artifact.**

### Honesty ladder (unchanged identity)

| Tier | Buys | How |
|---|---|---|
| **Correlational (default)** | Speed | Per-loop contrast + reachability gate + eligibility sum over an injected embedder. "Plausible forward influence path", never "because." |
| **Causal (opt-in)** | Truth | Per-loop seeded ablation (`runAblationProbe`/`verdictFor`); re-run forward with the source removed; the only tier that says "because." |

Non-determinism is handled, not pretended away: ≥2 seeded re-runs, variance/flip bands, inconclusive on unstable baselines.

### Real substrate primitives this builds on

`causalChain`, `CausalEdge.weight` + `EdgeWeigher` (sync; throw-isolated to 1.0), `controlDeps` + `ControlDepRecorder.asLookup()`, `flattenCausalDAG`, `commitLog`/`CommitBundle` + `findLastWriter` + `commitValueAt`, `parseRuntimeStageId` + `runtimeStageId` + `parentRuntimeStageId` (**derive** loop buckets — `loopIteration` is unpopulated), `stepOutputText`, `scoreContrastiveInfluence` (per-loop driver), `InfluenceScore`/`EvidenceInput.ancestorTexts`, `runAblationProbe`/`similarityStats`/`verdictFor`/`resolveSamples`, `rankingConfidence`, the root `InOutEntry` payload for the question anchor. **Genuinely new:** the trajectory assembler, the reachability gate, the additive λ-eligibility combinator (with the merging-DAG no-double-count invariant), the per-loop contrast driver, and a loop-scoped ablation contract.

### Gating step (library-first): the validation fixture

Before trusting `λ`, the combinator, or the "forward beats position-based" claim, build the **multi-loop CTXBUG fixture** with a plantable early-vs-late culprit (wrong tool pick at loop 1 vs wrong reasoning at loop K). It does not exist yet. Per project priority, **this fixture precedes implementation** and calibrates the defaults.

## Strategy menu — pluggable influence/credit, each grounded in a published method

> **The library's pitch (consumer-facing): we record the real per-loop agent trajectory and expose ONE honest, pluggable influence/credit slot. You pick the strategy — ours or a published one — and you don't have to know in advance which helps; the benchmark (CTXBUG) measures it for your setting. The optionality is the feature.**

Every strategy returns the same `InfluenceScore[]` shape, so `rankingConfidence` and the ablation tier compose on all of them unchanged. Each is labeled by **tier** on the honesty ladder (proxy = fast/correlational; causal = real seeded re-runs).

| Strategy (pluggable) | Grounding paper(s) | Tier | Status |
|---|---|---|---|
| **four-signal embedding** (FA/AVG/PERSIST/DEPTH) | Visible Reasoning / FDL influence | proxy | shipped (`scoreInfluence`) |
| **contrastive** (sim-to-answer − sim-to-reference) | our confound fix; baseline-subtraction shape, cf. advantage `A=Q−V` | proxy | shipped 6.31.0 (`scoreContrastiveInfluence`) |
| **per-loop contrastive trajectory** (this proposal, default) | Thought Anchors / Thought Branches (per-step contrast); CUE-R (per-evidence perturbation; *relevance ≠ utility*); FlowTracer (question-virtual-source, forward conservation) | proxy | proposed |
| **context-attribution** | ContextCite (Cohen-Wang et al.); TracLLM | causal-surrogate | adapter |
| **scaled ablation** | AttriBoT (>300× LOO speedup); CAMAB (Thompson-sampling budget) | causal | partial (`localizeContextBug`) |
| **per-step credit** | AgentPRM (promise/progress, `A=Q−V`); GRPO-λ (eligibility-trace λ-return) | causal, inference-time-estimable | proposed (the λ-eligibility core above) |
| **turn-credit** | C3 (counterfactual LOO); SCAR (Shapley over reasoning segments) | causal | adapter |

Deliberately **rejected** as a default: QAFlow's `forward × backward` *multiply* of two cosine proxies — the adversarial panel flagged it amplifies topical look-alikes. We **gate** by forward reachability and **weigh** by per-loop contrast instead; we never multiply two similarity proxies.

## Paper positioning

The contribution is **not** "our scorer beats theirs." It is: **footprint.js makes these published influence/credit methods *pluggable and runnable on real, recorded agent trajectories*, behind one honest interface with a clear proxy-vs-causal ladder — and CTXBUG lets you measure which strategy wins for *your* agent.** This is generous (it cites and hosts the field's methods rather than competing with them), defensible (the substrate + the honest interface + the benchmark are the novelty, not a single number), and matches the design intent: the consumer picks the strategy of their choice; the library supplies the trajectory, the slot, the honesty markers, and the measuring instrument.

## Library finding surfaced by this design pass (library-first)

The adversarial panel verified a real defect while grounding the mechanism in source: **`TraversalContext.loopIteration` was declared but never populated by the engine** — it was computed only inside one narrative renderer and is absent from `CommitBundle`. Any consumer bucketing by it was reading a phantom field.

**RESOLVED (footprintjs, 2026-06-16) — option (a), TraversalContext half.** The traverser now stamps `loopIteration` on every emitted context: a run-scoped visit-count map keyed by `stageId`, owned by the executor as the twin of `_executionCounter` (reset on fresh `run()`, **preserved across `resume()`**), shared across subflow re-mounts, `loopIteration = visitCount > 1 ? visitCount − 1 : undefined`, populated for every stage kind. Conditional-spread → byte-identical events on non-looping charts; the narrative recorder keeps its own count → narrative output unchanged. 8-test coverage (sequence, byte-stability, narrative agreement, run-scoping, looped decider, property, resume-continuity, load); full suite 3202 green.

**Still gated (CommitBundle half + `forkBranch`):** putting `loopIteration` on `CommitBundle` would let the *commit-log-based* assembler read it directly instead of deriving from `runtimeStageId` — but that widens the public trace schema, so it's a separate decision. `TraversalContext.forkBranch` is the same kind of declared phantom (which fork/decider branch a stage ran under) — not fixed here. Both deferred until the assembler is built.

## Decision-node scoring — separating a wrong decision's CAUSE (context vs model)

The per-loop scorer above attributes influence to **context sources**. But in an
LLM agent the **error points are the per-loop DECISIONS** — and a wrong decision
needs its *cause* localized, not just its existence flagged. Two error shapes:

1. **Tool-selection decision** — each loop the LLM picks *which tool* to call from
   the prior state (the user's question, or a previous tool's output). A wrong
   pick is the error.
2. **Skill-instruction-driven decision** — if a prior tool returned a *skill
   instruction*, the LLM acts on it. A **wrong skill instruction → wrong tool
   call**: the error is *caused upstream* (bad instruction) but *manifests* as a
   wrong decision.

**Why this matters: it separates a context bug from a model bug.** A wrong
decision at loop N is either (a) **context bug** — the decision was fed something
wrong (bad skill instruction, misleading prior tool output) → fix the context; or
(b) **model bug** — the context was fine, the model still chose wrong → fix the
model/prompt. Final-answer similarity cannot tell these apart; **scoring the
decision and what it read** can. This is the paper's thesis pushed down to the
per-loop decision.

### The three primitives already exist — this is wiring, not new capture

1. **`decide()` / `select()` evidence capture** — a decider's choice already
   records *which values led to it* (rides on `onDecision`/`onSelected` as
   `evidence`). For a wrong tool pick, we can see exactly what it read —
   *including the skill instruction*.
2. **Control-dependency edges** (`controlDepRecorder`, D5) — answers "which
   decision allowed this stage to run?"; `ctrl.asLookup()` is the `controlDeps`
   option to `causalChain`, so a wrong downstream action links back to the
   governing loop-N decision as a `kind:'control'` edge.
3. **The per-loop trajectory scorer** (above) — with `loopIteration` now
   populated by the engine, loops are groupable and a bad answer is attributable
   to a specific loop's decision.

### The localization chain

```
wrong final answer
  → governing DECISION at loop N        (control-dependency edge)
  → the EVIDENCE that decision read      (decide()/select() capture)
  → is a culprit among it?               (per-loop contrast over the evidence)
      • a skill instruction / prior tool output ranks high → CONTEXT bug at loop N
      • nothing in the evidence ranks    → MODEL bug at loop N (reasoning, not input)
  → PROVE it (truth tier)                (ablate/replace just that skill instruction
                                          at loop N, re-run, watch the decision flip)
```

The scorer therefore emits, per loop, not only context-source scores but a
**decision verdict**: `{ loopIndex, decision, topEvidence, cause: 'context' |
'model' | 'inconclusive' }`. `cause:'context'` names the specific instruction /
tool-output to fix; `cause:'model'` says the inputs were clean — escalate to the
prompt/model. Honesty ladder unchanged: the proxy *ranks* the decision's evidence;
only the ablation rung *proves* a skill instruction caused the wrong pick.

> Open design point (gated): a decision's evidence is captured on the
> `onDecision`/`onSelected` event, not in the commit log. The decision-scoring
> tier therefore reads the **flow event stream** (or `controlDepRecorder`'s
> lookup), where the per-loop *context-source* tier reads the **commit log** —
> the assembler must join the two by `runtimeStageId`. Specify that join.

---

## The decision-under-ambiguity model (research foundation)

> **Citation discipline.** This section follows the CTXBUG paper's convention: every external citation carries a `[CITE: … — VERIFY]` tag and is *positioning*, not *proof*, until pulled from its primary source. Two were read directly in this pass and are marked `[VERIFIED-PRIMARY]`; the rest are anchored to the peer-reviewed core. The load-bearing claims rest on **code-verified internal anchors** (file:line into the shipped library), so the argument survives even if half the external literature is re-tagged on review. Numeric figures from recent or future-dated preprints have been removed, not paraphrased.

### 1. The object of study: a content-driven decision, taken under ambiguity, mid-loop

We model one iteration of an LLM agent loop as a **content-driven decision**. At loop *N* the agent holds a context *C_N* — an ordered sequence of content units (the user message, intermediate reasoning, prior tool outputs, role and system text) — and from a set of candidate actions *A_N = {a₁, …, a_k}* (the tools it may call) it selects one, *a\*_N*. The chosen tool runs and appends its output to the context, producing *C_{N+1}*. The loop is the recurrence

> *C₀ = q* (the question); &nbsp; *a\*_N = decide(C_N, A_N)*; &nbsp; *o_N = tool(a\*_N)*; &nbsp; *C_{N+1} = C_N ‖ o_N*,

terminating when the agent emits an answer instead of a tool call. **The tool exists to fetch more content** — that is what makes the loop a content-acquisition process, and it is why the decision at each step is the unit that matters.

In plain language: each turn, the agent looks at everything it has so far and guesses which tool will get it closer to an answer; the tool's result becomes new "everything it has so far" for the next guess. Three modelling commitments, each faithful to how the underlying mechanism actually operates, fix the rest of the formalism.

**(C-content) Everything the decision reads is content.** There is no privileged non-content input to *a\*_N*. A message, a role marker, and a prior tool output all sit in one positional token stream and are governed by the same position machinery; the position curve and rotary-encoding decay act on *sequence position*, not on semantic role `[CITE: Lost in the Middle, Liu et al. 2023/TACL 2024 — VERIFY]`. This is the inventor's "everything-is-content" claim, and it is faithful to the mechanism rather than a simplification. The library represents the decision's inputs exactly this way: `decide()`/`select()` capture *every value the decider read* as decision evidence (`footPrint/src/lib/decide/`), and the four-signal scorer models each readable piece uniformly as an `EvidenceInput { id, text, ancestorTexts }` (`agentfootprint/src/lib/influence-core/types.ts:177`, `:187`). A tool result, a message, and a skill instruction are all "text + id"; there is no second channel the scorer special-cases.
*The one honest hole:* `getArgs()`/`getEnv()` reads are **untracked** by the commit log, so a question read directly via `getArgs()` is invisible to the trajectory assembler and must be re-injected as a synthetic node flagged `incompleteSources:['args']` (proposal-003:127). The "no input that is not content" model is true semantically, but the substrate has untracked content paths the scorer must **flag, not silently miss**.

**(C-recency) Position is a prior over influence, never a measurement of it.** The inventor's "recency dominates" is a genuine architectural tendency, with a mechanism: rotary positional encodings make the query–key dot product decay with token distance, softmax turns that into smaller attention mass on distant tokens, and causal masking biases deeper layers toward earlier positions; the aggregate is the lost-in-the-middle U-shape with a dominant recency end `[CITE: position-bias-emergence analyses, arXiv:2502.01951; Found in the Middle, arXiv:2406.16008 — VERIFY (preprint, supporting intuition only)]`. Crucially, because this bias is *content-independent*, it is a **structural prior over where the deciding content probably sits — never a per-instance measurement of what drove a given decision.** Two caveats the model must carry, both load-bearing for honesty:
- *Direction is model-specific.* Recency is the dominant case but not universal — some models skew primacy `[CITE: serial-position studies, arXiv:2406.15981 — VERIFY]`. So the recency prior is a measured, **per-model-configurable weight**, not a constant.
- *Attention ≠ influence.* "Recent content gets more attention mass" is one inferential step removed from "recent content caused *this* decision"; high attention to first-token attention sinks is often a near-no-op. The architectural grounding is suggestive, not a per-decision causal measurement.

We therefore admit recency strictly as a search-ordering and weighting prior, never as a value inside an influence score (§5).

### 2. Ambiguity as flatness, made precise — the central connection

When several pieces of content are similar and competing, the model cannot cleanly separate a winner and must **guess which to act on**. That guess-under-similarity is the error moment. The claim this section advances is that *this moment has a measurable, already-shipped signature*: a **flat top** in the library's `rankingConfidence`.

Let a scoring function assign each candidate *aᵢ* (or each read source) a real score *sᵢ*, ordered *s₍₁₎ ≥ s₍₂₎ ≥ …*. Define the **margin** and the **ambiguity indicator**:

> *m = s₍₁₎ − s₍₂₎*, &nbsp;&nbsp; *𝒜_τ = 𝟙[ m < τ ]*.

*𝒜_τ = 1* — a flat top — is the formal statement of "several pieces of content competed and the model had to guess." This is not a metaphor: the library computes exactly this predicate. `rankingConfidence` sorts the scores descending and reports `margin = score(#1) − score(#2)` (`attributability.ts:157`), delegating the decisiveness test to a pluggable `ConfidenceStrategy`; the default `marginStrategy(τ)` returns `s[0] − s[1] >= τ` (`attributability.ts:45`), so **`clearWinner === false  ⇔  𝒜_τ = 1`**. The scale-invariant `ratioStrategy` replaces the absolute gap with *(s₍₁₎ − s₍₂₎)/|s₍₁₎|* (`attributability.ts:59`), transferring across embedders where the absolute margin does not; a consumer may inject an entropy/dispersion strategy through the same seam (`types.ts:74`) — the bridge to *semantic entropy*, where ambiguity is entropy over meaning-clusters of the model's own samples `[CITE: Kuhn, Gal & Farquhar, ICLR 2023, arXiv:2302.09664 — VERIFY]`.

The library already names this object in its own words. The `clearWinner:false` reason string ends: *"a flat top can also mean genuinely co-equal sources"* (`attributability.ts:187`). **"Genuinely co-equal sources" is precisely the inventor's "several similar/competing pieces."** The slip is therefore the existing `clearWinner:false` branch — *measured, not invented*.

That flatness is, in the literature, the recognized trigger for the slip across three independent domains. Option-order sensitivity *"arises when LLMs are uncertain about the prediction between the top-2/3 choices, and specific options placements may favor certain prediction between those top choices"* `[CITE: Pezeshkpour & Hruschka, NAACL 2024 Findings, arXiv:2308.11483 — VERIFIED-PRIMARY]` — when no candidate clearly wins, the tie-break collapses onto position. A flat/multi-modal action distribution predicts robot-policy failure without failure labels `[CITE: FiPER, arXiv:2510.09459 — VERIFY (preprint, corroborating)]`. Selective prediction abstains on a small top-1−top-2 margin `[CITE: Know Your Limits, TACL 2024 — VERIFY]`.

**The disciplined cross-domain statement (and its honesty boundary).** What these literatures *agree on* is that **low separation among competing candidates = ambiguity, and the signal is flatness (no dominant mode), explicitly not a low absolute score.** They do **not** all show "flatness predicts failure": only the methods that read the model's *own output/action/sample distribution* show that. `rankingConfidence` reads flatness over a **different distribution** — an embedding-similarity ranking over context. That flatness in the *context-influence* ranking has the same predictive relationship to error as flatness in the *output* distribution is the **synthesis hypothesis this work makes**, to be *tested* on the CTXBUG benchmark, not a transferred result. This is the genuinely novel ground, and we state it as a hypothesis throughout.

A second hypothesis, also CTXBUG-testable, sits under the central connection: *that similar content actually produces a flat top.* When several sources are topically co-equal, their embedding-geometry signals cluster — similar content embeds to similar cosines — and a tight cluster at the top is a sub-threshold margin. But the **composite** folds AVG/PERSIST/DEPTH alongside FA (`signals.ts:18–25`), and two topical twins can diverge sharply on PERSIST (breadth of reference) or DEPTH (trace position). So "similar content ⇒ flat top" is the central *empirical expectation* this section advances, not a definitional identity — which is exactly why contrast (§3) and ablation (§6) are required backstops.

### 3. Contrastive scoring cancels the similar-content confound

A flat top is ambiguous between two readings: co-equal *because everything is topically relevant* (an innocent flat top) versus co-equal *because there are genuinely competing culprits* (the real slip). The confound is real: surface topical similarity is a strong driver of tool selection `[CITE: BiasBusters, arXiv:2510.00307 — VERIFIED-PRIMARY]`, and relevant-vs-irrelevant tool-description embeddings can have overlapping cosine distributions, so cosine alone cannot separate them `[CITE: Tool2Vec, arXiv:2409.02141 — VERIFY]`; the RAG twin is the distracting effect, where passages similar-but-irrelevant to the query degrade accuracy `[CITE: The Distracting Effect, ACL 2025, arXiv:2505.06914 — VERIFY]`.

`scoreContrastiveInfluence` is the library's de-confounder. It replaces only the FA term with *FA(e) = sim(e, answer) − sim(e, reference)* (`contrastive.ts:94`), keeping AVG/PERSIST/DEPTH and the composite verbatim so `rankingConfidence` composes on it unchanged (`contrastive.ts:6`). A topical innocent the decision is merely *about* resembles **both** a good and a bad output, so it cancels to ~0; the piece similar to the *wrong* output specifically survives. This is what disambiguates the two flat-top readings.

**Honesty rung (proxy) and scope.** Contrast removes a confound; it does not prove causation — *"still an embedding-geometry PROXY, never causal — the contrast removes a confound, it does not prove causation. Ablation is the causal tier"* (`contrastive.ts:26`). It is also **opt-in**: it needs a reference output (a known-good / expected / prior-good run), so it serves regression/eval debugging, not cold localization (`contrastive.ts:28–30`). The field's own corroboration is sharp: reducing competing candidates by *similarity alone* under-resolves wrong picks, while *causal* (precondition/effect-aware) filtering resolves them — the external endorsement of this library's proxy→ablation discipline `[CITE: ToolChoiceConfusion, arXiv:2606.06284 — UNVERIFIED future-dated preprint; illustration only, no numbers]`.

### 4. The loop, the two error modes, and the slip predicate

The flat top in §2–3 is, *as shipped today*, computed over a **whole run's** sources against **one** final answer (`scoreInfluence`'s FA term is retrospective). The slip, however, happens at a *specific loop's* decision over the content the model was choosing from *at that moment* (prospective). Recovering the loop is what makes "recent vs distant" meaningful — without ordered loops there is no recency.

**The prospective surface already exists.** Decision-time flatness over the *offered* candidates is the shipped `scoreMargin`: *margin = score(best chosen) − score(best non-chosen)* over the candidate set, with a `narrow` flag when `margin < marginThreshold` (default 0.05) and a `proxyDisagreement` flag when the top-scored candidate was not chosen (`margin.ts:60`, `:92`, `:101`). `narrow` is the prospective *𝒜_τ = 1*. One honest subtlety the reviews surfaced: `scoreMargin`'s choice context is *"what the model saw — user message + latest reasoning"* (`margin.ts:13`) — a **recency-truncated slice**. So on the *prospective* surface, recency is already baked into the context window the candidates are ranked against; the off-the-score recency discipline of §5 applies to the *retrospective* influence score, while the prospective scorer approximates the ideal full-context choice with a recency window by construction. We name this rather than double-count it.

**The loop substrate.** Proposal-003 specifies an assembler that recovers the trajectory with *no new capture*: walk `getSnapshot().commitLog`, derive loop iterations from `runtimeStageId` (a repeated loop-anchor `stageId` with ascending `#executionIndex` *is* the loop counter, via `parseRuntimeStageId`, chained by `parentRuntimeStageId`), and emit one `LoopFrame { loopIndex, llmCallId, intermediateText, contextUnits[] }` per loop (proposal-003:125). A library finding made this real: `TraversalContext.loopIteration` was a declared-but-unpopulated phantom; the engine now stamps it on every emitted context (`footPrint/.../FlowchartTraverser.ts:829`; proposal-003:186), so loops are groupable for real. Running `rankingConfidence` over *each loop's* evidence — ideally with per-loop contrast, *FA_N(e) = sim(e, loopN-state) − sim(e, reference)* (proposal-003:133) — makes a flat top mean "the competing pieces the model actually read *this loop* were near-indistinguishable": the true ambiguity slip, localized.

**The two error modes fall out of crossing flatness with wrongness.** Let *W = 𝟙[the decision was wrong]*. The **ambiguity-slip** is *𝒜_τ ∧ W*. Crossing the indicator with wrongness — and crossing prospective flatness with the *retrospective presence of an ablatable culprit* — separates the inventor's two error sources within the existing primitives:

| | content well-separated (*𝒜 = 0*) | content flat (*𝒜 = 1*) |
|---|---|---|
| **a present, high-ranking ablatable suspect in the read evidence** | suspect leads a clear ranking → **context-bug candidate** — *but a sharp rank is model commitment, not correctness: a clear lead is a similarity PROXY, not a proven cause; confirm by ablation* (`attributability.ts:185`) | flat + a surviving contrastive culprit → **context-shaped slip**: the read content was ambiguous and one piece tipped it wrong — ablate the shortlist (the runner-up is guaranteed in it, `attributability.ts:180`) |
| **clean evidence, no surviving suspect** | clear winner existed, model chose against it → **model-bug** candidate — *fix the prompt/model prior, not the context* | flat with nothing standing out → **inconclusive / absence-or-model**: either the model could not decide, or an *absence/crowding* culprit displaced the right content and does not resemble the answer |

This is proposal-003's decision verdict `{ loopIndex, decision, topEvidence, cause: 'context' | 'model' | 'inconclusive' }` (proposal-003:240) stated as a 2×2. The split is empirically attested: presentation effects (the model leaning on *order*) are separable from provider fixation (a bad prior with clean inputs) `[CITE: BiasBusters, arXiv:2510.00307 — VERIFIED-PRIMARY]` — though that study is a *single* pick over a *static* catalog, so it confirms the modes **exist** at tool-pick time without validating the per-iteration claim. The library can make the split *only because* `rankingConfidence` reports flatness honestly instead of always emitting a confident rank-1.

**Why per-loop and not flat depth-decay.** Uncertainty at a *critical junction* matters far more than equal uncertainty elsewhere, and intermediate uncertainty predicts final failure before completion `[CITE: UProp, arXiv:2506.17419 — VERIFY (preprint, corroborating)]` — the empirical case against crediting a step by its position in the trace, and for influence-based per-loop credit.

**Three honesty guards bound the table.** *(i)* Cancel the topical innocent (§3) before trusting any cell. *(ii)* The bottom-right cell is the **absence/crowding blind spot**: a culprit that acts by *displacing* content (history truncation, dilution) need not resemble the answer or be recent, so it ranks low — *"similarity scoring is blind to absence/crowding bugs … where the culprit need not resemble the answer"* (`attributability.ts:187`). Hence **`'inconclusive'` is the default**, never `'model'`, on a flat-with-nothing reading; absence bugs need the separate available-vs-sent diff, not the influence ranking. *(iii)* Flatness catches only the **ambiguity subclass** of decision errors. A sharp, non-flat ranking is the model's *commitment*, not its correctness — the confident-and-wrong failure mode (high stated confidence at low accuracy) `[CITE: Know Your Limits, TACL 2024 — VERIFY]` is invisible to flatness and must be carried by contrast and ablation.

### 5. Recency enters only as a prior — wired to the one content-blind slot

The library has exactly one content-blind signal in which a position prior can honestly live: `DEPTH = structuralProximity = 1/(1+ancestorCount)` (`signals.ts:110`), documented as *"the only content-blind signal: pure trace structure"* (`signals.ts:108`). Recency is, by the inventor's own definition, a content-blind position prior, so it belongs in the DEPTH slot — and **never inside FA/AVG/PERSIST**, which are cosine geometry; folding a position prior into a similarity term would corrupt the honest "this is embedding geometry" claim (`signals.ts:13–25`). Two disciplined attachment sites:

- **Per-loop temporal kernel** (single-call fallback): replace or blend DEPTH with a recency decay over loop position, *r(e) = ρ^(N − ℓ_e)*, normalized to (0,1] so it shares DEPTH's range, where *ℓ_e* is the loop a source entered. This rides the δ weight (default 0.10, `types.ts:50`). One care: the adaptive-weight path that redistributes mass for no-ancestor items must keep DEPTH defined (1.0 for the most-recent item) or the ratio preservation breaks (`signals.ts:119`).
- **Eligibility-trace λ** (preferred, the loop case): in proposal-003's forward combinator *contribution_N(e) = score_N(e) + λ · carry_{N-1}(e)*, the λ-decay *is* recency-dominance expressed temporally — a source's influence fades by λ per loop and is **zeroed when it leaves the context window** (directly encoding "content available at this moment"). This is the temporal generalization of DEPTH and a direct echo of RL eligibility traces, here carrying *influence scores* rather than reward. Default *λ ≈ 0.7* is **uncalibrated** (proposal-003:137).

**Honesty rung (prior — the strictest).** Recency *orders and weights* proxies; it is never reported as evidence that the recent piece *caused* the choice. A recency-favored top-1 with a thin margin still earns the same `clearWinner:false → ablation` escalation. Recency changes the *order*, never the causal verdict — mirroring the field's own causal move, where position bias becomes a causal claim only by *swapping and re-running* `[CITE: LLM-as-judge position bias, Zheng et al., NeurIPS 2023, arXiv:2306.05685 — VERIFY]`.

### 6. The causal tier, and what is shipped vs. hypothesis

Every proxy above **screens** for the slip; only **ablation** confirms it. Confirming an ambiguity slip causally means re-running with one competing piece removed or disambiguated *at its loop* and watching the flat top resolve and the decision flip. The library's ablation tier already enforces the right discipline: `runAblationProbe` re-runs N seeded times (`ablation.ts:192`), `resolveSamples` clamps to ≥2 — *no single-run verdicts* (`ablation.ts:148`), and `verdictFor` returns **INCONCLUSIVE when the un-ablated baseline itself flips across seeds** (`ablation.ts:224`, `:235`). Without a consumer-supplied runner, the localizer stops at `mode: 'correlational'` — explicitly a ranking of proxies, no causal claim (`localize.ts:24`, `:533`).

The honest gap is precise: the shipped `AblationSpec` excludes a source for the **whole run** and returns **one** output; a **loop-scoped** contract (exclude a source at loop N, re-decide, measure flip-rate on both the per-loop intermediate and the final answer) is *"real net-new work"* (proposal-003:141, :154). So the proxy screen (a per-loop flat top) has, today, no matching per-loop causal confirmer.

**Stability caveat — the least-grounded rung.** Ablation is causal only if the baseline is stable across seeds; for stochastic decisions a single ablation can flip from sampling noise. The seed-variance band is the right mitigation, and the *run-scoped* tier already implements the seeded-rerun discipline (≥2 seeds, inconclusive-on-unstable-baseline). A deterministic embedder gives a degenerate (zero-width) band at the speed tier; the genuine variance band is a **causal-tier artifact** (proposal-003:141). The novelty is the *loop-scoped* band, not inventing seed discipline from scratch — and no off-the-shelf method exists for attribution stability under non-determinism, which is both the honest limit and the open opening.

**Build-status ledger (so "designed" is precise).**

| Layer | Status | Honesty tier |
|---|---|---|
| `scoreInfluence` (four-signal), `scoreContrastiveInfluence`, `rankingConfidence` flat-top, `scoreMargin` prospective `narrow` | **Shipped** (`influence-core`) | correlational **proxy** |
| weighted causal slice: `causalChain` backward program slice `[CITE: Weiser 1984; thin slicing, Sridharan et al. 2007 — VERIFY]` + control edges + `llmEdgeWeigher` | **Shipped** (`footPrint/.../backtrack.ts:4,:121`; `context-bisect/llmEdgeWeigher.ts:26`) | proxy weights, provable slice structure |
| run-scoped ablation tier: `runAblationProbe` / `verdictFor` / `resolveSamples`; `localizeContextBug` 5-stage pipeline | **Shipped**; stops at `mode:'correlational'` without an `AblationRunner` | **causal** only at the ablation stage |
| `TraversalContext.loopIteration` engine population | **Shipped** (`FlowchartTraverser.ts:829`) | substrate (the prerequisite that landed) |
| LoopFrame trajectory assembler, per-loop contrast driver, λ-eligibility combinator, decision-node `{cause}` verdict | **Designed, gated, not built** | designed; calibration gated on the multi-loop fixture |
| loop-scoped `AblationSpec`; the commit-log ↔ flow-event join by `runtimeStageId` | **Net-new contract** (open design point, proposal-003:250) | causal (loop-scoped), unspecified |

### 7. The model, assembled

A per-loop decision *a\*_N = decide(C_N, A_N)* over content-only inputs **slips** when the candidate set is **flat**, *𝒜_τ(C_N, A_N) = 1*, among content weighted by a *measured-not-assumed, per-model* recency prior, and the chosen action is wrong. The slip is a **context bug** when a contrastively-isolated, ablation-confirmed culprit sits in the read evidence; a **model bug** when the evidence is clean (a clear winner or no surviving suspect) yet the pick is wrong; and **inconclusive** — *defaulting here, never to "model"* — whenever the proxy is flat with nothing surviving (the absence/crowding case) or the ablation baseline is unstable. In one line:

> **Flatness screens; contrast de-confounds; recency orders; ablation confirms.**

CTXBUG is the measuring instrument, not the contribution: a benchmark of agent runs with **plantable early-vs-late context culprits across loop iterations** (wrong tool pick at loop 1 vs. wrong reasoning at loop K), on which the four claims become falsifiable — ablating the top-ranked suspect should flip the outcome significantly more often than ablating the bottom-ranked, *reported with seed variance*. Calibration of τ (flat-top threshold), the shortlist band, and λ (recency) is **uncalibrated and embedder/model-relative** — the 0.05 margin is *"an ABSOLUTE difference … EMBEDDER-RELATIVE"* and its numeric coincidence with the `scoreMargin` threshold is *"NOT a shared derivation"* (`types.ts:70–74`), and eligibility-summed trajectory scores do not inherit the calibrated margin (proposal-003:139). So: **trust the ranking order; recalibrate the boolean on the target embedder via CTXBUG**; never import the cited papers' numeric thresholds as defaults. Per the project's library-first priority, this multi-loop fixture **precedes** implementation — it both calibrates the defaults and reveals where the *library* underperforms (proposal-003:158).

A final scope honesty matching the framing of this as novel ground: the strongest external evidence is single-shot retrieval, multiple-choice, or pairwise-judge; the closest agent-tool-selection result is a single pick over a static catalog. That the *same* flat-top/position mechanism governs *each loop iteration* of the content→decide→tool→content loop is a well-motivated extrapolation this work formalizes and CTXBUG must test — not a result already in hand.

## Score tracing — the model-agnostic propagation engine

The decision-under-ambiguity model scores **one** decision. *Tracing* turns those
per-decision scores into a final-answer attribution — and the load-bearing property
is that **tracing is model-agnostic**: it takes each leaf score `d_N(e)` ("how much
content piece `e` influenced loop N's decision") as a **black box**, however it was
produced — external cosine, API logprob shift, white-box attention, or ablation
flip-rate — and propagates it the same way. One tracer, many score sources; this is
the pluggable-strategy design made concrete.

**The propagation.** A piece `e`'s influence on the final answer (loop K) is its
direct influence plus everything it carried forward through the decision chain:

```
F(e) = d_K(e)                                       ← direct: e still live at the answer
     + Σ over loops N (e live & forward-reachable):
              d_N(e) · w(N → K)                      ← mediated: e drove loop N's decision,
                                                       which shaped loop N+1 … → the answer
```

`w(N → K)` — how strongly loop N's decision carries to the final answer — is the one
design knob, with two honest settings:

- **recency decay** `w = λ^(K−N)` — the §5 eligibility-trace λ; the inventor's
  "recent content dominates" expressed temporally. A *prior*, cheap.
- **measured per-hop carry** `w = Π (hop carries)` — measure how much each decision's
  output actually influenced the *next* decision and multiply along the chain.
  Faithful (reflects the real chain), costlier; a weak hop (the agent ignored a tool
  result) correctly kills the carry.

The forward **reachability gate** (§Step 3) zeroes any `e` no later loop read, so a
topical look-alike that went nowhere cannot accumulate.

**The decision×answer diagnostic — the inventor's "highly correlated" insight, made
usable.** Per-decision influence `d_N(e)` and final-answer influence `F(e)` are
tightly linked because the answer is *built through* the decisions. That linkage is
usable two ways:

1. **Shortcut** — if they correlate, the cheap per-decision scores are a faithful
   proxy for the expensive final-answer influence (no need to re-derive it).
2. **Diagnostic** — place each piece on a 2-D map, *decision-axis* (did it drive a
   decision?) × *answer-axis* (did it reach the answer?):

| | drove a decision | didn't drive a decision |
|---|---|---|
| **reached the answer** | **prime suspect** — drove a decision AND stuck → the context bug | echoed-in-answer fact (content bug, no tool path) |
| **didn't reach the answer** | a decision the agent later recovered from (not the bug) | innocent |

The **correlation coefficient itself is a measurable result**: high → the agent is
*decision-driven* (per-decision scores *are* the explanation); low → something
overrides decisions downstream (the model ignored its own picks, or late content
dominated). This is computable **today on the external-embedder tier — no white-box
needed** — so it is a **Paper A experiment** (below).

Honesty: every leaf `d_N(e)` and the traced `F(e)` are **proxy**. The tracer's job is
to hand ablation a *short, well-ordered* suspect list; only loop-scoped ablation
(change `e` at its loop, re-run, watch the decision flip) proves cause.

## The white-box tier — "the model's own formula" (adds a third row to the strategy menu)

The strategy menu's leaf score `d_N(e)` can come from the model's **own internal
similarity** instead of an outside embedder. A transformer decides via attention
(query·key dot-product), so the most faithful `d_N(e)` is the model's own attention /
logit-attribution over the content present when it emitted the decision token(s) —
the model's *actual path*, not an outsider's guess.

| Tier | Path | Works on | Faithfulness |
|---|---|---|---|
| external embedder | outsider cosine similarity | any model (API) | proxy — cheapest |
| **internal / white-box** | the model's **own** attention / logit attribution | **open / local only** (our Qwen3-4B) | **most faithful proxy** |
| ablation | change input, re-run | any model | **causal** — the truth |

- **Access caveat:** white-box only — needs attention/logits (open/local models; our
  Tier-A **Qwen3-4B via llama.cpp** qualifies). API models give at most logprobs.
- **Honesty:** attention is *not (fully) explanation* (Jain & Wallace 2019 vs
  Wiegreffe & Pinter 2019) — a *more faithful* proxy, still not causal. Stronger
  internal methods: attention-rollout, grad×input / integrated gradients, logit
  attribution, **causal tracing / activation patching** (ROME) — the last genuinely
  "cracks" a decision because it is interventional. Pair internal attribution **with**
  ablation; never treat attention alone as proof.

### The logit / softmax decision distribution — the model's own ambiguity signal

A model decides via a 3-layer chain: **embedding** (encodes *meaning*) → **logit**
(the raw score it gives each candidate) → **softmax** (those scores as
*probabilities* — the decision distribution). **Today's scorer uses only the
embedding layer** (cosine of meaning); it does **not** read logits or softmax. This
is a real gap, because the §2 "ambiguity = flat top" is currently measured over an
*embedding-similarity ranking of the context* — an outsider's proxy — when the **most
direct** ambiguity signal is the model's **own softmax over the candidate tools**: a
near-tie in the top-two tool probabilities *is* the model being uncertain. That is
the genuine slip, not a proxy of it, and confirming the embedding flat-top agrees
with the softmax flat-top is exactly the §2 synthesis hypothesis.

Three ambiguity signals, by directness and access:

| signal | measures | access |
|---|---|---|
| embedding-similarity flatness (`rankingConfidence` today) | outsider: which context *looks* co-equal | any model |
| **softmax / logprob flatness over candidate tools** | the model's **own** uncertainty at the decision | logprobs (API partial) / full (local) |
| semantic entropy (Kuhn, Gal & Farquhar 2023) | sample N times, entropy over meaning-clusters | sampling, no logits needed |

Access mirrors the white-box caveat: full softmax over the tool tokens needs open
weights — our **Qwen3-4B via llama.cpp exposes logprobs**, so it is free there; API
models give only partial top-k. **Plan:** capture the model's softmax/logprobs over
the tool choice in the same fixture runs as the embedding scores — Paper A uses the
embedding signal (no white-box); Paper B compares embedding-flatness *vs* the model's
own softmax-flatness at predicting the slip (the local stack makes it ~$0). Honesty
ladder unchanged: softmax flatness is a *more direct* uncertainty signal, still a
proxy for *which* content caused it — only ablation proves cause.

#### Two softmaxes — and only one needs open weights

A crucial clarification (it shrinks the open-weights dependency to a validation
check, not the method):

- **Softmax over OUR scores — no weights needed, always available.** We already hold
  the content the model saw. Embed each candidate, take our similarity scores `s_i`,
  and apply softmax: `P_ext(i) = exp(s_i/T) / Σ exp(s_j/T)`. A real distribution built
  entirely from embeddings; flat `P_ext` (high entropy) = our scorer says the
  candidates are co-equally relevant = *predicted* ambiguity. Works on **any** model,
  including the large API models we cannot open. This is also a **richer flat-top
  measure than the shipped top-1−top-2 margin** — entropy over the *whole*
  distribution, scale-invariant — so it drops into the `ConfidenceStrategy` seam as an
  **entropy strategy** (one knob: a temperature `1/T`, since cosines occupy a narrow
  range; `T` calibrates like `τ`).
- **Softmax over the MODEL's logits — needs open weights.** `P_model(i) =
  exp(logit_i/T) / Σ exp(logit_j/T)` over the actual tool tokens — the model's *own*
  decision distribution. Flat `P_model` = the *model itself* was uncertain.

These are different objects: `P_ext` is our proxy's confidence; `P_model` is the
model's actual computation. The model's softmax is therefore **not required by the
method** — it is the **reference we validate the proxy against**: Paper B asks whether
external softmax-flatness *agrees* with the model's own softmax-flatness. If yes, the
proxy is validated and production never needs open weights; if no, the gap is the
finding. So `P_ext` is the always-available Paper A signal; `P_model` is the
weights-only Paper B reference; their agreement is the hypothesis.

## Paper split (decided 2026-06-16)

- **Paper A — external-proxy ladder on CTXBUG → the AAAI-27 submission.**
  `scoreInfluence` + contrastive + `rankingConfidence` flat-top + per-loop **score
  tracing** + ablation; model-agnostic; ready now. Includes the **decision×answer
  correlation experiment** (external tier, no white-box).
- **Paper B — "the model's own formula": white-box decision attribution → flagship
  follow-on.** The internal-attention tier above, compared head-to-head with the
  external embedder and ablation on CTXBUG's local stack (~$0). Needs the white-box
  infra (attention extraction from llama.cpp); deserves its own runway, so it is
  *not* rushed into the AAAI deadline.


## The flagship scorer, built as a footprint.js flowchart (design)

> From the 15-agent design pass (`influence-scorer-as-flowchart`): 3 layouts (linear · decider-driven · per-loop-subflow), each adversarially judged on faithful-to-LLM-decision / buildable-on-real-primitives / honest-and-self-explaining. Recommended = a **hybrid**.

### Recommended shape

FLAGSHIP = the PER-LOOP-SUBFLOW spine (Design 3) with the HONESTY LADDER drawn as control flow (Design 2), and three adversarial corrections grafted in. It is a HYBRID scorer-flowchart.

WHY THIS SHAPE: The per-loop subflow + branch-sourced loopTo is the only angle that structurally mirrors the agent it scores (same loop, same back-edge) AND makes every iteration independently addressable by runtimeStageId (the linear angle CANNOT — judges proved its "per-loop addressable" claim false, because a JS for-loop inside one addFunction commits once). Design 2's contribution is that the honesty ladder is literally the tail topology, not a convention. We take both.

THE ORDERED STAGES (one runnable chart):
1. seed-assemble-loopframes (function) — pure-read. Loads { commitLog, finalAnswerText, referenceText?, embedder, keysReadMap, rerun? } via $getArgs. Buckets commitLog into LoopFrame[] by repeated local stageId + ascending #executionIndex (parseRuntimeStageId) — NEVER forkBranch (confirmed phantom). Wraps embedder ONCE in embeddingCache. Flattens scope.hasRerun, scope.hasLocalModel as top-level booleans NOW (so later filter-form deciders work — see Honesty Ladder).
2. score-one-decision (subflow, mounted addSubFlowChartNext, arrayMerge: Replace) — the per-loop heart, run once per iteration. Its children:
   2a. compute-signals (single function — NOT a 4-way selector; see CTXBUG/net-new) — calls scoreContrastiveInfluence when referenceText present, else scoreInfluence. ONE batched embed pass computes all four signals + adaptWeights + compositeScore.
   2b. recency-weight-depth (function) — applies recencyWeight as a POST-MULTIPLIER on the DEPTH term only, AFTER adaptWeights has run on the true ancestorCount (the corrected wiring — see Math).
   2c. softmax-confidence (function) — softmax(scores, T) → P_ext; per-loop rankingConfidence({strategy: entropyStrategy(T)}).
3. more-loops-decider (decider) — FUNCTION-form rule (s)=>s.cursor < s.loopCount-1 (the {lt:'loopCount-1'} filter is INVALID — confirmed). 'continue' branch carries loopTo:'score-one-decision' and advances cursor; 'finalize' is terminal.
4. forward-propagation-aggregate (function, in PARENT after the loop — NOT inside the subflow, so it can read the parent commitLog) — λ-eligibility sum gated by causalChain reachability built from the persisted keysReadMap; degrades to λ=0 when the map is absent.
5. confidence-ambiguity-decider (decider) — THE SPINE. Flattens scope.clearWinner = rc.clearWinner FIRST, then decide([{ when:{clearWinner:{eq:true}}, then:'report-correlational-lead' }], 'run-ablation').
6. report-correlational-lead (plain function branch) — proxy report, {causal:false}, degenerate band marked. Structurally cannot reach a "because" leaf.
7. run-ablation (subflow branch) — routes here ONLY when clearWinner===false AND scope.hasRerun (a nested decider degrades to an honest "ambiguous, no rerun harness — cannot escalate" leaf when the runner is absent). runAblationProbe → verdictFor (sole causal emitter, forced inconclusive on unstable baseline).
8. optional whitebox-validate (subflow branch behind {hasLocalModel:{eq:true}}) — fits T against Qwen3-4B P_model; skipped when absent. This is the ONLY branch licensed to say "approximates the model's distribution."
9. contract-and-build — toSpec/toMermaid/narrative for free.

### Builder skeleton (illustrative — real API, real influence-core calls)

```ts
// ── NET-NEW combinators (tiny pure fns) ──────────────────────────────────
// softmax(scores, T): shift-invariant — exp((s_i - max)/T)/Σ ; handles negative composites.
// recencyWeight(loopIndex, n, halfLife): (0,1]; 1.0 for most-recent.
// entropyStrategy(T): ConfidenceStrategy { name:'entropy', isClearWinner(ranked){ return entropy(softmax(ranked,T)) < bar } }  // drops into the seam, zero rankingConfidence change.

import { flowChart, FlowChartExecutor, decide, ArrayMergeMode } from 'footprintjs';
import { parseRuntimeStageId, causalChain, flattenCausalDAG } from 'footprintjs/trace';
import {
  scoreInfluence, scoreContrastiveInfluence, compositeScore, adaptWeights,
  rankingConfidence, marginStrategy, embeddingCache,
} from 'agentfootprint/influence-core';
import { runAblationProbe, resolveSamples, similarityStats, verdictFor } from 'agentfootprint/context-bisect';

// ── PER-LOOP SUBFLOW: score ONE agent decision ───────────────────────────
const scoreOneDecision = flowChart<LoopState>('Score one decision', async (scope) => {
  const f = scope.$getArgs<LoopFrame & { embedder; refText?; persistT; }>();
  const scored = f.refText
    ? await scoreContrastiveInfluence({ evidence: f.evidence, answerText: f.intermediateAnswerText,
        referenceText: f.refText, embedder: f.embedder, persistenceThreshold: f.persistT, signal: scope.$getEnv().signal })
    : await scoreInfluence({ evidence: f.evidence, finalAnswerText: f.intermediateAnswerText,
        embedder: f.embedder, persistenceThreshold: f.persistT, signal: scope.$getEnv().signal });
  scope.scored = scored;  // tracked → narrative
}, 'compute-signals', { description: 'Fold four proxy signals into one contrastive score per piece (PROXY, never causal).' })
  .addFunction('Recency-weight depth', (scope) => {
    // POST-MULTIPLIER on DEPTH only, AFTER adaptWeights saw the true ancestorCount.
    scope.scored = scope.scored.map((item) => {
      const r = recencyWeight(scope.loopIndex, scope.loopCount, scope.halfLife); // (0,1]
      const eff = adaptWeights(scope.weights, item.ancestorCount).weights;        // ratio invariant intact
      const depthTerm = eff.delta * item.signals.depth * r;                        // r rides δ as a multiplier
      return { ...item, composite: item.composite - eff.delta*item.signals.depth + depthTerm };
    });
  }, 'recency-weight-depth', 'Content-blind position prior — DEPTH slot ONLY, never FA/AVG/PERSIST.')
  .addFunction('Softmax confidence', (scope) => {
    scope.dist = softmax(scope.scored.map(s => s.composite), scope.softmaxT);     // P_ext
    scope.conf = rankingConfidence(scope.scored, { strategy: entropyStrategy(scope.softmaxT) });
  }, 'softmax-confidence', 'Confidence/dispersion of OUR ranking (NOT the model distribution).')
  .build();

// ── ABLATION SUBFLOW (causal tier) — needs an injected rerun runner ──────
const ablationChart = flowChart<AblState>('Run seeded ablation', async (scope) => {
  const { shortlist, rerun, embedder } = scope.$getArgs<{ shortlist; rerun; embedder }>();
  const specs = buildAblationSpecs(shortlist);  // NET-NEW loop-scoped contract (gated, see CTXBUG)
  const stats = await runAblationProbe({ rerun, embedder }, specs);  // resolveSamples clamps ≥2
  scope.verdict = verdictFor('shortlist', stats, stats.baselineStable);  // FORCED inconclusive if unstable
  scope.band = similarityStats(stats.reruns);  // genuine variance band — ONLY here
}, 'ablate').build();

// ── ROOT: per-loop spine + honesty ladder tail ───────────────────────────
const scorer = flowChart<ScorerState>('Assemble loop frames', (scope) => {
  const a = scope.$getArgs<{ commitLog; finalAnswerText; referenceText?; embedder; keysReadMap?; rerun? }>();
  scope.loopFrames = assembleLoopFrames(a.commitLog);  // bucket by runtimeStageId, ascending #idx
  scope.embedder   = embeddingCache(a.embedder);       // wrapped ONCE, shared
  scope.cursor = 0; scope.loopCount = scope.loopFrames.length;
  scope.hasRerun = !!a.rerun; scope.hasLocalModel = !!a.localModel; // FLATTEN for filter deciders
}, 'seed-assemble-loopframes')
  .addSubFlowChartNext('score-one-decision', scoreOneDecision, 'Score one decision', {
    inputMapper: (s) => ({ ...s.loopFrames[s.cursor], embedder: s.embedder, refText: s.referenceText,
                           loopIndex: s.cursor, loopCount: s.loopCount, weights: s.weights,
                           halfLife: s.halfLife, softmaxT: s.softmaxT, persistT: s.persistT }),
    outputMapper: (sub) => ({ perLoopScored: [sub.scored], perLoopConf: [sub.conf] }),
    arrayMerge: ArrayMergeMode.Replace,
  })
  .addDeciderFunction('More loops?', (scope) =>
      decide(scope, [{ when: (s) => s.cursor < s.loopCount - 1, then: 'continue', label: 'More loops to score' }],
             'finalize').branch, 'more-loops-decider')
    .addFunctionBranch('continue', 'Advance to next loop', (s) => { s.cursor += 1; },
                       'Score loop N+1', { loopTo: 'score-one-decision' })
    .addFunctionBranch('finalize', 'Finalize')
    .setDefault('finalize')
    .end()
  .addFunction('Forward-propagation aggregate', (scope) => {
    const a = scope.$getArgs<{ keysReadMap?: Record<string,string[]> }>();
    const getKeysRead = a.keysReadMap ? (id) => a.keysReadMap[id] ?? [] : undefined;
    if (!getKeysRead) { scope.aggregateScores = aggregateLambdaZero(scope.perLoopScored); }  // honest fallback
    else {
      const reach = forwardReachability(scope.commitLog, getKeysRead, causalChain, flattenCausalDAG); // invert backward slice
      scope.aggregateScores = eligibilitySum(scope.perLoopScored, scope.lambda, reach); // contribution_N = score_N + λ·carry_{N-1}, gated
    }
    const rc = rankingConfidence(scope.aggregateScores, { strategy: marginStrategy() }); // recalibrated boolean
    scope.clearWinner = rc.clearWinner; scope.margin = rc.margin;  // FLATTEN for the filter decider
    scope.lead = rc.lead; scope.shortlist = rc.shortlist; scope.reason = rc.reason;
  }, 'forward-propagation-aggregate', 'Sum per-loop credit, recency-decayed, GATED by real dependency edges.')
  .addDeciderFunction('Confidence / ambiguity', (scope) =>
      decide(scope, [{ when: { clearWinner: { eq: true } }, then: 'report-correlational-lead',
                       label: 'Clear winner — trust the proxy lead, never claim cause' }],
             'route-ambiguous').branch, 'confidence-ambiguity-decider')
    .addFunctionBranch('report-correlational-lead', 'Report correlational lead', (s) => {
        s.report = { kind: 'correlational-lead', lead: s.lead, margin: s.margin, reason: s.reason,
                     dist: s.perLoopConf, causal: false, band: 'degenerate' };
      }, 'Proxy lead only — structurally cannot claim cause')
    .addDeciderFunctionBranch('route-ambiguous', /* nested: hasRerun ? ablation : honest-stop */)
    .setDefault('route-ambiguous')
    .end()
  .contract({ output: RankedInfluenceReportSchema, mapper: (s) => s.report })
  .build();

// run: await new FlowChartExecutor(scorer).run({ input, env: { signal } });
// draw: scorer.toMermaid()  /  scorer.toSpec()
```

### Math wiring (existing functions, composed)

EXISTING influence-core composed verbatim; only the wiring + 3 small combinators are new.

PER-LOOP (inside score-one-decision):
- compute-signals: ONE call to scoreContrastiveInfluence (refText present) or scoreInfluence (fallback). Both already do a single deduplicated batch embed over a Set of distinct texts, then a per-item .map computing finalAnswerSimilarity (FA, or faContrast = sim(e,answer)−sim(e,reference)) + averageRelevancy + persistence(T) + structuralProximity, folded by compositeScore under adaptWeights. The four signals are NOT fanned as parallel branches — doing so would re-embed per branch (destroying the dedup + shared EmbeddingCache) or duplicate work scoreContrastiveInfluence already does (confirmed signals.ts batched-map; contrastive.ts:80 unconditional referenceText embed). Removing the fan-out also makes the failFast footgun moot here.
- recency-weight-depth: THE CORRECTED WIRING. structuralProximity is computed first; adaptWeights sees the TRUE per-item ancestorCount (it only redistributes when ancestorCount===0 — confirmed signals.ts:143). recencyWeight then applies as a MULTIPLIER on the depth TERM after the fold: composite' = composite − δ·depth + δ·depth·r, where r∈(0,1]. This NEVER overwrites signals.depth before adaptWeights, so the 4:1 FA:DEPTH ratio invariant (signals.ts:130) holds for no-ancestor items. Recency rides δ as a post-multiplier, never touches FA/AVG/PERSIST.
- softmax-confidence: softmax(composites, T) → P_ext. Because composites can be NEGATIVE (FA / faContrast cosines), softmax is shift-invariant: exp((s_i−max)/T)/Σ. entropyStrategy(T) plugs the ConfidenceStrategy seam (isClearWinner(rankedScores) = entropy below a bar) — the codebase comment at types.ts:97 and attributability.ts:72 explicitly names "entropy / dispersion" as the anticipated consumer strategy, so this is a clean zero-change sibling of marginStrategy/ratioStrategy.

ACROSS LOOPS: the continue branch loopTo:'score-one-decision' carries carry_{N-1} forward in TypedScope (decision N built from N-1). The carry MUST be plain data (number-keyed source-id → number) — structuredClone-safe across the back-edge.

CONVERGENCE (forward-propagation-aggregate, in the PARENT so it can read the full commitLog):
- contribution_N(src) = score_N(src) + λ·carry_{N-1}(src), carry zeroed when src leaves the window.
- GATE: causalChain is BACKWARD slicing (backtrack.ts:4) rooted at one startId, needing a KeysReadLookup. Forward reachability does NOT fall out for free — you invert: for each loop-N node, run causalChain rooted there, flattenCausalDAG, and src reaches loop N iff src's runtimeStageId is in that backward slice. No-double-count over the MERGING DAG (diamond S→A→C, S→B→C: S counted once) is reverse-topological / ascending executionIndex — must be PROPERTY-tested before wiring.
- The KeysReadLookup is the load-bearing dependency: CommitBundle does NOT serialize keysRead (backtrack.ts:13 — supplied by a recorder during the ORIGINAL run). The seed stage loads a persisted keysReadMap; absent it, λ→0 (per-loop only) honestly, never an ungated similarity carry masquerading as a gated feature.

HONESTY GATE: rankingConfidence(aggregate, {strategy: marginStrategy()}) — recalibrated, does NOT inherit the eligibility-summed distribution's 0.05 margin. Ablation: runAblationProbe (resolveSamples ≥2) → verdictFor (forced inconclusive on unstable baseline, ablation.ts:235; majority-flip for confirmed).

### How it stays faithful — and honest about it

The chart biases toward the model's decision SHAPE through five wirings, each grounded in a real symbol — but the headline claim is DEMOTED to what is defensible, with the strongest faithful primitive PROMOTED.

(1) SOFTMAX over our composite scores (softmax-confidence) — DEMOTED honestly. P_ext is the confidence/dispersion of OUR proxy ranking, NOT "the model's decision distribution." The model's softmax is over its own logits; ours is over cosine geometry, a different sample space (evidence-pieces vs token/tool choices). Cosines occupy a narrow band, so T does most of the discriminating work — without calibration, flat-vs-peaked is a T artifact. So "approximates the model's distribution" is reserved STRICTLY for the optional whitebox-validate branch where P_model comes from real Qwen3-4B logits, fitting T by minimizing KL(P_ext‖P_model). entropyStrategy is presented as a peer decisiveness rule (margin/ratio/entropy), not a model emulator.

(2) RECENCY (recency-weight-depth) mimics positional lean — admitted strictly as an ordering/weighting prior in the content-blind DEPTH slot, never a content claim, never a causal claim. Direction (recency vs primacy) is per-model-configurable; a single half-life geometric kernel cannot express the U-shaped lost-in-the-middle bias, so this is a tunable prior, not validated mimicry.

(3) PER-LOOP scoring (the score-one-decision subflow re-entered by the loopTo back-edge) literally mirrors the agent loop — one decision per iteration scored against THAT loop's outcome, the scorer's loop shape echoing the agent's. This is the structurally strongest faithfulness lever and the whole reason for the per-loop angle over linear.

(4) CONTRASTIVE FA (faContrast = sim(e,answer)−sim(e,reference)) removes the topical-innocent confound: a refund-policy piece resembles ANY refund output, right or wrong; subtracting the reference leaves the piece resembling the WRONG output specifically — biasing toward the actual driver, not the topic.

(5) FORWARD PROPAGATION (contribution_N = score_N + λ·carry_{N-1}) mirrors that decision N is built from N-1 — gated by REAL reachability (causalChain over the commitLog) so credit flows only where data could, not by multiplying two proxies.

PROMOTION: scoreMargin is the genuinely decision-faithful primitive (it ranks the OFFERED candidate set — the actual tool catalog the model chose among — with margin = best-chosen − best-non-chosen). The design exposes it as an optional per-loop tool-choice stage feeding a SECOND ambiguity signal (prospective margin.narrow alongside retrospective clearWinner), because that scores the real choice set rather than a retrospective evidence blend.

OVERARCHING HONEST FRAME: all five are correlational BIASES toward plausible decision shape. Fidelity to the real decision is ESTABLISHED only by the optional white-box P_model branch and ultimately the ablation tier — and every faithfulness CLAIM (not just the λ implementation) is gated on the multi-loop CTXBUG fixture. Until then softmax/recency are admitted as ranking priors.

### The honesty ladder IS the control flow

The ladder IS the control-flow graph, provable from the trace — not a comment anyone has to honor.

PROXY TIER = every stage from seed through forward-propagation-aggregate: the four signals, contrastive composite, recency, softmax, eligibility, rankingConfidence — all cosine geometry, deterministic, free, each carrying influence-core's verbatim "similarity PROXY, not a proven cause" claim.

THE SINGLE BRANCH POINT = confidence-ambiguity-decider. Encoded with the FILTER form of decide() so the threshold is captured as FilterCondition evidence on onDecision + the narrative — BUT this only works because the design FLATTENS rc.clearWinner onto top-level scope.clearWinner first (confirmed bug: WhereFilter is flat-keys-only, decide/types.ts:31; a {when:{clearWinner:{eq:true}}} read against a nested rankingConfidence object would read undefined and silently route everything to default). The flatten is a typed write, so it ALSO appears in the narrative — the recorded "clearWinner eq true → report-correlational-lead" is the audit proof a proxy score routed to the proxy branch.

TWO STRUCTURALLY DISTINCT DESTINATIONS:
- report-correlational-lead is a PLAIN function branch wired to NO ablation symbol — it writes {causal:false} and is physically incapable of reaching a "context-bug confirmed" leaf. That leaf is graph-unreachable from here, not policy-forbidden.
- run-ablation is a subflow branch — the ONLY path wired to runAblationProbe/verdictFor. verdictFor (ablation.ts:224) is the sole causal-claim emitter and FORCES 'inconclusive' when baselineStable===false (a second structural guard) plus requires a majority flip for 'confirmed' (the causal floor is solid).

THREE ADVERSARIAL HONESTY FIXES baked into the topology:
- The causal arm is NOT self-contained. runAblationProbe needs an injected AblationRunner (types.ts:281) that re-runs the whole agent N≥2× — confirmed required, NOT manufacturable inside the scorer. So a NESTED decider gates run-ablation on the flattened scope.hasRerun: absent the runner, flow routes to an honest "ambiguous, but no rerun harness supplied — cannot escalate to causal tier" leaf. The ladder degrades honestly instead of dead-ending on a stub.
- The degenerate band: with a deterministic embedder the proxy variance band is zero-width; report-correlational-lead marks band:'degenerate' and the genuine seed-variance band is surfaced ONLY on the ablation arm — never present a zero proxy band as "measured stability."
- whitebox-validate sits behind {hasLocalModel:{eq:true}} and simply skips when absent — model-agnostic by construction; white-box validation is visibly OPTIONAL, and it is the ONLY arm licensed to use the words "the model's distribution."

A reviewer can SEE in the drawn chart that causation hangs off exactly one edge, gated by a recorded threshold, and that no proxy stage ever touches a "because" leaf.

### It explains and draws itself

Because the scorer IS a footprint.js flowchart, it explains and draws itself with zero extra code — the whole payoff of expressing it this way.

DRAWS ITSELF: toSpec()/toMermaid() emit the drawable structure — you SEE the per-loop subflow, the back-edge mirroring the agent loop, compute-signals → recency → softmax inside it, the more-loops decider with its looping vs terminal branch, the forward-propagation aggregator, and the confidence decider splitting into the proxy-lead leaf vs the ablation sub-pipeline. The honesty ladder is a visible fork.

NARRATES EVERY SCORE: getNarrativeEntries() gives the stage-by-stage story because every typed write is tracked. To make the per-piece DERIVATION actually visible (judges correctly noted narrative records WRITES, not internal computation), each math stage writes its intermediate as a tracked typed property OR $emits a structured per-piece breakdown — so the trace reads "piece #3: FA 0.71 → contrast dropped it to 0.12 → recency ×0.97 → forward-carry +0.05 from loop 2 → final 0.20." Crucially, compute-signals keeps BOTH the raw and contrast-corrected arrays (perLoopScoredRaw + perLoopScored) instead of overwriting, so the before/after the walkthrough advertises is real.

SELF-EXPLAINING ROUTING: the decide() evidence on the confidence decider records WHICH flattened boolean/threshold produced the proxy-vs-ablation routing — queryable on onDecision, the audit proof of honest routing.

LIVE + TIME-TRAVELABLE + PER-LOOP ADDRESSABLE: topologyRecorder() reconstructs the live composition graph mid-run (each loop re-entry as id#n); inOutRecorder() captures each score-one-decision boundary's entry/exit payload keyed by runtimeStageId. Because the loop is a REAL loopTo back-edge (not a JS for-loop), every iteration commits with a fresh runtimeStageId (same stageId, ascending #executionIndex) — so each agent-loop iteration is genuinely independently addressable and you can scrub to loop 3 and see exactly the evidence in and the InfluenceScore[] out. (This is the concrete advantage over the linear angle, whose "per-loop addressable" claim the judges proved false.)

The scorer explains itself the same way it explains the agent it scores — and you can lay the two flowcharts side by side because they share the loop shape.

### Plain walkthrough

Imagine a detective figuring out which clue made a suspect (the AI) reach its conclusion — and the AI thinks in ROUNDS, one decision per round. We build an assembly line that copies the AI's own round-by-round shape, and the whole assembly line draws itself on a whiteboard and writes its own step-by-step story.

ROUND BY ROUND: for each round we run the SAME little workstation ("score one decision"). At that workstation we rate every clue four ways at once — how much it sounds like THIS round's answer, how steadily it matched the AI's thinking, in how many thinking-steps it kept showing up, and where it sat (pure position, no reading). We combine these with a clever twist: we SUBTRACT out clues that look like ANY answer — the topic everyone's talking about — so only the clue that looks like THIS PARTICULAR (possibly wrong) answer stands out. We give a small, honest nudge to RECENT clues (the AI leans on recent stuff) — but ONLY on the "where it sat" rating, never on the "what it says" ratings, because position shouldn't fake meaning. Then we turn the round's scores into betting odds (a sharp spread = the AI was decisive that round; a flat spread = nearly a coin-flip).

THE LOOP: a gate asks "more rounds?" If yes, an arrow loops back to the SAME workstation for the next round — exactly like the AI's own loop — carrying forward what we learned (this round built on the last). When rounds end, we ADD UP every round's findings, fading older rounds, and — this is important — we only let a clue's early credit carry forward if the actual wiring of the run shows it COULD have flowed forward. We check the real connections, not just looks. (And if we don't have a record of those connections, we honestly turn carry-forward OFF rather than fake it.)

THE HONEST FORK (the crucial part): we ask "is there a clear front-runner clue?" If ONE clue clearly leads, we just SAY SO — "this clue correlates most, here's the gap" — and we explicitly DO NOT claim it caused anything. That branch is physically wired so it CANNOT say "because." If it's TOO CLOSE TO CALL — which is exactly the dangerous case where the real culprit hid by NOT resembling the answer — we escalate to the only thing that proves cause: re-running the AI several times with that clue REMOVED to see if the answer flips. Only THAT re-run path may say "because" — and if the re-runs are themselves shaky, it honestly says "inconclusive."

Two honest caveats built in: (a) the re-run experiment needs someone to hand us a "re-run the whole scenario" button — if nobody does, the close-call case stops at "ambiguous, can't prove it" instead of pretending. (b) The "betting odds" are OUR guess of the AI's confidence, not the AI's real confidence — we only claim to read the AI's real mind in one optional side-check, when we happen to have a copy of its brain (a local model) on hand. Everything else works with any off-the-shelf meaning-ruler, no peeking inside the AI required.

### Net-new to build (small) vs reused

- softmax(scores, temperature) — tiny pure fn forming P_ext; shift-invariant (exp((s_i−max)/T)/Σ) because composite scores can be negative (grep confirms no softmax symbol exists in influence-core)
- entropyStrategy(temperature) — a ConfidenceStrategy { name, isClearWinner(rankedScores) } that drops into the EXISTING seam (types.ts:102) with ZERO change to rankingConfidence; the codebase comment already names 'entropy / dispersion' as the anticipated consumer strategy
- recencyWeight(index, n, halfLife) → (0,1] — tiny pure fn applied as a POST-MULTIPLIER on the DEPTH term only, AFTER adaptWeights (grep confirms only LRU 'recency', no recencyWeight symbol)
- the λ-eligibility forward-propagation combinator contribution_N = score_N + λ·carry_{N-1} — the one genuinely new MATH; wraps (never replaces) per-loop compositeScore, gated by REAL reachability; requires a forwardReachability helper that INVERTS the backward causalChain slice (causalChain is backward-only — confirmed), plus a no-double-count reverse-topological reduction that MUST be property-tested in isolation first
- the LoopFrame assembler — must specify HOW per-loop context-window membership is derived from the commitLog (bucket by repeated local stageId + ascending #executionIndex via parseRuntimeStageId; NEVER forkBranch); 'leaves the window' has no existing substrate
- a persisted keysReadMap requirement on the ORIGINAL agent run (attach a QualityRecorder / keys-read store serialized alongside the commitLog) — CommitBundle does NOT serialize keysRead; without it the λ gate degenerates and the design falls back to λ=0
- a LOOP-SCOPED AblationSpec + partial-rerun contract — shipped AblationSpec is RUN-scoped (tool/injection/memory/arg construction inputs, types.ts:252) and runAblationProbe re-runs the whole agent; per-loop counterfactual replay (e.g. resume-from-loop-N-checkpoint with the piece removed) is a MAJOR net-new harness, NOT a thin contract — gate it, ship v1 with run-scoped ablation over the shortlist
- the flowchart WIRING itself: seed assembler, score-one-decision subflow, branch-sourced loopTo, the flatten-then-decide confidence gate, the nested hasRerun degrade-honestly branch, the optional whitebox branch

### CTXBUG validation (the gate)

The multi-loop CTXBUG fixture is the GATE for every uncalibrated claim — the design is a yes-to-build only with this validation plan attached (library-first: the benchmark exists to find and fix library weakness).

WHAT THE FIXTURE NEEDS: a multi-loop agent scenario with a KNOWN planted context bug (a piece that causes a wrong decision at a specific loop), where the planted ground-truth is the culprit source AND the loop at which it bit. Build it with the proven local Tier-A stack (llama.cpp + Qwen3-4B-Q4_K_M, determinism PASS per memory) so the white-box P_model branch is available for calibration. The fixture run MUST persist BOTH the commitLog AND a keysReadMap (attach a read-tracking recorder) — without that the λ gate cannot be validated.

THE DECISION × ANSWER CORRELATION (the core validation): the faithfulness claim is that the scorer's per-loop ambiguity/decisiveness tracks the model's ACTUAL decisiveness. Validate by correlating, per loop:
- OUR P_ext entropy (and clearWinner from entropyStrategy) AGAINST the model's real P_model entropy over tool logits (whitebox branch). Report KL(P_ext‖P_model) and rank-correlation per loop; fit T to minimize it; report the residual. If P_ext entropy does NOT correlate with P_model entropy, the softmax faithfulness claim FAILS and we keep entropyStrategy only as a peer decisiveness rule (margin/ratio), never as a model proxy.
- The DECISION the model made (which tool/answer at each loop) AGAINST the scorer's top-ranked influence piece at that loop. The correlation we want: at loops where the model's answer was DRIVEN by the planted piece, the scorer ranks that piece first (clearWinner) and routes to proxy-report; at loops where the bug hid by ABSENCE (flat top), the scorer routes to ablation and ablation CONFIRMS the planted culprit.

PER-PIECE VALIDATION GATES:
- softmax T: calibrated (not free-knob) only after the KL-fit above produces a stable T with bounded residual. Until then ship entropyStrategy gated/off-by-default; default to marginStrategy.
- recency halfLife: ship at ∞ (weight 1.0, reduces to plain structuralProximity) as the DEFAULT; enable decay only when a per-model fit shows it IMPROVES localization accuracy on the fixture (does the bug rank higher with recency on?). Validate direction (recency vs primacy) — wrong direction must not silently invert.
- λ: ship λ=0 (per-loop only) as the shippable v1 default. Enable forward-propagation only when the fixture shows multi-loop credit-carry IMPROVES culprit-loop localization vs λ=0. Property-test the no-double-count invariant (diamond DAG) BEFORE this stage is wired.
- run-scoped ablation: validate verdictFor confirms the planted culprit and returns inconclusive when the baseline is intentionally destabilized. Loop-scoped ablation stays OUT of v1 until the partial-replay harness exists.

OUTCOME METRIC: localization accuracy (did the scorer + ablation identify the planted culprit source and loop?) and honest-routing rate (did clear cases stop at proxy, ambiguous cases reach ablation, no proxy ever claim cause?) — both read directly off the self-drawn trace.

### Open questions

- Forward reachability: causalChain is backward-only — is per-loop-node backward slicing + membership test (O(loops × slice)) acceptable, or do we build one inverted DAG at the deepest loop? The cost and the no-double-count proof differ between the two; needs a decision before the λ stage is designed.
- keysReadMap persistence: which recorder owns it on the ORIGINAL agent run (QualityRecorder already tracks keysRead per step per backtrack.ts:13), and what is the serialization format alongside commitLog? If the common agent path doesn't attach it, forward-propagation is permanently λ=0 in practice — is that acceptable for v1?
- Does the analyzed agent's real cross-loop data flow even APPEAR in the commitLog? Agents carrying state via message history / provider memory (not scope.setValue) leave no read→write edges — causalChain returns a near-empty DAG and the gate zeroes everything. The CTXBUG fixture must measure how many cross-loop edges actually exist; if ~0 for real agents, the gate is decorative.
- Loop-scoped ablation: the pause/resume checkpoint is the natural partial-replay mechanism (re-run from the score-one-decision boundary with the piece removed) — but is replaying ONE loop of a stateful agent in isolation even semantically well-defined, or does forward state make it incoherent? This may be unbuildable on the existing ablation tier without a new replay contract.
- scoreMargin promotion: the design exposes it as an optional second ambiguity signal, but should the prospective margin.narrow flag be a co-equal input to the confidence decider (prospective AND retrospective ambiguity), or kept diagnostic? Co-equal raises faithfulness but complicates the honest-routing audit.
- Recency kernel shape: a single geometric half-life cannot express U-shaped lost-in-the-middle bias. Is a two-term (primacy + recency) kernel worth the extra knob, or do we accept geometric-recency as a deliberately simple, per-model-configurable prior?
- Temperature for a model-agnostic deployment: when NO local model is available, T cannot be calibrated against P_model. Do we ship a per-embedder default T (calibrated once on a reference embedder) and label it 'uncalibrated for your embedder', or refuse entropyStrategy entirely without a local model?

## How it's used — the influence-guided backtracking debugger (the purpose)

The scorer is not the product; **finding the bug is**. The influence score exists to
*guide a backward walk* from the wrong answer to its root cause. The workflow:

1. **Start at the wrong final answer.** The influence score at the last step ranks the
   context pieces; the top one (say 80) is the prime suspect for that step.
2. **Jump back to the decision that produced that piece** (an earlier tool call / loop).
3. **Re-rank at that step**; follow the new top piece.
4. **Repeat** — *top piece → the decision that made it → its top piece → …* — until the
   root: the original bad piece (a wrong skill instruction, a misleading fact). That is
   the bug.

**Automated, the debugger hands the user the chain, root-first:**

> "wrong answer leans most on **X** (80) → X came from the **search at loop 2** → that
> search leaned most on the instruction *'always call refund first'* (90) → **that
> instruction is the bug.**"

**What's reused vs what the score adds.** The backward walk already exists —
`causalChain` ("who wrote this value, and who fed *that*"), the BacktrackView "why?"
board, and the conversational `traceDebugAgent` / `.selfExplain()`. Without a score,
that walk **branches into every source it read**. The influence score's job here is
**path selection**: it *ranks* the pieces at each step so the debugger follows the
single most-influential trail instead of exploding combinatorially. The per-loop
score + the §"score tracing" propagation give a *trail*, not a flat list — exactly
what a guided backtrack needs.

**Honesty (unchanged).** The score **guides** (a fast, strong hint, never proof); to
**prove** a piece is the bug, ablate it (change it, re-run, watch the answer flip).
The guide reaches the suspect fast; ablation convicts it. So the debugger surfaces a
**ranked trail to the suspect** and offers a **one-click ablation** to confirm the
root — never asserting cause from the proxy alone.

This is the *use* layer over the flowchart scorer: the scorer (built as a
self-explaining flowchart) produces the per-step rankings; the backtracking debugger
consumes them to walk a user — or itself, automatically — to the root cause.

**Backlog (UI, not now):** a **tree-of-scores chart** — root = the final answer,
children = the highest-influence pieces at each step back, rendered as a clickable
tree; clicking a node navigates to that content in the current Lens / agentThinkingUI
view. It is the *visual* form of this backtracking trail (the guided walk drawn as a
tree), downstream of the scorer's per-step rankings. Logged as a future task per the
inventor; not in scope for the scorer build.

**Backlog (library DX, not now): a `ScorerRecorder`.** A first-class recorder you
attach once (twin of `MetricRecorder` / `InOutRecorder`) that captures per-step
influence/score data **live during the run** — so the per-loop scores and the
backtracking trail come out for free, instead of being recomputed post-hoc from the
commit log. Fits the recorder model exactly (Convention 1: one concern; composes a
`SequenceStore<ScoreEntry>` keyed by `runtimeStageId`), is callable + composable, and
feeds both the backtracking debugger and the tree-of-scores UI above. Build it when
the scorer is promoted into the library; it is the "make the whole thing easy" DX
investment. Logged per the inventor; not in scope for the first scorer build.

---

*Gated: no code until an explicit "yes." This memo is the artifact to react to.*
