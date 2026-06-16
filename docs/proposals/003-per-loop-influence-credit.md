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

*Gated: no code until an explicit "yes." This memo is the artifact to react to.*
