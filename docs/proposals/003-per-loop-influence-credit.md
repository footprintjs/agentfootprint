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

The adversarial panel verified a real defect while grounding the mechanism in source: **`TraversalContext.loopIteration` is declared but never populated by the engine** — it is computed only inside one narrative renderer and is absent from `CommitBundle`. Any consumer bucketing by it is reading a phantom field. **Decision to make (gated):** either (a) stamp `loopIteration` on the emitted `TraversalContext` / `CommitBundle` (a one-field engine change that makes the trajectory assembler honest and trivial), or (b) keep "zero new capture" and derive loop buckets from `runtimeStageId` + `parentRuntimeStageId` (a fragile reconstruction). This is a footprint.js-level call independent of the scorer.

---

*Gated: no code until an explicit "yes." This memo is the artifact to react to.*
